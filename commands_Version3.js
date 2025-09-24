/**
 * Rich command handler for the WhatsApp AI chatbot
 *
 * Features:
 * - Many built-in commands (conversational, utilities, fun, admin)
 * - /menu shows an interactive menu (list or fallback text)
 * - Commands may call OpenAI via context.openaiClient when available
 * - Safe-guards for insults / profanity and protected classes
 * - Media download helpers use sessionStore.getLastMedia
 *
 * Exports:
 * - async handleCommand(from, text, context) -> { handled: boolean }
 *
 * Expected context:
 * - sendText(to, text)                     : async function to send a plain text WhatsApp message
 * - sendInteractive(to, payload)           : (optional) send interactive message payload (list/buttons)
 * - sessionStore                           : session store module (reset,setSystemPrompt,setLanguage,...)
 * - openaiClient                           : (optional) openai client { generateReply(messages) }
 * - env_serve_base                         : optional base URL where /media files are served
 *
 * Notes:
 * - This file is intentionally self-contained and extensible.
 * - Add new commands into COMMANDS metadata below to surface them in the menu.
 */

const axios = require('axios');
const path = require('path');

const ADMIN_NUMBERS = (process.env.ADMIN_NUMBERS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map((n) => n.replace(/\D/g, ''));

/* ---------- Utilities ---------- */
function normalizeBare(jidOrNumber) {
  return String(jidOrNumber || '').replace(/\D/g, '');
}
function isAdmin(jidOrNumber) {
  return ADMIN_NUMBERS.includes(normalizeBare(jidOrNumber));
}
function parseCommand(text) {
  if (!text) return null;
  const t = text.trim();
  if (!t.startsWith('/')) return null;
  const parts = t.slice(1).split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1);
  return { cmd, args, raw: t };
}
function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function safeTruncate(s, n = 3000) { return s.length > n ? s.slice(0, n) + '\n\n(truncated)' : s; }

/* ---------- Safety helpers ---------- */
const PROFANITY = ['badword1','badword2']; // placeholder, replace with real list if desired
function containsProfanity(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PROFANITY.some(p => lower.includes(p));
}
const PROTECTED = ['race','religion','muslim','jew','black','white','asian','gay','lesbian','trans','immigrant','disability'];
function touchesProtectedClass(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PROTECTED.some(p => lower.includes(p));
}

/* ---------- Menu & Command Registry ---------- */
/*
  COMMANDS is used to generate the menu. Add commands here to make them visible
  in the interactive menu. Each entry: { id, title, description, usage, category }
*/
const COMMANDS = [
  { id: 'help', title: 'Help', description: 'Show help and commands', usage: '/help', category: 'General' },
  { id: 'menu', title: 'Menu', description: 'Open interactive menu', usage: '/menu', category: 'General' },
  { id: 'reset', title: 'Reset', description: 'Reset your conversation', usage: '/reset', category: 'General' },

  { id: 'summary', title: 'Summary', description: 'Summarize the conversation', usage: '/summary', category: 'Utilities' },
  { id: 'export', title: 'Export', description: 'Export recent conversation', usage: '/export', category: 'Utilities' },
  { id: 'translate', title: 'Translate', description: 'Translate text to target language', usage: '/translate <lang> <text>', category: 'Utilities' },
  { id: 'define', title: 'Define', description: 'Get a concise definition', usage: '/define <word>', category: 'Utilities' },
  { id: 'tts', title: 'Text→Speech (TTS)', description: 'Generate a short TTS audio link (optional)', usage: '/tts <text>', category: 'Utilities' },

  { id: 'download', title: 'Download last media', description: 'Download last sent image/video/document', usage: '/download', category: 'Media' },
  { id: 'video', title: 'Download remote video', description: 'Download video from URL', usage: '/video <url>', category: 'Media' },

  { id: 'image', title: 'Generate image', description: 'Generate an image from prompt (requires OpenAI image key)', usage: '/image <prompt>', category: 'Fun' },
  { id: 'joke', title: 'Joke', description: 'Tell a joke', usage: '/joke', category: 'Fun' },
  { id: 'meme', title: 'Meme text', description: 'Generate meme caption', usage: '/meme <topic>', category: 'Fun' },
  { id: 'flirt', title: 'Flirt', description: 'Send a playful flirt', usage: '/flirt [name]', category: 'Fun' },
  { id: 'compliment', title: 'Compliment', description: 'Send a compliment', usage: '/compliment [name]', category: 'Fun' },
  { id: 'insult', title: 'Insult (playful)', description: 'Send a mild playful insult', usage: '/insult [name]', category: 'Fun' },
  { id: 'wasted', title: 'Wasted', description: 'Send wasted meme', usage: '/wasted [name]', category: 'Fun' },

  { id: 'poll', title: 'Poll', description: 'Create a simple poll', usage: '/poll "Question" "Option1" "Option2" [...]]', category: 'Group' },
  { id: 'vote', title: 'Vote', description: 'Vote in a poll', usage: '/vote <pollId> <optionIndex>', category: 'Group' },

  { id: 'broadcast', title: 'Broadcast', description: 'Admin: send broadcast', usage: '/broadcast <message>', category: 'Admin' },
  { id: 'stats', title: 'Stats', description: 'Admin: show usage stats', usage: '/stats', category: 'Admin' },
];

/* Grouping helper for menu */
function groupCommandsByCategory() {
  const map = {};
  for (const c of COMMANDS) {
    map[c.category] = map[c.category] || [];
    map[c.category].push(c);
  }
  return map;
}

/* ---------- Small canned responses ---------- */
const JOKES = [
  "Why don't programmers like nature? It has too many bugs.",
  "I told my computer I needed a break, and it said 'No problem — I'll go to sleep.'"
];
const FLIRTS = [
  "If smiles were seconds, you'd be eternity.",
  "Is your name Wi‑Fi? Because I'm feeling a connection."
];
const COMPLIMENTS = [
  "You're a ray of sunshine — you make everything better.",
  "You have impeccable taste!"
];
const INSULTS = [
  "You silly goose!",
  "You're a lovable troublemaker."
];
const MEME_TEMPLATES = [
  "Top text: %s\nBottom text: %s",
  "%s be like: \"%s\""
];

/* ---------- Helpers to send interactive menu ---------- */
async function sendMenuInteractive(to, context) {
  // Prefer using context.sendInteractive to send a WhatsApp list message / buttons.
  // If not available, fall back to textual menu.
  const grouped = groupCommandsByCategory();
  const sections = Object.keys(grouped).map(cat => ({
    title: cat,
    rows: grouped[cat].slice(0, 10).map(cmd => ({
      id: `cmd:${cmd.id}`,
      title: cmd.title,
      description: cmd.description
    }))
  }));

  if (typeof context.sendInteractive === 'function') {
    try {
      const payload = {
        type: 'list',
        header: { type: 'text', text: 'WhatsApp AI Chatbot Menu' },
        body: { text: 'Select a feature from the menu (or send /help)' },
        footer: { text: 'Tip: you can also type commands directly' },
        action: { button: 'Open Menu', sections }
      };
      await context.sendInteractive(to, payload);
      return true;
    } catch (err) {
      // fallback below
      console.warn('sendInteractive failed, falling back to text menu', err?.message || err);
    }
  }

  // Text fallback: grouped categories and first few commands
  const lines = ['WhatsApp AI Chatbot — Menu'];
  for (const cat of Object.keys(grouped)) {
    lines.push(`\n*${cat}*`);
    for (const cmd of grouped[cat].slice(0, 8)) {
      lines.push(`${cmd.usage} — ${cmd.description}`);
    }
  }
  lines.push('\nTip: send /help for full details or /menu to reopen this menu.');
  await context.sendText(to, lines.join('\n'));
  return true;
}

/* ---------- Command implementations ---------- */

async function cmd_help(from, args, context) {
  const lines = [
    'WhatsApp AI Chatbot — commands quick reference:',
    '/menu — Open the interactive menu',
    '/help — This help',
    '/reset — Reset conversation',
    '/summary — Summarize chat',
    '/translate <lang> <text> — Translate text',
    '/download — Download last media you sent',
    '/video <url> — Download a remote video',
    '/image <prompt> — Generate image (requires config)',
    '/joke — Tell a joke',
    '/poll "Q" "A" "B" — Create poll (group use)',
    '',
    'Admin: /broadcast, /stats'
  ];
  await context.sendText(from, lines.join('\n'));
}

async function cmd_menu(from, args, context) {
  await sendMenuInteractive(from, context);
}

async function cmd_reset(from, args, context) {
  context.sessionStore.reset(from);
  await context.sendText(from, '✅ Conversation reset. Say hi to start fresh.');
}

async function cmd_summary(from, args, context) {
  const convo = context.sessionStore.getConversationForOpenAI(from);
  if (!context.openaiClient || typeof context.openaiClient.generateReply !== 'function') {
    await context.sendText(from, 'Summary requires OpenAI. Configure OPENAI_API_KEY.');
    return;
  }
  const messages = [
    { role: 'system', content: 'You are a concise summarizer. Produce a short summary (2–4 sentences).' },
    ...convo
  ];
  try {
    const summary = await context.openaiClient.generateReply(messages);
    await context.sendText(from, `📝 Summary:\n${safeTruncate(summary, 2000)}`);
  } catch (err) {
    console.error('summary error', err?.message || err);
    await context.sendText(from, "Sorry, couldn't create a summary right now.");
  }
}

async function cmd_export(from, args, context) {
  const text = context.sessionStore.exportConversationText(from);
  await context.sendText(from, `📂 Export:\n${safeTruncate(text, 3000)}`);
}

async function cmd_translate(from, args, context) {
  if (!context.openaiClient) {
    await context.sendText(from, 'Translate requires OpenAI. Configure OPENAI_API_KEY.');
    return;
  }
  const lang = args[0];
  if (!lang || args.length < 2) {
    await context.sendText(from, 'Usage: /translate <lang> <text>');
    return;
  }
  const text = args.slice(1).join(' ');
  const prompt = `Translate the following text to ${lang} and return only the translation:\n\n${text}`;
  try {
    const translation = await context.openaiClient.generateReply([{ role: 'user', content: prompt }]);
    await context.sendText(from, `🔤 Translation (${lang}):\n${translation}`);
  } catch (err) {
    console.error('translate error', err?.message || err);
    await context.sendText(from, "Sorry, translation failed.");
  }
}

async function cmd_define(from, args, context) {
  const term = args.join(' ');
  if (!term) {
    await context.sendText(from, 'Usage: /define <word>');
    return;
  }
  if (!context.openaiClient) {
    await context.sendText(from, 'Define requires OpenAI. Configure OPENAI_API_KEY.');
    return;
  }
  const prompt = `Define "${term}" in 2-3 sentences, include a simple example sentence.`;
  try {
    const def = await context.openaiClient.generateReply([{ role: 'user', content: prompt }]);
    await context.sendText(from, `📚 Definition:\n${def}`);
  } catch (err) {
    console.error('define error', err?.message || err);
    await context.sendText(from, "Sorry, couldn't fetch definition.");
  }
}

async function cmd_tts(from, args, context) {
  const text = args.join(' ');
  if (!text) {
    await context.sendText(from, 'Usage: /tts <text>');
    return;
  }
  // Optional: If you have a TTS system, integrate here. We'll return an instruction link placeholder.
  await context.sendText(from, "⚠️ TTS not configured on this server. To enable, add a TTS provider and I'll return an audio link.");
}

async function cmd_download(from, args, context) {
  const last = context.sessionStore.getLastMedia(from);
  if (!last) {
    await context.sendText(from, "I don't have any recent media from you. Send an image/video/document first.");
    return;
  }
  if (!process.env.WHATSAPP_ACCESS_TOKEN) {
    await context.sendText(from, 'Server not configured to download media (missing WHATSAPP_ACCESS_TOKEN).');
    return;
  }
  try {
    const mediaId = last.id;
    const ext = last.filename ? path.extname(last.filename) : (last.mime_type && last.mime_type.includes('video') ? '.mp4' : '');
    const filename = `${normalizeBare(from)}-${mediaId}${ext}`;
    // step 1: get URL
    const mediaResp = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
      params: { fields: 'id,url' },
      timeout: 20000
    });
    const url = mediaResp.data?.url;
    if (!url) throw new Error('No media url');
    // step 2: download to disk (commands.js delegates actual file download to previously provided commands.js implementation — if that is not present, instruct user)
    // Here we will attempt to download and save to ./media; if your server doesn't allow, this may fail.
    const mediaDir = path.join(process.cwd(), 'media');
    const fs = require('fs');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    const outPath = path.join(mediaDir, filename);
    if (!fs.existsSync(outPath)) {
      const writer = fs.createWriteStream(outPath);
      const resp = await axios.get(url, { responseType: 'stream', headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` }, timeout: 120000 });
      await new Promise((resolve, reject) => {
        resp.data.pipe(writer);
        writer.on('close', resolve);
        writer.on('error', reject);
      });
    }
    const serveBase = context.env_serve_base || process.env.SERVE_BASE_URL || '';
    const link = serveBase ? `${serveBase.replace(/\/$/, '')}/media/${encodeURIComponent(filename)}` : `./media/${encodeURIComponent(filename)}`;
    await context.sendText(from, `✅ Downloaded and saved: ${link}`);
  } catch (err) {
    console.error('download command error', err?.response?.data || err?.message || err);
    await context.sendText(from, "Couldn't download media. The media might have expired or the server can't fetch it.");
  }
}

async function cmd_video(from, args, context) {
  const url = args[0];
  if (!url) { await context.sendText(from, 'Usage: /video <direct-download-url>'); return; }
  // download remote video to ./media
  const fs = require('fs');
  const mediaDir = path.join(process.cwd(), 'media');
  if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
  const filename = `${normalizeBare(from)}-remote-${Date.now()}.mp4`;
  const outPath = path.join(mediaDir, filename);
  try {
    const resp = await axios.get(url, { responseType: 'stream', timeout: 120000 });
    const writer = fs.createWriteStream(outPath);
    await new Promise((resolve, reject) => {
      resp.data.pipe(writer);
      writer.on('close', resolve);
      writer.on('error', reject);
    });
    const serveBase = context.env_serve_base || process.env.SERVE_BASE_URL || '';
    const link = serveBase ? `${serveBase.replace(/\/$/, '')}/media/${encodeURIComponent(filename)}` : `./media/${encodeURIComponent(filename)}`;
    await context.sendText(from, `✅ Video downloaded: ${link}`);
  } catch (err) {
    console.error('video download error', err?.message || err);
    await context.sendText(from, "Couldn't download the video. Ensure the URL is a direct link to the file.");
  }
}

async function cmd_image(from, args, context) {
  const prompt = args.join(' ');
  if (!prompt) { await context.sendText(from, 'Usage: /image <prompt>'); return; }
  // Use OpenAI images API if OPENAI_API_KEY present
  const key = process.env.OPENAI_API_KEY;
  if (!key) { await context.sendText(from, 'Image generation requires OPENAI_API_KEY.'); return; }
  try {
    // call OpenAI Images API (v1) — simple implementation
    const resp = await axios.post('https://api.openai.com/v1/images/generations', {
      prompt,
      n: 1,
      size: '1024x1024'
    }, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      timeout: 120000
    });
    const b64 = resp.data?.data?.[0]?.b64_json;
    if (!b64) throw new Error('No image returned');
    // save locally
    const fs = require('fs');
    const mediaDir = path.join(process.cwd(), 'media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    const filename = `${normalizeBare(from)}-img-${Date.now()}.png`;
    const outPath = path.join(mediaDir, filename);
    fs.writeFileSync(outPath, Buffer.from(b64, 'base64'));
    const serveBase = context.env_serve_base || process.env.SERVE_BASE_URL || '';
    const link = serveBase ? `${serveBase.replace(/\/$/, '')}/media/${encodeURIComponent(filename)}` : `./media/${encodeURIComponent(filename)}`;
    await context.sendText(from, `🖼️ Image generated: ${link}`);
  } catch (err) {
    console.error('image gen error', err?.response?.data || err?.message || err);
    await context.sendText(from, "Image generation failed. Check OPENAI_API_KEY and quota.");
  }
}

async function cmd_joke(from, args, context) {
  await context.sendText(from, pickOne(JOKES));
}

async function cmd_meme(from, args, context) {
  const topic = args.join(' ') || 'When your code runs on first try';
  const top = topic;
  const bottom = pickOne(['I knew I was right', 'It was a feature', 'Now ship it']);
  const meme = `Top: ${top}\nBottom: ${bottom}`;
  await context.sendText(from, meme);
}

async function cmd_flirt(from, args, context) {
  const name = args.join(' ').trim();
  await context.sendText(from, name ? `${name}, ${pickOne(FLIRTS)}` : pickOne(FLIRTS));
}

async function cmd_compliment(from, args, context) {
  const name = args.join(' ').trim();
  await context.sendText(from, name ? `${name}, ${pickOne(COMPLIMENTS)}` : pickOne(COMPLIMENTS));
}

async function cmd_insult(from, args, context) {
  const target = args.join(' ').trim() || 'You';
  if (touchesProtectedClass(target)) {
    await context.sendText(from, "I won't generate insults targeting protected groups. Keep it playful and safe.");
    return;
  }
  if (containsProfanity(target)) {
    await context.sendText(from, "Please avoid profanity.");
    return;
  }
  await context.sendText(from, `${target}, ${pickOne(INSULTS)}`);
}

async function cmd_wasted(from, args, context) {
  const name = args.join(' ').trim();
  const out = name ? `💥 WASTED — ${name} took it too far 🤪` : '💥 WASTED — That was legendary 🤪';
  await context.sendText(from, out);
}

/* Polls (very simple in-memory poll store) */
const POLLS = new Map(); // pollId -> { question, options: [str], votes: { optionIdx: [voterBareNumbers] }, creator }
function generatePollId() { return `poll_${Date.now().toString(36)}_${Math.floor(Math.random()*1000)}`; }
async function cmd_poll(from, args, context) {
  // Usage: /poll "Question" "Option1" "Option2" ...
  // naive parser for quoted strings
  const joined = context.rawCommand || ''; // fallback if provided
  const text = args.join(' ');
  const m = text.match(/"([^"]+)"\s*"([^"]+)"(?:\s*"([^"]+)")?(?:\s*"([^"]+)")?(?:\s*"([^"]+)")?/);
  if (!m) {
    await context.sendText(from, 'Usage: /poll "Question" "Option1" "Option2" [...]. Use quotes around each.');
    return;
  }
  const question = m[1];
  const options = m.slice(2).filter(Boolean);
  if (options.length < 2) { await context.sendText(from, 'Create a poll with at least 2 options.'); return; }
  const id = generatePollId();
  const votes = {};
  options.forEach((_, idx) => votes[idx] = []);
  POLLS.set(id, { question, options, votes, creator: normalizeBare(from) });
  const optList = options.map((o, i) => `${i}. ${o}`).join('\n');
  await context.sendText(from, `✅ Poll created: ${id}\nQ: ${question}\n${optList}\nTo vote: /vote ${id} <optionIndex>`);
}
async function cmd_vote(from, args, context) {
  const pollId = args[0];
  const idx = parseInt(args[1], 10);
  if (!pollId || Number.isNaN(idx)) {
    await context.sendText(from, 'Usage: /vote <pollId> <optionIndex>');
    return;
  }
  const poll = POLLS.get(pollId);
  if (!poll) { await context.sendText(from, 'Poll not found.'); return; }
  // remove previous votes by user
  const voter = normalizeBare(from);
  for (const arr of Object.values(poll.votes)) {
    const pos = arr.indexOf(voter);
    if (pos !== -1) arr.splice(pos, 1);
  }
  if (!poll.votes[idx]) { await context.sendText(from, 'Invalid option index.'); return; }
  poll.votes[idx].push(voter);
  await context.sendText(from, `✅ Your vote for option ${idx} recorded.`);
  // show current results
  const results = poll.options.map((opt, i) => `${i}. ${opt} — ${poll.votes[i].length} votes`).join('\n');
  await context.sendText(from, `Poll: ${poll.question}\n${results}`);
}

/* Admin commands */
async function cmd_broadcast(from, args, context) {
  if (!isAdmin(from)) { await context.sendText(from, '❌ Not authorized.'); return; }
  const msg = args.join(' ').trim();
  if (!msg) { await context.sendText(from, 'Usage: /broadcast <message>'); return; }
  const list = (process.env.BROADCAST_NUMBERS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!list.length) { await context.sendText(from, 'No recipients configured (BROADCAST_NUMBERS).'); return; }
  await context.sendText(from, `Sending broadcast to ${list.length} recipients...`);
  const results = [];
  for (const n of list) {
    const bare = n.replace(/\D/g, '');
    try {
      const toJid = `${bare}@c.us`;
      await context.sendText(toJid, msg);
      results.push({ to: bare, ok: true });
    } catch (err) {
      results.push({ to: n, ok: false, error: String(err) });
    }
  }
  const failed = results.filter(r => !r.ok);
  await context.sendText(from, `Broadcast done. Sent: ${results.length - failed.length}. Failed: ${failed.length}`);
}

async function cmd_stats(from, args, context) {
  if (!isAdmin(from)) { await context.sendText(from, '❌ Not authorized.'); return; }
  // simple stats: number of sessions, polls
  const ss = context.sessionStore && typeof context.sessionStore.getStats === 'function'
    ? await context.sessionStore.getStats()
    : { sessions: 'unknown' };
  await context.sendText(from, `Stats:\nSessions: ${ss.sessions}\nPolls: ${POLLS.size}`);
}

/* ---------- Command dispatcher ---------- */

const HANDLERS = {
  help: cmd_help,
  menu: cmd_menu,
  reset: cmd_reset,
  summary: cmd_summary,
  export: cmd_export,
  translate: cmd_translate,
  define: cmd_define,
  tts: cmd_tts,
  download: cmd_download,
  video: cmd_video,
  image: cmd_image,
  joke: cmd_joke,
  meme: cmd_meme,
  flirt: cmd_flirt,
  compliment: cmd_compliment,
  insult: cmd_insult,
  wasted: cmd_wasted,
  poll: cmd_poll,
  vote: cmd_vote,
  broadcast: cmd_broadcast,
  stats: cmd_stats
};

/* ---------- Public API: handleCommand ---------- */
async function handleCommand(from, text, context = {}) {
  // attach rawCommand for some handlers (like poll parser fallback)
  context.rawCommand = text;
  const parsed = parseCommand(text);
  if (!parsed) return { handled: false };

  const cmd = parsed.cmd;
  const args = parsed.args;

  // normalize sendText to always accept JID or bare number
  if (!context.sendText || typeof context.sendText !== 'function') {
    throw new Error('context.sendText must be provided');
  }

  // Basic spam / profanity guard
  if (containsProfanity(text)) {
    await context.sendText(from, "Please avoid profanity.");
    return { handled: true };
  }

  // dispatch
  const handler = HANDLERS[cmd];
  if (handler) {
    try {
      await handler(from, args, context);
    } catch (err) {
      console.error('command handler error', cmd, err?.message || err);
      try { await context.sendText(from, "Sorry — an error occurred while running that command."); } catch (e) {}
    }
    return { handled: true };
  }

  // if the command is of form cmd:<id> (from interactive menu), support that
  if (cmd.startsWith('cmd:')) {
    const id = cmd.slice(4);
    const target = COMMANDS.find(c => c.id === id);
    if (target) {
      // emulate user sending the usage to trigger handler if exists
      const usageParts = (target.usage || '').split(/\s+/);
      const main = usageParts[0].replace('/', '');
      if (HANDLERS[main]) {
        try { await HANDLERS[main](from, usageParts.slice(1), context); }
        catch (e) { console.error(e); }
        return { handled: true };
      }
      await context.sendText(from, target.description || 'Command selected.');
      return { handled: true };
    }
  }

  // unknown command
  await context.sendText(from, `Unknown command "/${cmd}". Send /help or /menu.`);
  return { handled: true };
}

/* ---------- Export ---------- */
module.exports = {
  handleCommand,
  parseCommand,
  COMMANDS,
  sendMenuInteractive, // exported for tests or direct use
};
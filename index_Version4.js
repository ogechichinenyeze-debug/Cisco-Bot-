/**
 * index.js
 * Integration-ready webhook that:
 *  - verifies webhook (GET /webhook)
 *  - handles incoming message webhooks (POST /webhook)
 *  - stores media metadata into sessionStore.appendMedia
 *  - if message text starts with '/', runs commands.handleCommand
 *  - otherwise forwards conversation to OpenAI via openaiClient
 *  - serves downloaded media at /media
 */

const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const { sendText, sendInteractive } = require('./whatsapp-utils');
const openaiClient = require('./openai-client');
const sessionStore = require('./session-store');
const commands = require('./commands');

const {
  WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_ACCESS_TOKEN,
  VERIFY_TOKEN,
  APP_SECRET,
  PORT = 3000
} = process.env;

if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN || !VERIFY_TOKEN) {
  console.error('Missing required configuration. See .env.example');
  process.exit(1);
}

const app = express();

// capture raw body for signature verification (if APP_SECRET used)
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

// serve media directory
const MEDIA_DIR = path.join(process.cwd(), 'media');
if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });
app.use('/media', express.static(MEDIA_DIR));

app.get('/', (req, res) => res.send('WhatsApp AI Chatbot running'));

app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === VERIFY_TOKEN) {
    console.log('WEBHOOK_VERIFIED');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

function verifySignature(req) {
  if (!APP_SECRET) return true;
  const signature = req.headers['x-hub-signature-256'];
  if (!signature) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', APP_SECRET).update(req.rawBody || '').digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature)); }
  catch (e) { return false; }
}

async function sendTextWrapper(to, text) {
  try {
    // sendText expects bare number or jid; it extracts bare digits.
    return await sendText(to, text);
  } catch (err) {
    console.error('sendTextWrapper error', err?.response?.data || err?.message || err);
    throw err;
  }
}

async function sendInteractiveWrapper(to, payload) {
  try {
    return await sendInteractive(to, payload);
  } catch (err) {
    console.error('sendInteractiveWrapper error', err?.response?.data || err?.message || err);
    throw err;
  }
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  if (!verifySignature(req)) {
    console.warn('Webhook signature verification failed');
    return res.sendStatus(403);
  }
  // ack quickly
  res.sendStatus(200);

  try {
    const body = req.body;
    if (!body.entry) return;

    for (const entry of body.entry) {
      if (!entry.changes) continue;
      for (const change of entry.changes) {
        const value = change.value;
        if (!value || !value.messages) continue;
        for (const message of value.messages) {
          const from = message.from; // usually a phone number like "1555..."
          let userText = '';

          // handle text / interactive / captions
          if (message.type === 'text' && message.text) {
            userText = message.text.body;
          } else if (message.type === 'interactive' && message.interactive) {
            if (message.interactive.type === 'button' && message.interactive.button) {
              userText = message.interactive.button.text || message.interactive.button.id;
            } else if (message.interactive.type === 'list' && message.interactive.list_reply) {
              userText = message.interactive.list_reply.title || message.interactive.list_reply.id;
            }
          } else if ((message.type === 'image' && message.image) ||
                     (message.type === 'video' && message.video) ||
                     (message.type === 'audio' && message.audio) ||
                     (message.type === 'document' && message.document)) {
            // Save media metadata to session store for /download
            const mediaObj = {};
            if (message.image) {
              mediaObj.id = message.image.id;
              mediaObj.mime_type = message.image.mime_type;
              mediaObj.filename = message.image.filename || `image_${message.image.id}`;
            } else if (message.video) {
              mediaObj.id = message.video.id;
              mediaObj.mime_type = message.video.mime_type;
              mediaObj.filename = message.video.filename || `video_${message.video.id}.mp4`;
            } else if (message.audio) {
              mediaObj.id = message.audio.id;
              mediaObj.mime_type = message.audio.mime_type;
              mediaObj.filename = message.audio.filename || `audio_${message.audio.id}.ogg`;
            } else if (message.document) {
              mediaObj.id = message.document.id;
              mediaObj.mime_type = message.document.mime_type;
              mediaObj.filename = message.document.filename || `doc_${message.document.id}`;
            }
            sessionStore.appendMedia(from, mediaObj);
            userText = (message.caption && message.caption.text) || '';
          } else {
            userText = `[${message.type} message received]`;
          }

          // build command context
          const commandContext = {
            sendText: async (to, text) => {
              // sendTextWrapper expects bare or jid; use the original 'from' formatting allowed
              return await sendTextWrapper(to, text);
            },
            sendInteractive: async (to, payload) => {
              return await sendInteractiveWrapper(to, payload);
            },
            sessionStore,
            openaiClient,
            env_serve_base: process.env.SERVE_BASE_URL || ''
          };

          // If the message looks like a command, handle it locally
          const cmdResult = await commands.handleCommand(from, userText, commandContext);
          if (cmdResult && cmdResult.handled) {
            // command handled; skip OpenAI flow
            continue;
          }

          // Not a command: normal conversational flow
          if (userText && userText.trim()) sessionStore.appendUserMessage(from, userText.trim());
          else sessionStore.appendUserMessage(from, `[${message.type} message received]`);

          const convo = sessionStore.getConversationForOpenAI(from);
          let reply = "Sorry, I couldn't create a reply at the moment.";
          try {
            reply = await openaiClient.generateReply(convo);
            sessionStore.appendAssistantMessage(from, reply);
          } catch (err) {
            console.error('OpenAI error:', err?.message || err);
          }

          try {
            const bareTo = String(from).replace(/\D/g, '');
            await sendTextWrapper(bareTo, reply);
          } catch (err) {
            console.error('Failed to send message via WhatsApp Cloud API:', err?.response?.data || err?.message || err);
          }
        }
      }
    }
  } catch (err) {
    console.error('Webhook handler error:', err);
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
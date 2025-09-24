```markdown
# WhatsApp AI Chatbot — Extended Commands & Menu

This document describes the extended command set and the interactive menu for the WhatsApp AI chatbot.

How it works
- Commands must start with a leading slash "/".
- You can open a friendly interactive menu with `/menu` — if the bot supports WhatsApp interactive messages it will send a list/buttons menu; otherwise a text fallback is shown.
- Commands are handled server-side; many features use OpenAI if configured (OPENAI_API_KEY).
- Media-related commands save files under ./media and are served at /media when the server exposes that directory.

Main categories (selected)
- General: /help, /menu, /reset
- Utilities: /summary, /export, /translate, /define, /tts
- Media: /download, /video
- Fun: /image, /joke, /meme, /flirt, /compliment, /insult, /wasted
- Group: /poll, /vote
- Admin: /broadcast, /stats (admin numbers set via ADMIN_NUMBERS env)

Notable commands
- /menu — interactive menu
- /download — downloads last media you sent and replies with a link (requires WHATSAPP_ACCESS_TOKEN and server access)
- /image <prompt> — generate an image via OpenAI (requires OPENAI_API_KEY)
- /poll "Q" "Option1" "Option2" — create a poll; others vote using /vote <pollId> <optionIndex>

Admin setup
- ADMIN_NUMBERS — comma-separated bare numbers (no +) allowed to run admin commands
- BROADCAST_NUMBERS — comma-separated recipients for /broadcast (admin only)

Media serving
- The server should expose ./media (e.g., `app.use('/media', express.static(path.join(__dirname,'media')))`).
- Optionally set SERVE_BASE_URL or pass env_serve_base in context so the bot can return full links.

Safety
- Insults are intentionally mild and avoid protected classes. The implementation includes simple checks, but review to match your policy.
- Avoid mass unsolicited messages. Use /broadcast responsibly.

Extending commands
- Commands are defined in commands.js in the COMMANDS array and HANDLERS mapping.
- To add a new command:
  1. Add metadata to COMMANDS (so it appears in the menu).
  2. Add a handler function and register it in HANDLERS.

If you want, I can:
- Add persistent storage for polls and sessions (Redis or DB).
- Build a small web UI to display polls, media, and manage broadcasts.
- Harden the safety filters with a content moderation API.
```
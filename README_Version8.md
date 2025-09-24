```markdown
# WhatsApp AI Chatbot — Full Source (Rich Commands & Media)

This repository provides a ready-to-run WhatsApp AI chatbot using the Meta WhatsApp Cloud API and OpenAI. It includes a rich set of built-in commands (fun, utilities, media, group/poll, admin) and an interactive menu fallback to text.

IMPORTANT: This uses the WhatsApp Cloud API (official) — no WhatsApp Web automation. Media downloading uses the Cloud API media endpoint. For production, secure tokens, use Redis for sessions, and add rate limits.

Features
- Webhook handling for WhatsApp Cloud API
- Message sending (text + interactive list/buttons)
- Media handling: record incoming media IDs, download via Graph API, serve under /media
- Rich command set (supports /menu and many commands)
  - Fun: /flirt (10), /compliment (10), /insult (10 — playful/safe), /wasted (10), /meme (10), /joke
  - Media: /download, /video
  - Utilities: /summary, /export, /define, /translate, /tts (placeholder), /image (OpenAI image)
  - Group: /poll, /vote
  - Admin: /broadcast, /stats
- Session store with conversation history + media metadata (in-memory; swap for Redis in production)
- Configurable via environment variables

Quick start
1. Copy files into a directory.
2. cp .env.example .env and fill values.
3. npm install
4. node index.js
5. Expose to the internet (ngrok or host) and set webhook callback URL to https://<your-server>/webhook in the Meta App dashboard.
6. Send messages to the Cloud phone number and interact with the bot.

Security & production notes
- Do NOT commit .env or secrets.
- Use long-lived tokens or a system user token.
- Use persistent session storage (Redis) and moderation for generated content.
- Add rate limiting to avoid abuse.

Commands (high-level)
- /menu, /help, /reset
- /flirt, /compliment, /insult, /wasted, /meme, /joke
- /download, /video
- /summary, /export, /define, /translate, /tts, /image
- /poll, /vote
- Admin: /broadcast, /stats

If you want, I can:
- Produce a single shell script to create and commit these files into a Git branch and open a PR.
- Add Redis-based session store and docker-compose.
- Harden content moderation with OpenAI Moderation API.

```
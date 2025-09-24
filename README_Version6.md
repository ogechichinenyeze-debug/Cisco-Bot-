```markdown
# WhatsApp AI Chatbot (Meta WhatsApp Cloud API + OpenAI)

A minimal ready-to-run WhatsApp AI chatbot using the Meta (Facebook) WhatsApp Cloud API and the OpenAI Chat API.

Contents
- index.js — webhook server and message flow
- openai-client.js — OpenAI chat wrapper
- session-store.js — simple in-memory conversation store (swap for Redis in production)
- package.json — dependencies & scripts
- .env.example — environment variables
- Dockerfile, .nvmrc, .gitignore

Prerequisites
- Node.js 18.x or 20.x (recommended) installed (use nvm to manage)
- A Meta Developer account with an App and WhatsApp product enabled
- A WhatsApp Cloud API phone number (Phone Number ID) and an Access Token (dev token available in the WhatsApp product)
- OpenAI API key
- ngrok (for local webhook testing) or a publicly reachable HTTPS server

Quick start (local)
1. Create a folder and paste these files into it.
2. cp .env.example .env and edit .env with your WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN, VERIFY_TOKEN, APP_SECRET (optional), OPENAI_API_KEY.
3. npm install
4. npm start
5. Expose locally: npx ngrok http 3000
6. Configure Meta App webhook callback URL to: https://<ngrok-id>.ngrok.io/webhook (see exact steps below)
7. Send a WhatsApp message to your Cloud API phone number and watch replies.

Exact Meta (WhatsApp Cloud) dashboard steps
(These steps reflect the typical dashboard layout — labels may vary slightly with Meta UI updates.)

1) Create a Meta App
- Visit https://developers.facebook.com/
- Click "My Apps" → "Create App"
  - Choose "Business" (recommended) or "Other" depending on your account.
  - Provide an app name and follow the prompts.

2) Add the WhatsApp product
- In your App's dashboard, click "Add Product" and choose "WhatsApp".
- Click "Set Up" on the WhatsApp product card.

3) Get Phone Number ID and Access Token
- In WhatsApp product -> Getting Started you should see:
  - Phone Number (human readable)
  - Phone Number ID (numeric) — this is WHATSAPP_PHONE_NUMBER_ID
  - A temporary Access Token (long string) — this is WHATSAPP_ACCESS_TOKEN for development
- Paste the values into your .env.

Notes:
- Temporary tokens shown in Getting Started expire. For production create a System User + long-lived token via Business Manager.

4) Configure webhook (Callback URL + Verify Token)
- App Dashboard -> Webhooks -> Add Callback URL (or Edit Subscriptions)
  - Callback URL: https://<your-server>/webhook  (e.g., https://abcd1234.ngrok.io/webhook when using ngrok)
  - Verify Token: choose a string and set VERIFY_TOKEN in your .env to the same string.
- When saving, Meta will GET your callback with:
  ?hub.mode=subscribe&hub.challenge=...&hub.verify_token=...
- Your server must verify hub.verify_token equals VERIFY_TOKEN and respond with the hub.challenge value (plain body). index.js implements this.

5) Subscribe to fields
- In the Webhooks UI subscribe your App to the WhatsApp Product fields:
  - messages (required to receive incoming messages)
  - message_status (for delivery/read events, optional)
  - messaging_postbacks (interactive buttons/lists, optional)
- Make sure the subscription is active for your app and phone number.

6) Test flow
- Start your server and ngrok.
- Ensure webhook is verified in dashboard.
- Send a WhatsApp message to the Cloud API phone number.
- Meta will POST a webhook to /webhook; server will call OpenAI and send a reply to the user.

Sending messages manually (example)
curl -X POST "https://graph.facebook.com/v17.0/<PHONE_NUMBER_ID>/messages" \
  -H "Authorization: Bearer <WHATSAPP_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"messaging_product":"whatsapp","to":"<RECIPIENT_PHONE>","text":{"body":"Hello"}}'

Security & production notes
- Do NOT commit .env or secrets.
- For production:
  - Use a persistent session store (Redis or database).
  - Verify webhooks using APP_SECRET (X-Hub-Signature-256).
  - Use long-lived tokens or a system-user token via Business Manager.
  - Implement queueing (ack webhook quickly, process in worker) for scale.
  - Add logging, monitoring, rate limiting and retries.

Troubleshooting
- 403 on verification: VERIFY_TOKEN mismatch.
- Signature verification fails: ensure APP_SECRET matches and server uses raw body for HMAC.
- 401 from Graph API: Access token invalid/expired.
- No webhooks: ngrok not running or webhook not subscribed to messages.

If you want, I can:
- Provide a Redis-backed session store and docker-compose.
- Produce a ZIP archive you can download (base64 or direct link).
- Create a GitHub Actions workflow for building and deploying to Cloud Run.
```
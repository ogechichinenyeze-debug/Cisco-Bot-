const express = require('express');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios');
const dotenv = require('dotenv');

const openaiClient = require('./openai-client');
const sessionStore = require('./session-store');

dotenv.config();

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

// capture raw body for signature verification
app.use(bodyParser.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.get('/', (req, res) => res.send('WhatsApp AI Chatbot running'));

// Webhook verification: Meta GET will send hub.mode, hub.verify_token, hub.challenge
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
  const expected = 'sha256=' +
    crypto.createHmac('sha256', APP_SECRET).update(req.rawBody || '').digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch (e) {
    return false;
  }
}

async function sendTextMessage(toPhoneNumber, text) {
  const url = `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: toPhoneNumber,
    text: { body: text }
  };
  const headers = {
    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  await axios.post(url, payload, { headers, timeout: 60000 });
}

// Webhook endpoint
app.post('/webhook', async (req, res) => {
  // Verify signature (if APP_SECRET set)
  if (!verifySignature(req)) {
    console.warn('Webhook signature verification failed');
    return res.sendStatus(403);
  }

  // Acknowledge quickly
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
          const from = message.from; // phone number of sender
          let userText = '';

          if (message.type === 'text' && message.text) {
            userText = message.text.body;
          } else if (message.type === 'interactive' && message.interactive) {
            if (message.interactive.type === 'button' && message.interactive.button) {
              userText = message.interactive.button.text || message.interactive.button.id;
            } else if (message.interactive.type === 'list' && message.interactive.list_reply) {
              userText = message.interactive.list_reply.title || message.interactive.list_reply.id;
            }
          } else if (message.type === 'image' && message.image && message.image.caption) {
            userText = message.image.caption;
          } else {
            userText = `[${message.type} message received]`;
          }

          // Append message to session store
          if (userText && userText.trim()) {
            sessionStore.appendUserMessage(from, userText.trim());
          } else {
            sessionStore.appendUserMessage(from, `[${message.type} message received]`);
          }

          // Build conversation and call OpenAI
          const convo = sessionStore.getConversationForOpenAI(from);
          let reply = "Sorry, I couldn't create a reply at the moment.";
          try {
            reply = await openaiClient.generateReply(convo);
            sessionStore.appendAssistantMessage(from, reply);
          } catch (err) {
            console.error('OpenAI error:', err?.message || err);
            // Keep default reply or send an apology
          }

          // Send the reply back over WhatsApp
          try {
            await sendTextMessage(from, reply);
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

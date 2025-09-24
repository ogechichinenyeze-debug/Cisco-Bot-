/**
 * whatsapp-utils.js
 * Thin wrapper around the Meta WhatsApp Cloud API for sending text and interactive messages.
 *
 * Usage:
 *  const { sendText, sendInteractive } = require('./whatsapp-utils');
 *  await sendText(toBareNumberOrJid, 'hello');
 *  await sendInteractive(toBareNumberOrJid, payload);
 *
 * Notes:
 *  - 'to' may be a bare phone number string or a JID (e.g., '1234567890' or '1234567890@c.us').
 *  - For the Cloud API "to" field must be the recipient phone number in international format (no +).
 */

const axios = require('axios');
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;
if (!WHATSAPP_PHONE_NUMBER_ID || !WHATSAPP_ACCESS_TOKEN) {
  console.warn('whatsapp-utils: WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_ACCESS_TOKEN missing in env.');
}

function toBareNumber(to) {
  if (!to) return '';
  // if contains '@' assume JID, try extract digits; otherwise remove non-digits
  const s = String(to);
  const digits = s.replace(/\D/g, '');
  return digits;
}

async function sendText(to, text) {
  const toBare = toBareNumber(to);
  const url = `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: toBare,
    text: { body: text }
  };
  const headers = {
    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const resp = await axios.post(url, payload, { headers, timeout: 60000 });
  return resp.data;
}

/**
 * sendInteractive(to, payload)
 * payload expected to follow WhatsApp Cloud API interactive message schema:
 * Example payload (list):
 * {
 *   type: 'list',
 *   header: { type: 'text', text: 'Header' },
 *   body: { text: 'Body text' },
 *   footer: { text: 'Footer' },
 *   action: { button: 'Open', sections: [ { title: 'Section', rows: [{id, title, description}] } ] }
 * }
 *
 * Example payload (buttons):
 * {
 *   type: 'button',
 *   body: { text: 'Choose' },
 *   action: { buttons: [{type:'reply', reply:{id:'btn1', title:'Yes'}}] }
 * }
 */
async function sendInteractive(to, interactivePayload) {
  const toBare = toBareNumber(to);
  const url = `https://graph.facebook.com/v17.0/${WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    to: toBare,
    type: 'interactive',
    interactive: interactivePayload
  };
  const headers = {
    Authorization: `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
    'Content-Type': 'application/json'
  };
  const resp = await axios.post(url, payload, { headers, timeout: 60000 });
  return resp.data;
}

module.exports = { sendText, sendInteractive };
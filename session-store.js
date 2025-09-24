// Very small in-memory session store. Replace with Redis or DB in production.
const maxMessages = parseInt(process.env.SESSION_MAX_MESSAGES || '12', 10); // conversation turns to keep
const ttlMinutes = parseInt(process.env.SESSION_TTL_MINUTES || '60', 10);

const store = new Map();

/**
 * Internal structure:
 * store.set(userId, { messages: [{role, content}], lastSeen: Number })
 */

function _ensureSession(user) {
  if (!store.has(user)) {
    store.set(user, {
      messages: [
        {
          role: 'system',
          content:
            'You are a helpful WhatsApp assistant. Keep replies concise and friendly. Use casual, short messages suitable for WhatsApp.'
        }
      ],
      lastSeen: Date.now()
    });
  }
  return store.get(user);
}

function appendUserMessage(user, text) {
  if (!text) return;
  const s = _ensureSession(user);
  s.messages.push({ role: 'user', content: text });
  s.lastSeen = Date.now();
  _trim(s);
}

function appendAssistantMessage(user, text) {
  if (!text) return;
  const s = _ensureSession(user);
  s.messages.push({ role: 'assistant', content: text });
  s.lastSeen = Date.now();
  _trim(s);
}

function _trim(session) {
  const system = session.messages[0];
  const rest = session.messages.slice(1);
  const trimmed = rest.slice(-maxMessages);
  session.messages = [system, ...trimmed];
}

function getConversationForOpenAI(user) {
  const s = _ensureSession(user);
  // return a shallow copy
  return s.messages.map((m) => ({ role: m.role, content: m.content }));
}

// periodic cleanup of stale sessions
setInterval(() => {
  const now = Date.now();
  const ttlMs = ttlMinutes * 60 * 1000;
  for (const [key, value] of store.entries()) {
    if (now - value.lastSeen > ttlMs) {
      store.delete(key);
    }
  }
}, 5 * 60 * 1000); // every 5 minutes

module.exports = {
  appendUserMessage,
  appendAssistantMessage,
  getConversationForOpenAI
};

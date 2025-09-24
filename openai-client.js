const axios = require('axios');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';

if (!OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required');
}

const DEFAULT_MODEL = 'gpt-3.5-turbo';
const DEFAULT_MAX_TOKENS = 600;

async function generateReply(messages) {
  // messages: [{role:'system'|'user'|'assistant', content:'...'}]
  const payload = {
    model: DEFAULT_MODEL,
    messages,
    max_tokens: DEFAULT_MAX_TOKENS,
    temperature: 0.7
  };

  const resp = await axios.post(OPENAI_API_URL, payload, {
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    timeout: 60000
  });

  const content = resp.data?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('No content in OpenAI response');
  }
  return content.trim();
}

module.exports = { generateReply };

// Handles communication with OpenAI API
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
require('dotenv').config();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

async function getOpenAiCompletion(prompt, opts = {}) {
  const maxAttempts = opts.retries || 2;
  let attempt = 0;
  while (attempt < maxAttempts) {
    try {
      const res = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: opts.model || 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: opts.max_tokens || 256,
          temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.2
        })
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI HTTP ${res.status}: ${text}`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts) throw err;
      // simple backoff
      await new Promise(r => setTimeout(r, 500 * attempt));
    }
  }
}

module.exports = { getOpenAiCompletion };

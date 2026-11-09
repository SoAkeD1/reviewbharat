// BharatCode model API client (OpenAI-compatible Chat Completions).
import { config } from './env.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a chat request to BharatCode.
 * @param {Array} messages
 * @param {{maxTokens?: number, reasoningEffort?: string, retries?: number, timeoutMs?: number}} opts
 * @returns {Promise<{text: string, truncated: boolean}>}
 */
export async function chat(messages, { maxTokens = 16000, reasoningEffort, retries = 3, timeoutMs = 180_000 } = {}) {
  if (!config.apiKey) {
    throw new Error('BHARATCODE_API_KEY is not set. Add it to .env, or use demo mode (--demo).');
  }
  const body = {
    model: config.model,
    messages,
    // BharatCode counts reasoning toward this limit; the API maximum is 32000.
    max_tokens: Math.min(maxTokens, 32000),
    temperature: 0.2,
  };
  if (reasoningEffort) body.reasoning_effort = reasoningEffort;

  for (let attempt = 0; ; attempt++) {
    let res;
    try {
      res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err.name === 'TimeoutError') throw new Error(`BharatCode API did not answer within ${timeoutMs / 1000}s (the queue may be busy). Try again.`);
      throw new Error(`Could not reach BharatCode API: ${err.cause?.code || err.message}`);
    }
    // 503 = model busy: wait and retry, as the BharatCode docs advise.
    if (res.status === 503 && attempt < retries) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const id = res.headers.get('x-request-id');
      const hint = res.status === 401 || res.status === 403 ? ' Check your key and that your account has API access.' : '';
      throw new Error(`BharatCode API ${res.status}${id ? ` (request ${id})` : ''}: ${text.slice(0, 300)}${hint}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      truncated: choice?.finish_reason === 'length',
    };
  }
}

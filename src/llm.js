// LLM client for any OpenAI-compatible Chat Completions API (BharatCode by default).
import { config } from './env.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Send a chat request to the configured provider.
 * @param {Array} messages
 * @param {{maxTokens?: number, reasoningEffort?: string, retries?: number, timeoutMs?: number}} opts
 * @returns {Promise<{text: string, truncated: boolean}>}
 */
export async function chat(messages, { maxTokens = 16000, reasoningEffort, retries = 3, timeoutMs = 180_000 } = {}) {
  if (!config.apiKey) {
    throw new Error(`${config.keyVar} is not set. Add it to .env, or use demo mode (--demo).`);
  }
  // BharatCode counts reasoning toward max_tokens and allows up to 32000.
  // Other providers often cap output lower, so stay at 8192 unless LLM_MAX_TOKENS says otherwise.
  const cap = Number(process.env.LLM_MAX_TOKENS) || (config.provider === 'bharatcode' ? 32000 : 8192);
  const body = {
    model: config.model,
    messages,
    max_tokens: Math.min(maxTokens, cap),
    temperature: 0.2,
  };
  if (reasoningEffort && config.supportsReasoningNone) body.reasoning_effort = reasoningEffort;

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
      if (err.name === 'TimeoutError') throw new Error(`${config.providerLabel} API did not answer within ${timeoutMs / 1000}s (the queue may be busy). Try again.`);
      throw new Error(`Could not reach ${config.providerLabel} API: ${err.cause?.code || err.message}`);
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
      throw new Error(`${config.providerLabel} API ${res.status}${id ? ` (request ${id})` : ''}: ${text.slice(0, 300)}${hint}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0];
    return {
      text: choice?.message?.content ?? '',
      truncated: choice?.finish_reason === 'length',
    };
  }
}

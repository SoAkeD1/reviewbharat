// Tiny .env loader (no dependencies). Real environment variables win.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

try {
  for (const line of readFileSync(join(root, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (val && process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
} catch {
  /* no .env file: fine, demo mode or real env vars */
}

// Any OpenAI-compatible Chat Completions endpoint works. BharatCode is the default.
// Model names change over time: override with LLM_MODEL if a default is retired.
export const PROVIDERS = {
  bharatcode: { label: 'BharatCode', baseUrl: 'https://bharatcode.ai/api/model/v1', model: 'qwen-3.8-27b', keyVar: 'BHARATCODE_API_KEY', reasoningNone: true },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'qwen/qwen3.8-27b', keyVar: 'GROQ_API_KEY' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash', keyVar: 'GEMINI_API_KEY' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-chat-v3-0324:free', keyVar: 'OPENROUTER_API_KEY' },
  custom: { label: 'Custom', baseUrl: '', model: '', keyVar: 'LLM_API_KEY' },
};

const env = process.env;
const providerName = (env.LLM_PROVIDER || 'bharatcode').toLowerCase();
if (!PROVIDERS[providerName]) {
  console.error(`Error: unknown LLM_PROVIDER "${env.LLM_PROVIDER}". Use one of: ${Object.keys(PROVIDERS).join(', ')}.`);
  process.exit(1);
}
const p = PROVIDERS[providerName];

export const config = {
  provider: providerName,
  providerLabel: p.label,
  apiKey: env.LLM_API_KEY || env[p.keyVar] || '',
  keyVar: p.keyVar,
  // BHARATCODE_BASE_URL / BHARATCODE_MODEL kept for backwards compatibility.
  baseUrl: (env.LLM_BASE_URL || (providerName === 'bharatcode' && env.BHARATCODE_BASE_URL) || p.baseUrl).replace(/\/$/, ''),
  model: env.LLM_MODEL || (providerName === 'bharatcode' && env.BHARATCODE_MODEL) || p.model,
  // Only BharatCode documents reasoning_effort:"none"; other providers may reject unknown values.
  supportsReasoningNone: Boolean(p.reasoningNone),
  githubToken: env.GITHUB_TOKEN || '',
  port: Number(env.PORT || 3000),
};

if (config.apiKey && (!config.baseUrl || !config.model)) {
  console.error('Error: LLM_PROVIDER=custom needs LLM_BASE_URL and LLM_MODEL in .env.');
  process.exit(1);
}

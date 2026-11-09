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

export const config = {
  apiKey: process.env.BHARATCODE_API_KEY || '',
  baseUrl: (process.env.BHARATCODE_BASE_URL || 'https://bharatcode.ai/api/model/v1').replace(/\/$/, ''),
  model: process.env.BHARATCODE_MODEL || 'qwen-3.8-27b',
  githubToken: process.env.GITHUB_TOKEN || '',
  port: Number(process.env.PORT || 3000),
};

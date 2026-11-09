import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config } from './env.js';
import { fetchPrDiff } from './github.js';
import { reviewDiff, demoReview, LANGS } from './review.js';

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html'));
const MAX_BODY = 2_000_000;
// Local tool by default: your API key and GITHUB_TOKEN are used for every request,
// so only listen on this machine unless HOST is set explicitly.
const HOST = process.env.HOST || '127.0.0.1';

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let over = false;
    req.on('data', (c) => {
      if (over) return;
      data += c;
      if (data.length > MAX_BODY) { over = true; reject(new HttpError(413, 'Diff too large (limit 2 MB).')); }
    });
    req.on('end', () => !over && resolve(data));
    req.on('error', reject);
  });
}

const send = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  try {
    if (req.method === 'GET' && path === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
      return res.end(html);
    }
    if (req.method === 'GET' && path === '/api/status') {
      return send(res, 200, { live: Boolean(config.apiKey), model: config.model, provider: config.providerLabel });
    }
    if (req.method === 'POST' && path === '/api/review') {
      let input;
      try { input = JSON.parse((await readBody(req)) || '{}'); } catch (e) {
        if (e instanceof HttpError) throw e;
        throw new HttpError(400, 'Request body must be JSON.');
      }
      const { url, diff, demo } = input;
      const lang = LANGS.includes(input.lang) ? input.lang : 'en';
      let text = typeof diff === 'string' ? diff : '';
      if (!text.trim() && url) text = (await fetchPrDiff(url)).diff;
      if (!text.trim()) throw new HttpError(400, 'Provide a PR URL or paste a diff.');
      const useDemo = demo || !config.apiKey;
      return send(res, 200, useDemo ? demoReview(text, { lang }) : await reviewDiff(text, { lang }));
    }
    send(res, 404, { error: 'Not found' });
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message });
    if (e.status === 413) req.destroy();
  }
}).listen(config.port, HOST, () => console.log(`ReviewBharat running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${config.port}`));

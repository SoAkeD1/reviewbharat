// GitHub REST helpers: fetch PR diffs, post review comments.
import { config } from './env.js';

const API = () => (process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/$/, '');

export function parsePrUrl(input) {
  const m = String(input).trim().match(/^https?:\/\/(?:www\.)?github\.com\/([^/\s]+)\/([^/\s]+)\/pull\/(\d+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/, ''), number: Number(m[3]) };
}

function headers(extra = {}, token = config.githubToken) {
  const h = { 'User-Agent': 'reviewbharat', 'X-GitHub-Api-Version': '2022-11-28', ...extra };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function explain(res) {
  if (res.status === 404) return 'PR not found (or private: set GITHUB_TOKEN).';
  if (res.status === 406) return 'GitHub cannot produce a diff for this PR (it is too large). Review it locally with `git diff`.';
  if (res.status === 429 || (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0')) {
    return 'GitHub rate limit hit. Set GITHUB_TOKEN in .env and retry.';
  }
  if (res.status === 401 || res.status === 403) return `GitHub refused access (${res.status}). Check GITHUB_TOKEN permissions.`;
  return `GitHub returned ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`;
}

export async function fetchDiff(owner, repo, number, token) {
  const res = await fetch(`${API()}/repos/${owner}/${repo}/pulls/${number}`, {
    headers: headers({ Accept: 'application/vnd.github.v3.diff' }, token),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(await explain(res));
  return res.text();
}

export async function fetchPrDiff(url) {
  const pr = parsePrUrl(url);
  if (!pr) throw new Error('Not a GitHub pull request URL (expected https://github.com/owner/repo/pull/123).');
  return { ...pr, diff: await fetchDiff(pr.owner, pr.repo, pr.number) };
}

const MARKER = '<!-- reviewbharat -->';

/** Create the ReviewBharat comment on a PR, or update it if one already exists. */
export async function upsertPrComment(owner, repo, number, body, token) {
  const h = headers({ Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }, token);
  const full = `${MARKER}\n${body}`;
  const list = await fetch(`${API()}/repos/${owner}/${repo}/issues/${number}/comments?per_page=100`, { headers: h });
  if (!list.ok) throw new Error(await explain(list));
  const existing = (await list.json()).find((c) => typeof c.body === 'string' && c.body.startsWith(MARKER));
  const res = existing
    ? await fetch(`${API()}/repos/${owner}/${repo}/issues/comments/${existing.id}`, { method: 'PATCH', headers: h, body: JSON.stringify({ body: full }) })
    : await fetch(`${API()}/repos/${owner}/${repo}/issues/${number}/comments`, { method: 'POST', headers: h, body: JSON.stringify({ body: full }) });
  if (!res.ok) throw new Error(await explain(res));
  return { updated: Boolean(existing), url: (await res.json()).html_url };
}

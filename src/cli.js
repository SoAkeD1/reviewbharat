#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { config } from './env.js';
import { fetchPrDiff } from './github.js';
import { reviewDiff, demoReview, renderMarkdown, meetsThreshold, SEVERITIES, LANGS } from './review.js';

const help = `ReviewBharat: AI code review built on the BharatCode API (or any OpenAI-compatible API)
Provider: set LLM_PROVIDER=bharatcode|groq|gemini|openrouter|custom in .env

Usage:
  reviewbharat <github-pr-url>        review a pull request
  reviewbharat <file.diff>            review a diff file
  git diff | reviewbharat -           review a diff from stdin
  reviewbharat --staged               review staged changes (git diff --staged)
  reviewbharat --local                review all uncommitted changes (git diff HEAD)
  reviewbharat --install-hook         add a git pre-commit hook to the current repo

Options:
  --demo                 offline pattern checks, no API key needed
  --lang en|hinglish|hi  language for explanations (default en)
  --fail-on <severity>   exit with code 2 if a finding is at or above:
                         ${SEVERITIES.join(', ')}
  --json                 machine-readable output
`;

function parseArgs(argv) {
  const opts = { demo: false, json: false, staged: false, local: false, installHook: false, help: false, lang: 'en', failOn: null, target: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--demo') opts.demo = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--staged') opts.staged = true;
    else if (a === '--local') opts.local = true;
    else if (a === '--install-hook') opts.installHook = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--lang') opts.lang = argv[++i];
    else if (a === '--fail-on') opts.failOn = argv[++i];
    else if (a.startsWith('--')) throw new Error(`Unknown option ${a}. Run with --help.`);
    else opts.target = a;
  }
  if (!LANGS.includes(opts.lang)) throw new Error(`--lang must be one of: ${LANGS.join(', ')}`);
  if (opts.failOn && !SEVERITIES.includes(opts.failOn)) throw new Error(`--fail-on must be one of: ${SEVERITIES.join(', ')}`);
  return opts;
}

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });

function installHook() {
  const gitDir = git(['rev-parse', '--git-dir']).trim();
  const hookPath = join(gitDir, 'hooks', 'pre-commit');
  if (existsSync(hookPath)) throw new Error(`${hookPath} already exists; not overwriting it.`);
  const cli = fileURLToPath(import.meta.url).replace(/\\/g, '/');
  writeFileSync(hookPath, `#!/bin/sh\n# ReviewBharat: block commits with critical findings. Skip once with: git commit --no-verify\nnode "${cli}" --staged --fail-on critical\n`);
  try { chmodSync(hookPath, 0o755); } catch { /* Windows: git runs it via sh anyway */ }
  console.log(`Installed pre-commit hook at ${hookPath}`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || (!opts.target && !opts.staged && !opts.local && !opts.installHook)) return console.log(help);
  if (opts.installHook) return installHook();

  let diff;
  if (opts.staged) diff = git(['diff', '--staged']);
  else if (opts.local) diff = git(['diff', 'HEAD']);
  else if (opts.target === '-') diff = await readStdin();
  else if (/^https?:\/\//.test(opts.target)) diff = (await fetchPrDiff(opts.target)).diff;
  else diff = readFileSync(opts.target, 'utf8');

  if (!diff.trim()) {
    console.log(opts.staged ? 'Nothing staged to review.' : 'No changes to review.');
    return;
  }
  const demo = opts.demo || !config.apiKey;
  if (demo && !opts.demo && !opts.json) console.error(`No ${config.keyVar} set: running in demo mode (offline checks).\n`);
  const result = demo ? demoReview(diff, { lang: opts.lang }) : await reviewDiff(diff, { lang: opts.lang });
  console.log(opts.json ? JSON.stringify(result, null, 2) : renderMarkdown(result));
  if (opts.failOn && meetsThreshold(result.findings, opts.failOn)) {
    console.error(`\nReviewBharat: found ${opts.failOn}-or-worse issues.`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exitCode = 1;
});

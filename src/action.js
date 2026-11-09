// GitHub Action entry point: review the current pull request and post the result as a comment.
import { readFileSync, appendFileSync } from 'node:fs';
import { config } from './env.js';
import { fetchDiff, upsertPrComment } from './github.js';
import { reviewDiff, demoReview, renderMarkdown, meetsThreshold, LANGS, SEVERITIES } from './review.js';

const input = (name) => (process.env[`INPUT_${name.toUpperCase()}`] || '').trim();

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (!pr) {
    console.log('Not a pull_request event; nothing to review.');
    return;
  }
  const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');
  const token = input('github_token') || process.env.GITHUB_TOKEN || '';
  const lang = LANGS.includes(input('lang')) ? input('lang') : 'en';
  const failOn = SEVERITIES.includes(input('fail_on')) ? input('fail_on') : null;

  const diff = await fetchDiff(owner, repo, pr.number, token);
  const live = Boolean(config.apiKey);
  if (!live) console.log('::warning::No BharatCode API key (secret not set, or a fork PR): running demo mode checks only.');
  const result = live ? await reviewDiff(diff, { lang }) : demoReview(diff, { lang });
  const body = renderMarkdown(result);

  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, body + '\n');
  try {
    const { updated, url } = await upsertPrComment(owner, repo, pr.number, body, token);
    console.log(`${updated ? 'Updated' : 'Posted'} review comment: ${url}`);
  } catch (e) {
    // Fork PRs get a read-only token; the review is still in the job summary.
    console.log(`::warning::Could not post the PR comment (${e.message}). The review is in the job summary.`);
  }
  console.log(`${result.findings.length} finding(s).`);
  if (failOn && meetsThreshold(result.findings, failOn)) {
    console.log(`::error::ReviewBharat found ${failOn}-or-worse issues.`);
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.log(`::error::ReviewBharat failed: ${e.message}`);
  process.exitCode = 1;
});

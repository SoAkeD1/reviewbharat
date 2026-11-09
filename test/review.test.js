import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  splitDiffByFile, chunkFiles, splitLargePatch, parseModelJson, demoReview, renderMarkdown, meetsThreshold, systemPrompt,
} from '../src/review.js';
import { parsePrUrl } from '../src/github.js';

const sample = readFileSync(new URL('../examples/sample.diff', import.meta.url), 'utf8');
const titles = (r) => r.findings.map((f) => f.title);

test('splits a diff per file', () => {
  assert.deepEqual(splitDiffByFile(sample).map((f) => f.file), ['app/db.py', 'web/calc.js']);
});

test('handles CRLF diffs', () => {
  const r = demoReview(sample.replace(/\n/g, '\r\n'));
  assert.deepEqual(r.files, ['app/db.py', 'web/calc.js']);
  assert.equal(r.findings.find((f) => f.title === 'Hard-coded secret').line, 13);
});

test('chunks several files', () => {
  const big = [{ file: 'a', patch: 'x'.repeat(100) }, { file: 'b', patch: 'y'.repeat(100) }];
  assert.equal(chunkFiles(big, 150).length, 2);
});

test('splits one huge file at hunk boundaries instead of dropping the end', () => {
  const hunk = (n) => `@@ -${n},1 +${n},2 @@\n ctx\n+${'z'.repeat(80)}\n`;
  const patch = 'diff --git a/f b/f\n--- a/f\n+++ b/f\n' + [1, 10, 20, 30, 40].map(hunk).join('');
  const { pieces, partial } = splitLargePatch('f', patch, 250);
  assert.equal(partial, false);
  assert.ok(pieces.length > 1);
  assert.ok(pieces.every((p) => p.startsWith('diff --git') && p.length <= 250));
  assert.equal(pieces.join('').match(/^@@/gm).length, 5);
});

test('parses model JSON with fences and think blocks', () => {
  const r = parseModelJson('<think>hmm</think>```json\n{"summary":"s","findings":[{"file":"a.js","line":"7","severity":"HIGH","title":"Bug"},{"nope":1}]}\n```');
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].line, 7);
  assert.equal(r.findings[0].severity, 'high');
});

test('parses JSON followed by prose containing braces', () => {
  const r = parseModelJson('{"summary":"s","findings":[{"title":"t"}]} Hope this helps {:)}');
  assert.equal(r.findings.length, 1);
});

test('parses JSON after an unclosed or stray think block', () => {
  assert.equal(parseModelJson('<think>{"bad": true}\n{"summary":"ok","findings":[]}').summary, 'ok');
  assert.equal(parseModelJson('reasoning...</think>{"summary":"ok2","findings":[]}').summary, 'ok2');
});

test('normalises odd severities and line numbers', () => {
  const r = parseModelJson('{"findings":[{"title":"a","severity":"Critical!","line":"12-14"},{"title":"b","line":0}]}');
  assert.equal(r.findings[0].severity, 'critical');
  assert.equal(r.findings[0].line, 12);
  assert.equal(r.findings[1].line, null);
});

test('rejects non-JSON model output', () => {
  assert.throws(() => parseModelJson('sorry, no'));
  assert.throws(() => parseModelJson(null));
});

test('demo review finds secrets, SQL injection, eval and bare except with line numbers', () => {
  const r = demoReview(sample);
  for (const t of ['Hard-coded secret', 'Possible SQL injection', 'Use of eval()', 'Swallowed or bare exception']) {
    assert.ok(titles(r).includes(t), t);
  }
  assert.equal(r.findings.find((f) => f.title === 'Hard-coded secret').line, 13);
  assert.equal(r.findings.find((f) => f.title === 'Use of eval()').line, 4);
});

test('demo review ignores docs, placeholders and deleted lines', () => {
  const docs = 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -1,1 +1,2 @@\n x\n+token = "abcdefghijk"\n';
  assert.equal(demoReview(docs).findings.length, 0);
  const placeholder = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,1 +1,2 @@\n x\n+const token = "<your token here>"\n';
  assert.equal(demoReview(placeholder).findings.length, 0);
  const deleted = 'diff --git a/g.js b/g.js\n--- a/g.js\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-eval(x)\n';
  assert.equal(demoReview(deleted).findings.length, 0);
});

test('"No newline at end of file" marker does not shift line numbers', () => {
  const d = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,2 +1,2 @@\n one\n-two\n\\ No newline at end of file\n+eval(two)\n\\ No newline at end of file\n';
  assert.equal(demoReview(d).findings[0].line, 2);
});

test('Hinglish demo explanations', () => {
  const r = demoReview(sample, { lang: 'hinglish' });
  assert.match(r.findings.find((f) => f.title === 'Possible SQL injection').explanation, /SQL injection ho sakta hai/);
});

test('system prompt asks for the chosen language', () => {
  assert.match(systemPrompt('hinglish'), /Hinglish/);
  assert.match(systemPrompt('hi'), /Devanagari/);
  assert.doesNotMatch(systemPrompt('en'), /Hinglish/);
});

test('severity threshold for --fail-on', () => {
  const f = [{ severity: 'medium' }];
  assert.equal(meetsThreshold(f, 'high'), false);
  assert.equal(meetsThreshold(f, 'medium'), true);
  assert.equal(meetsThreshold(f, 'low'), true);
});

test('markdown output includes counts and footer', () => {
  const md = renderMarkdown(demoReview(sample));
  assert.match(md, /finding\(s\)/);
  assert.match(md, /Demo mode/);
});

test('parses PR URLs and rejects other hosts', () => {
  assert.deepEqual(parsePrUrl('https://github.com/a/b/pull/42/files'), { owner: 'a', repo: 'b', number: 42 });
  assert.equal(parsePrUrl('https://evil.com/github.com/a/b/pull/1'), null);
  assert.equal(parsePrUrl('https://example.com'), null);
});

// Core review logic: split diff, ask the model, parse, render.
import { chat } from './llm.js';
import { config } from './env.js';

const MAX_CHARS_PER_CHUNK = 24000;
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'nit'];
export const LANGS = ['en', 'hinglish', 'hi'];

// ---------- Diff handling ----------

export function splitDiffByFile(diff) {
  const parts = String(diff).replace(/\r\n/g, '\n').split(/^(?=diff --git )/m).filter((p) => p.trim());
  return parts.map((patch) => {
    const m = patch.match(/^diff --git a\/(.+?) b\/(.+)$/m);
    return { file: m ? m[2] : 'unknown', patch };
  });
}

/** Split one file's patch into pieces of at most `max` chars, cutting at hunk boundaries. */
export function splitLargePatch(file, patch, max) {
  if (patch.length <= max) return { pieces: [patch], partial: false };
  const firstHunk = patch.search(/^@@ /m);
  const header = firstHunk === -1 ? patch.slice(0, 500) : patch.slice(0, firstHunk);
  const hunks = firstHunk === -1 ? [] : patch.slice(firstHunk).split(/^(?=@@ )/m);
  const pieces = [];
  let cur = '';
  let partial = firstHunk === -1;
  for (let h of hunks) {
    const room = max - header.length;
    if (h.length > room) {
      h = h.slice(0, room - 40) + '\n[... hunk truncated ...]\n';
      partial = true;
    }
    if (cur && cur.length + h.length > room) {
      pieces.push(header + cur);
      cur = '';
    }
    cur += h;
  }
  if (cur) pieces.push(header + cur);
  if (!pieces.length) pieces.push(header);
  return { pieces, partial };
}

export function chunkFiles(files, max = MAX_CHARS_PER_CHUNK) {
  const chunks = [];
  const partialFiles = [];
  let cur = [];
  let size = 0;
  for (const f of files) {
    const { pieces, partial } = splitLargePatch(f.file, f.patch, max);
    if (partial) partialFiles.push(f.file);
    for (const patch of pieces) {
      if (size + patch.length > max && cur.length) {
        chunks.push(cur);
        cur = [];
        size = 0;
      }
      cur.push({ file: f.file, patch });
      size += patch.length;
    }
  }
  if (cur.length) chunks.push(cur);
  chunks.partialFiles = partialFiles;
  return chunks;
}

// ---------- Model prompt and output parsing ----------

const LANG_NOTE = {
  en: '',
  hinglish: '\nWrite "summary", "title", "explanation" and "suggestion" in Hinglish: Hindi written in Latin script, mixed naturally with English technical terms, the way Indian developers talk (e.g. "Yahan user input seedha SQL query mein ja raha hai, isse SQL injection ho sakta hai."). Keep code and identifiers in English.',
  hi: '\nWrite "summary", "title", "explanation" and "suggestion" in Hindi (Devanagari script). Keep code, identifiers and technical terms like SQL or API in English.',
};

export function systemPrompt(lang = 'en') {
  return `You are a senior software engineer doing a code review of a pull request diff.
Only comment on lines that were added or changed. Focus on: real bugs, security problems, missing error handling, performance traps, and unclear code. Skip praise and trivia.
Respond with ONLY a JSON object, no markdown fences, in this shape:
{"summary":"1-2 sentences on what the change does","findings":[{"file":"path","line":123,"severity":"critical|high|medium|low|nit","title":"short title","explanation":"why it is a problem","suggestion":"how to fix it, with a short code snippet if useful"}]}
If you find no problems, return an empty findings array. "line" is the line number in the new file when you can tell, otherwise null.${LANG_NOTE[lang] ?? ''}`;
}

/** Yield every balanced {...} substring that starts at depth 0, respecting JSON strings. */
function* jsonObjectCandidates(s) {
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"' && depth > 0) inStr = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}' && depth > 0) {
      depth--;
      if (depth === 0) yield s.slice(start, i + 1);
    }
  }
}

function normalise(obj) {
  const list = Array.isArray(obj) ? obj : Array.isArray(obj.findings) ? obj.findings : [];
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : '',
    findings: list
      .filter((f) => f && typeof f === 'object' && f.title)
      .map((f) => {
        const sev = String(f.severity ?? '').toLowerCase().replace(/[^a-z]/g, '');
        const line = Number.parseInt(f.line, 10);
        return {
          file: String(f.file ?? 'unknown'),
          line: Number.isFinite(line) && line > 0 ? line : null,
          severity: SEVERITIES.includes(sev) ? sev : 'medium',
          title: String(f.title),
          explanation: String(f.explanation ?? ''),
          suggestion: String(f.suggestion ?? ''),
        };
      }),
  };
}

export function parseModelJson(text) {
  let s = String(text ?? '');
  // Drop reasoning blocks; if one is left unclosed, keep only what follows the last </think>.
  s = s.replace(/<think>[\s\S]*?<\/think>/g, '');
  const lastClose = s.lastIndexOf('</think>');
  if (lastClose !== -1) s = s.slice(lastClose + 8);
  s = s.trim();

  // 1) The whole thing (after stripping fences) may already be valid JSON.
  const unfenced = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  try {
    const obj = JSON.parse(unfenced);
    if (obj && typeof obj === 'object') return normalise(obj);
  } catch { /* fall through */ }

  // 2) Otherwise look for the first balanced object that looks like a review.
  let fallback = null;
  for (const cand of jsonObjectCandidates(s)) {
    try {
      const obj = JSON.parse(cand);
      if (obj && ('findings' in obj || 'summary' in obj)) return normalise(obj);
      fallback ??= obj;
    } catch { /* try the next candidate */ }
  }
  if (fallback) return normalise(fallback);
  throw new Error('Model did not return JSON.');
}

async function reviewChunk(chunk, lang) {
  const body = chunk.map((f) => f.patch).join('\n');
  const base = [
    { role: 'system', content: systemPrompt(lang) },
    { role: 'user', content: `Review this diff:\n\n${body}` },
  ];

  let reply = await chat(base, { maxTokens: 16000 });
  // Output cut short: don't retry the same exhausted budget (per BharatCode docs).
  // Retry once with the maximum budget and reasoning switched off.
  if (reply.truncated) {
    reply = await chat(base, { maxTokens: 32000, reasoningEffort: 'none' });
    if (reply.truncated) {
      try { return parseModelJson(reply.text); } catch {
        throw new Error('The model ran out of output tokens on this diff. Try reviewing fewer files at once.');
      }
    }
  }
  try {
    return parseModelJson(reply.text);
  } catch (err) {
    // Complete but malformed answer: ask once for clean JSON only.
    const repair = await chat(
      [...base, { role: 'assistant', content: reply.text }, { role: 'user', content: 'That was not valid JSON. Reply with ONLY the JSON object.' }],
      { maxTokens: 16000, reasoningEffort: 'none' },
    );
    try {
      return parseModelJson(repair.text);
    } catch {
      throw new Error(`Could not parse model output: ${err.message}`);
    }
  }
}

export async function reviewDiff(diff, { lang = 'en' } = {}) {
  if (!diff || !diff.trim()) throw new Error('Empty diff.');
  const files = splitDiffByFile(diff);
  if (!files.some((f) => /^(\+\+\+|---|@@|Binary files)/m.test(f.patch))) {
    throw new Error('This does not look like a unified diff (expected output of `git diff`).');
  }
  const chunks = chunkFiles(files);
  const summaries = [];
  const findings = [];
  for (const chunk of chunks) {
    const r = await reviewChunk(chunk, lang);
    if (r.summary) summaries.push(r.summary);
    findings.push(...r.findings);
  }
  sortFindings(findings);
  return { summary: summaries.join(' '), findings, files: files.map((f) => f.file), partialFiles: chunks.partialFiles, lang, provider: config.providerLabel, model: config.model };
}

export function sortFindings(findings) {
  return findings.sort((a, b) => SEVERITIES.indexOf(a.severity) - SEVERITIES.indexOf(b.severity));
}

/** True when any finding is at or above the given severity (for CI / pre-commit gates). */
export function meetsThreshold(findings, failOn) {
  const limit = SEVERITIES.indexOf(failOn);
  if (limit === -1) return false;
  return findings.some((f) => SEVERITIES.indexOf(f.severity) <= limit);
}

// ---------- Demo mode: offline heuristic reviewer, no model involved ----------

const DOC_FILES = /\.(md|mdx|markdown|txt|rst|adoc|lock)$|(^|\/)(LICENSE|CHANGELOG)[^/]*$/i;

const DEMO_RULES = [
  {
    re: /\beval\s*\(/, severity: 'critical', title: 'Use of eval()',
    en: ['eval executes arbitrary code and is a common injection vector.', 'Parse the data (e.g. JSON.parse) instead of evaluating it.'],
    hinglish: ['eval() koi bhi code run kar deta hai, isse code injection ka khatra hai.', 'Data ko eval mat karo, JSON.parse jaisa parser use karo.'],
  },
  {
    re: /(api[_-]?key|secret|password|passwd|token)\w*["']?\s*[:=]\s*["'](?![^"']*(your|<|xxx|\*\*\*|example|changeme|placeholder))[^"'\s]{6,}["']/i,
    severity: 'critical', title: 'Hard-coded secret',
    en: ['Credentials committed to the repo are exposed to everyone with access and live in git history.', 'Read it from an environment variable and rotate the leaked value.'],
    hinglish: ['Secret seedha code mein likha hai; repo dekhne wala har koi ise padh sakta hai aur yeh git history mein reh jaata hai.', 'Environment variable se padho aur leaked secret ko turant rotate karo.'],
  },
  {
    re: /["'`]\s*(SELECT|INSERT|UPDATE|DELETE)\b[^;\n]*(["'`]\s*\+|\$\{|%s|\{\w*\})/i, severity: 'high', title: 'Possible SQL injection',
    en: ['SQL built by string concatenation/interpolation can be exploited.', 'Use parameterised queries / prepared statements.'],
    hinglish: ['User input seedha SQL string mein jod rahe ho, isse SQL injection ho sakta hai.', 'Parameterised query use karo, jaise execute("... WHERE name = ?", (name,)).'],
  },
  {
    re: /catch\s*\([^)]*\)\s*\{\s*\}|except\s*:\s*pass|^\s*except\s*:\s*$/, severity: 'medium', title: 'Swallowed or bare exception',
    en: ['An empty or bare catch hides failures (even KeyboardInterrupt in Python) and makes bugs hard to find.', 'Catch the specific exception and log or handle it.'],
    hinglish: ['Khaali ya bare except error ko chhupa deta hai, phir bug dhoondhna mushkil ho jaata hai.', 'Specific exception pakdo aur use log ya handle karo.'],
  },
  {
    re: /console\.log\(|^\s*print\(/, severity: 'nit', title: 'Debug output left in',
    en: ['Stray logging adds noise in production.', 'Remove it or use a proper logger.'],
    hinglish: ['Debug print production mein noise badhata hai.', 'Ise hatao ya proper logger use karo.'],
  },
  {
    re: /\b(TODO|FIXME|XXX)\b/, severity: 'low', title: 'Unresolved TODO',
    en: ['Unfinished work is being merged.', 'Finish it or open a tracked issue.'],
    hinglish: ['Adhoora kaam merge ho raha hai.', 'Ise poora karo ya ek issue bana do.'],
  },
];

export function demoReview(diff, { lang = 'en' } = {}) {
  const files = splitDiffByFile(diff);
  const findings = [];
  const textLang = lang === 'en' ? 'en' : 'hinglish'; // demo rules ship in English and Hinglish
  for (const f of files) {
    if (DOC_FILES.test(f.file)) continue;
    let line = 0;
    for (const raw of f.patch.split('\n')) {
      const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (hunk) { line = Number(hunk[1]) - 1; continue; }
      if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('\\')) continue;
      if (raw.startsWith('+')) {
        line++;
        const code = raw.slice(1);
        for (const rule of DEMO_RULES) {
          if (rule.re.test(code)) {
            const [explanation, suggestion] = rule[textLang];
            findings.push({ file: f.file, line, severity: rule.severity, title: rule.title, explanation, suggestion });
          }
        }
      } else if (!raw.startsWith('-')) line++;
    }
  }
  sortFindings(findings);
  return {
    summary: `Demo mode (offline pattern checks, no AI model). Scanned ${files.length} file(s).`,
    findings,
    files: files.map((f) => f.file),
    demo: true,
    lang: textLang,
  };
}

// ---------- Output ----------

export function renderMarkdown(r) {
  const out = ['## ReviewBharat code review\n'];
  if (r.summary) out.push(`${r.summary}\n`);
  const counts = SEVERITIES.map((s) => [s, r.findings.filter((f) => f.severity === s).length]).filter(([, n]) => n);
  out.push(`**${r.findings.length} finding(s)** across ${r.files.length} file(s)${counts.length ? ': ' + counts.map(([s, n]) => `${n} ${s}`).join(', ') : ''}.\n`);
  if (r.partialFiles?.length) out.push(`> **Note:** very large diff, only part of ${r.partialFiles.map((f) => `\`${f}\``).join(', ')} was reviewed.\n`);
  if (!r.findings.length) out.push('No problems found.\n');
  for (const f of r.findings) {
    out.push(`### [${f.severity.toUpperCase()}] ${f.title}\n\`${f.file}${f.line ? ':' + f.line : ''}\`\n`);
    if (f.explanation) out.push(`${f.explanation}\n`);
    if (f.suggestion) out.push(`**Suggestion:** ${f.suggestion}\n`);
  }
  out.push(`\n<sub>${r.demo ? 'Demo mode: offline pattern checks.' : `Reviewed by ${r.model || 'an AI model'} via the ${r.provider || 'BharatCode'} API.`} Generated by [ReviewBharat](https://github.com/SoAkeD1/reviewbharat).</sub>`);
  return out.join('\n');
}

# ReviewBharat 🔍

**AI code review for every pull request, in English, Hinglish or Hindi.**
Built on the [BharatCode](https://bharatcode.ai) model API for the BharatCode Build League.

Point it at a GitHub PR, a `.diff` file, or your staged changes. ReviewBharat asks the model for a
review and returns findings ranked **critical → nit**, each with file, line, a plain explanation and
a suggested fix. Run it as a **GitHub Action**, a **CLI**, a **pre-commit hook**, or a **web UI**.

Real AI review of [`examples/sample.diff`](examples/sample.diff) by **Qwen 3.8 27B** (the same model BharatCode serves), in about 1.3 seconds:

```text
## 🔍 ReviewBharat code review
Adds a hardcoded API key and a vulnerable user lookup function to the database module,
and introduces a dangerous eval-based execution function in the calculator module.

**4 finding(s)** across 2 file(s): 3 critical, 1 medium.

### 🛑 SQL Injection
`app/db.py:16` · critical
The query is constructed via string concatenation, allowing attackers to inject arbitrary
SQL commands through the `name` parameter.
**Suggestion:** Use parameterized queries:
`cur = conn.execute("SELECT * FROM users WHERE name = ?", (name,))`.
...
```

The same review in Hinglish (`--lang hinglish`):

```text
### 🛑 SQL Injection vulnerability
`app/db.py:14` · critical
Yahan user input `name` seedha string concatenation se SQL query mein ja raha hai. Isse attacker
database mein arbitrary queries chalwa sakta hai, jaise data delete karna ya sensitive data leak karna.
**Suggestion:** Parameterized queries use karo.
```

Full outputs: [English](examples/sample-review.md) · [Hinglish](examples/sample-review-hinglish.md)

## Try it in 30 seconds (no API key needed)

```bash
git clone https://github.com/SoAkeD1/reviewbharat
cd reviewbharat
npm run demo          # reviews examples/sample.diff
npm start             # web UI at http://localhost:3000 → "Load sample diff" → Review
```

Without a key, ReviewBharat runs **demo mode**: fast offline pattern checks (hard-coded secrets,
SQL injection, `eval`, swallowed exceptions, debug output, TODOs). With a key, every review comes from
the BharatCode model and covers real logic bugs too.

## Features

| | |
|---|---|
| 🤖 **GitHub Action** | Reviews every PR and posts (then updates) one tidy comment. Optional `fail_on` gate for CI. |
| 🇮🇳 **Hinglish / Hindi** | `--lang hinglish` or `--lang hi`: explanations the way Indian developers actually talk. |
| ✋ **Pre-commit hook** | `--install-hook` blocks commits that add critical issues. |
| 💻 **CLI** | PR URL, diff file, stdin, `--staged`, `--local`; Markdown or `--json` output. |
| 🌐 **Web UI** | Paste a PR link or diff, pick a language, see colour-coded findings. |
| 🧱 **Robust model handling** | Per-file + per-hunk chunking, busy/rate-limit retry, timeout, truncation handling, JSON repair. |
| 🔌 **Any OpenAI-compatible API** | BharatCode by default; Groq, Gemini, OpenRouter or your own server via `LLM_PROVIDER`. |
| 📦 **Zero dependencies** | Node 20+, nothing to `npm install`. |

## Setup with an API key

ReviewBharat is built for the **BharatCode** API and works with any OpenAI-compatible provider.
Pick one, get a key, and set it in `.env`:

| `LLM_PROVIDER` | Key variable | Default model | Get a key |
|---|---|---|---|
| `bharatcode` (default) | `BHARATCODE_API_KEY` | `qwen-3.8-27b` | <https://bharatcode.ai/account> (free for students) |
| `groq` | `GROQ_API_KEY` | `qwen/qwen3.8-27b` | <https://console.groq.com/keys> (free tier, ~1,000 output tokens/min) |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | <https://aistudio.google.com/apikey> (free tier) |
| `openrouter` | `OPENROUTER_API_KEY` | `deepseek/deepseek-chat-v3-0324:free` | <https://openrouter.ai/keys> |
| `custom` | `LLM_API_KEY` | set `LLM_MODEL` | any OpenAI-compatible server (set `LLM_BASE_URL`) |

```bash
cp .env.example .env        # Windows cmd: copy .env.example .env
# edit .env: set LLM_PROVIDER and that provider's key
```

Model names change over time; override the default with `LLM_MODEL`. `.env` is git-ignored. Never commit your key.

## Usage

```bash
# CLI
node src/cli.js https://github.com/owner/repo/pull/123
node src/cli.js changes.diff --lang hinglish
git diff main | node src/cli.js -
node src/cli.js --staged --fail-on high     # exit code 2 if high-or-worse issues

# Pre-commit hook (run inside your project)
node /path/to/reviewbharat/src/cli.js --install-hook

# Web UI
npm start
```

| Option | Meaning |
|---|---|
| `--demo` | Offline pattern checks, no key needed |
| `--lang en\|hinglish\|hi` | Language for explanations (default `en`) |
| `--fail-on <severity>` | Exit 2 if any finding is at or above `critical/high/medium/low/nit` |
| `--json` | Machine-readable output |
| `--staged` / `--local` | Review `git diff --staged` / `git diff HEAD` |

Set `GITHUB_TOKEN` in `.env` for private repos or higher GitHub rate limits.

## GitHub Action

Add your key as a repository secret named `LLM_API_KEY`, then create
`.github/workflows/reviewbharat.yml`:

```yaml
name: ReviewBharat
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - uses: SoAkeD1/reviewbharat@main
        with:
          provider: bharatcode  # or groq / gemini / openrouter
          api_key: ${{ secrets.LLM_API_KEY }}
          lang: en              # or hinglish / hi
          fail_on: critical   # optional
```

Without the secret (for example on PRs from forks) it falls back to demo checks. The review also
appears in the job summary when the token cannot comment.

## How it works

```text
PR URL / diff / git ──► github.js (fetch diff)
                          │
                          ▼
                     review.js: split per file → per hunk → ≤24k-char chunks
                          │
                          ▼
                     llm.js ──► BharatCode API  POST /chat/completions  (qwen-3.8-27b)
                          │      • 503 / 429 → wait and retry   • 180 s timeout
                          │      • cut-off output → one retry at 32k tokens, reasoning off
                          ▼
                     parse JSON (handles <think>, fences, extra prose) → validate → sort
                          │
                          ▼
              Markdown  ·  JSON  ·  web UI  ·  PR comment  ·  exit code
```

## Limits

- Very large single hunks (over ~24k characters) are reviewed partially; the output says so.
- GitHub cannot return diffs for huge PRs; review those locally with `git diff | node src/cli.js -`.
- Demo mode is pattern matching, not AI; it misses logic bugs and can flag false positives.

## Development

```bash
npm test     # 17 unit tests, no network
```

## License

MIT © 2026 Shrimon Mishra

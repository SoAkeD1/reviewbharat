<div align="center">

# ReviewBharat

**AI code review for every pull request, in English, Hinglish or Hindi.**

Point it at a pull request and get a clear, ranked list of bugs and security issues,
each with the exact file, line and a fix you can paste.

[![Tests](https://github.com/SoAkeD1/reviewbharat/actions/workflows/test.yml/badge.svg)](https://github.com/SoAkeD1/reviewbharat/actions/workflows/test.yml)
![Node 20+](https://img.shields.io/badge/node-20%2B-339933)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-blue)
[![License: MIT](https://img.shields.io/badge/license-MIT-yellow)](LICENSE)
![BharatCode Build League](https://img.shields.io/badge/BharatCode-Build%20League-ff9f43)

[Quick start](#quick-start) · [Screenshots](#screenshots) · [Features](#features) · [Use it your way](#use-it-your-way) · [How it works](#how-it-works)

</div>

---

## Why ReviewBharat

Most student and small-team projects merge code that nobody else has read. Hard-coded secrets,
SQL injection and silent errors slip straight into `main`. Existing AI reviewers are often paid
and only speak English.

ReviewBharat reviews every change automatically and explains each problem the way you would
explain it to a friend, in **English, Hinglish or Hindi**. It is built for the
[BharatCode](https://bharatcode.ai) model API and runs on Qwen 3.8 27B.

## Screenshots

<p align="center">
  <img src="docs/web-ui-english.jpg" alt="ReviewBharat web UI showing an English review with critical findings" width="49%">
  <img src="docs/web-ui-hinglish.jpg" alt="ReviewBharat web UI showing the same review explained in Hinglish" width="49%">
</p>
<p align="center"><sub>The same pull request, reviewed in English (left) and Hinglish (right).</sub></p>

## One finding, three languages

ReviewBharat found an SQL injection in [`examples/sample.diff`](examples/sample.diff). Here is how it explains it:

| Language | Explanation |
|---|---|
| **English** | The `get_user` function constructs the SQL query using string concatenation with the `name` parameter. This allows an attacker to inject arbitrary SQL commands. |
| **Hinglish** | Yahan user input `name` seedha string concatenation se SQL query mein ja raha hai. Isse attacker database mein arbitrary queries chalakar data leak ya corruption kar sakta hai. |
| **Hindi** | यहाँ `name` पैरामीटर को सीधे SQL स्ट्रिंग में जोड़ा गया है, जिससे SQL Injection हमला संभव है। |

Every finding also comes with a fix:

```python
cur = conn.execute("SELECT * FROM users WHERE name = ?", (name,))
```

Full reviews: [English](examples/sample-review.md) · [Hinglish](examples/sample-review-hinglish.md) · [Hindi](examples/sample-review-hindi.md)

## Quick start

Try it in 30 seconds, no API key needed:

```bash
git clone https://github.com/SoAkeD1/reviewbharat
cd reviewbharat
npm run demo
```

Or open the web UI, click **Load sample diff**, then **Review**:

```bash
npm start            # http://localhost:3000
```

Without a key, ReviewBharat runs **demo mode**: quick offline checks for hard-coded secrets,
SQL injection, `eval`, swallowed exceptions, debug output and TODOs. Add a key and every review
comes from the AI model, which also catches logic bugs.

## Features

| | |
|---|---|
| **GitHub Action** | Reviews every pull request and keeps one tidy comment up to date. Can fail the check on serious issues. |
| **Hinglish and Hindi** | `--lang hinglish` or `--lang hi` for explanations in the language you think in. |
| **Pre-commit hook** | Stops a commit that adds a critical issue, before it ever leaves your laptop. |
| **CLI** | Review a PR link, a diff file, piped `git diff`, or your staged changes. Markdown or JSON output. |
| **Web UI** | Paste a link or a diff, pick a language, read colour-coded findings. |
| **Built to be reliable** | Splits large diffs, waits and retries when the API is busy or rate-limited, and recovers from messy model output. |
| **Any provider** | BharatCode by default; Groq, Gemini, OpenRouter or your own OpenAI-compatible server. |
| **Zero dependencies** | Node 20 or newer. Nothing to install. |

## Setup

ReviewBharat is built for the BharatCode API and works with any OpenAI-compatible provider.
Copy the settings file, choose a provider and add its key:

```bash
cp .env.example .env        # Windows cmd: copy .env.example .env
```

| `LLM_PROVIDER` | Key variable | Default model | Status | Get a key |
|---|---|---|---|---|
| `bharatcode` (default) | `BHARATCODE_API_KEY` | `qwen-3.8-27b` | per BharatCode docs | [bharatcode.ai/account](https://bharatcode.ai/account), free for students |
| `groq` | `GROQ_API_KEY` | `qwen/qwen3.8-27b` | tested | [console.groq.com/keys](https://console.groq.com/keys), free tier |
| `gemini` | `GEMINI_API_KEY` | `gemini-2.5-flash` | example, untested | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) |
| `openrouter` | `OPENROUTER_API_KEY` | `deepseek/deepseek-chat-v3-0324:free` | example, untested | [openrouter.ai/keys](https://openrouter.ai/keys) |
| `custom` | `LLM_API_KEY` | set `LLM_MODEL` | | any OpenAI-compatible server, set `LLM_BASE_URL` |

Model names change over time; override any default with `LLM_MODEL`. `.env` is git-ignored, so your
key never leaves your machine.

> The example reviews and screenshots in this README were generated with Qwen 3.8 27B served through
> Groq, because my BharatCode student API access was still pending. Switching to BharatCode is one line:
> `LLM_PROVIDER=bharatcode`.

## Use it your way

### On every pull request (GitHub Action)

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
          provider: bharatcode   # or groq, gemini, openrouter
          api_key: ${{ secrets.LLM_API_KEY }}
          lang: en               # or hinglish, hi
          fail_on: critical      # optional: fail the check on critical findings
```

Without the secret (for example on pull requests from forks) it falls back to demo checks, and the
review is also written to the job summary.

### From the terminal (CLI)

```bash
node src/cli.js https://github.com/owner/repo/pull/123
node src/cli.js changes.diff --lang hinglish
git diff main | node src/cli.js -
node src/cli.js --staged --fail-on high      # exit code 2 if high-or-worse issues
```

| Option | What it does |
|---|---|
| `--lang en\|hinglish\|hi` | Language for explanations (default `en`) |
| `--staged` / `--local` | Review `git diff --staged` / `git diff HEAD` |
| `--fail-on <severity>` | Exit with code 2 at or above `critical`, `high`, `medium`, `low` or `nit` |
| `--json` | Machine-readable output |
| `--demo` | Offline checks only, no key needed |

Set `GITHUB_TOKEN` in `.env` for private repositories or higher GitHub rate limits.

### Before every commit (pre-commit hook)

Run this once inside your own project:

```bash
node /path/to/reviewbharat/src/cli.js --install-hook
```

Commits that add a critical issue are blocked. Skip the check once with `git commit --no-verify`.

### In the browser (web UI)

```bash
npm start
```

Open http://localhost:3000, paste a pull request link or a diff, choose a language and click **Review**.
The server only listens on your own machine.

## How it works

```text
PR link / diff / git
        │
        ▼
github.js ─── fetches the pull request diff
        │
        ▼
review.js ─── splits it by file and hunk into chunks the model can read
        │
        ▼
llm.js ────── POST /chat/completions  (BharatCode API, Qwen 3.8 27B)
        │       waits and retries when busy or rate-limited, 180 s timeout,
        │       retries once with a bigger budget if the answer is cut off
        ▼
parser ────── reads the JSON answer even with reasoning text or extra prose,
        │     validates every finding and sorts by severity
        ▼
Markdown · JSON · web UI · pull request comment · exit code
```

## Limits

- Very large single hunks (over about 24,000 characters) are reviewed partially; the output says so.
- GitHub cannot return diffs for huge pull requests; review those locally with `git diff | node src/cli.js -`.
- Line numbers in AI reviews come from the model and can be off by a line or two.
- Demo mode is pattern matching, not AI: it misses logic bugs and can raise false alarms.

## Development

```bash
npm test     # 17 unit tests, no network needed
```

Tests run automatically on Node 20, 22 and 24 for every push.

## License

MIT © 2026 [Shrimon Mishra](https://github.com/SoAkeD1). Built for the BharatCode Build League.

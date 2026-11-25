# CLAUDE.md

This repo is the CLI that makes README preview images for the owner's app repos
(`auto-generate-preview-image capture` and `status`). The user-facing manual is `README.md`;
read it before changing behaviour.

## Code map

- `bin/cli.js` — commands and their output.
- `src/spec.js` — reads and checks `preview.json`; every error at once.
- `src/run.js` — one capture of one repo: checks, prepare, start, capture, encode, keep, record.
- `src/capture.js` — drives Chromium: context, steps, screenshot, recording.
- `src/network.js` — the network rules (fixtures, block, allow).
- `src/serve.js` — starts and stops the app; the prepare command; closed-port check.
- `src/encode.js` — WebP under a byte budget, highest quality first.
- `src/compare.js` — how different two images look; keeps unchanged files out of git.
- `src/record.js` — the capture record, `docs/preview-record.json`.
- `src/status.js`, `src/git.js` — the freshness verdicts, from git alone.
- `src/resample.js` — recorded frames to a steady frame rate.

## Commands

- `npm test` — all tests; they use the real Chromium and real git (about a minute).
- `npm link` — puts `auto-generate-preview-image` on the PATH.

## Rules

- **The data rule.** Data about people is always invented in a preview image: trips, money,
  usage, names. Never copy real data into a fixture. Never open a fixture-based app in a
  browser that has no fixtures (for example the Playwright plugin's browser): with its backend
  running, it would show real data.
- **Pinned browser.** `playwright` is pinned to 1.64.1, whose Chromium build is already cached
  on the owner's machine. A new version downloads a new browser; change it on purpose only.
- **Two runtime dependencies:** `playwright` and `sharp`. Use Node built-ins for anything else.
- **Tests first.** Write the failing test, watch it fail, then the code. Tests use the real
  browser and real git, not mocks of them.
- **Plain English** in docs, skills, messages and names: one name for each thing.
- **Other repos.** When a task edits an app repo, read that repo's `CLAUDE.md` or `AGENTS.md`
  first (Claude Code does not load them from additional folders). Work on a branch named
  `preview-image` made from its default branch. Never merge; ask the user before each push or PR.

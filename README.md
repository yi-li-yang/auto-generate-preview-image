# auto-generate-preview-image

Makes a repo's README preview image from its running app: a static WebP, and an animated WebP
if you want one. It takes the picture the same way every time, so refreshing an image is one
command, and every image has the same size and byte budget.

Each image has two readers: the repo's own README, and the projects section of
[yi-li-yang.github.io](https://yi-li-yang.github.io/), which copies each repo's image and never
makes its own. One image, one place, so the two can no longer drift apart.

## Install

You need Node 22 or later, and git.

```sh
git clone https://github.com/yi-li-yang/auto-generate-preview-image
cd auto-generate-preview-image
npm install
npm link
```

`playwright` is pinned to 1.64.1. If your machine has no Chromium for that version yet, run
`npx playwright install chromium` once.

## Commands

```sh
auto-generate-preview-image capture [--static-only | --anim-only] [--headed]
auto-generate-preview-image status [dir] [--fetch]
```

- **`capture`** runs in an app repo. It reads `preview.json`, opens the app in Chromium, runs the
  steps, and writes the files listed below. It stops with an error when a `watch` path has
  uncommitted changes, so the record always names the code that the image shows. `--headed`
  shows the browser and slows each step, so you can watch the exact run.
- **`status`** lists every repo in `dir` that has a `preview.json`, with a verdict: `fresh`,
  `stale` (with the number of UI commits since the capture), `pending merge` or `missing`.
  Without `dir`, it looks at the folder that holds the current repo, or at the current folder
  when you are not in a repo. `--fetch` runs `git fetch` in each repo first; without it,
  `status` makes no network call.

## What an app repo holds

| File | Written by | What it is |
|---|---|---|
| `preview.json` | you | The preview spec: how to open the app and what to show. |
| `docs/preview.webp` | the tool | The preview image: 1200x750, under 250 KB. |
| `docs/preview-anim.webp` | the tool | The preview animation: 960x600, under 3 MB. Only when the spec has `anim`. |
| `docs/preview-record.json` | the tool | The capture record: the commit the images show. `status` reads it. |
| `docs/preview/fixtures/` | you | Invented data that the tool serves in place of real responses. |

The README's top image is the animation if there is one, else the image:

```md
![Travel log preview](docs/preview-anim.webp)
```

## The data rule

**Data about people is always invented**: trips, money, usage, names. Public reference data
may stay real: map tiles, open datasets, public prices. Every spec says which one applies in
`data` (`"invented"` or `"public"`), and why in `dataNote`. The tool refuses a spec without them.

To invent data, use fixtures first: map each of the app's data requests to a file of invented
data in `network.fixtures`, and block everything else on that path. Change the app only when
its data does not come over HTTP (for example a desktop app's IPC calls); then give the app a
demo mode that reads invented data.

## The preview spec

An example, for an app that loads its data as CSV files from a live site:

```json
{
  "_comment": "How auto-generate-preview-image captures this app.",
  "url": "https://yi-li-yang.github.io/travel-map/",
  "data": "invented",
  "dataNote": "Trips and life events come from docs/preview/fixtures; the person switcher is hidden.",
  "watch": ["src/", "index.html"],
  "reducedMotion": "reduce",
  "network": {
    "fixtures": {
      "**/trips/*.csv": "docs/preview/fixtures/trips.csv",
      "**/life/*.csv": "docs/preview/fixtures/life.csv"
    }
  },
  "hide": ["[role=group][aria-label=\"Whose trips\"]"],
  "steps": [{ "waitFor": ".z-40[role=status][aria-hidden=true]" }, { "wait": 800 }],
  "anim": {
    "reducedMotion": "no-preference",
    "steps": [
      { "waitFor": ".z-40[role=status][aria-hidden=true]" },
      { "recordStart": { "fps": 10 } },
      { "wait": 6000 },
      { "recordStop": {} }
    ]
  }
}
```

| Field | Default | Meaning |
|---|---|---|
| `url` | required | The page to open. A path with no scheme is a file in the repo. |
| `data`, `dataNote` | required | The data rule, above. |
| `watch` | required | Paths whose commits make the preview out of date. |
| `prepare` | none | A command to run in the repo before the capture, for example to render an email to HTML. |
| `start` | none | `{ "command", "waitUrl", "timeoutMs" }`. Starts the app, waits until `waitUrl` answers, and stops the app after the capture. It refuses to start when `waitUrl` already answers, because the capture would show whatever runs there. |
| `viewport` | `{ "width": 1200, "height": 750 }` | Browser window size, in CSS pixels. |
| `deviceScaleFactor` | `1` | Pixel density. `2` gives sharper text after the resize. |
| `colorScheme`, `timezoneId`, `locale` | browser default | Passed to the browser. |
| `reducedMotion` | browser default | `"reduce"` makes many apps skip their intro and stop moving, which suits a still image. |
| `clock` | none | A fixed date and time that the page sees, for example `"2026-11-25T09:30:00Z"`. |
| `hide` | `[]` | Selectors to hide (`visibility: hidden`). |
| `network` | none | See [Network rules](#network-rules). |
| `steps` | `[]` | See [Steps](#steps). |
| `output` | 1200x750, 250000 bytes, `"centre"` | Size, byte budget and crop position of the preview image. The position can also be `"attention"` or `"entropy"`. |
| `anim` | none | The animation: `{ "steps", "output" }`. It may also set its own `viewport`, `deviceScaleFactor`, `colorScheme`, `reducedMotion` and `clock`. Its `output` default is 960x600, 3000000 bytes. |
| `keepIfDiffBelow` | `0.005` | If a new image differs from the committed one by less than this mean pixel difference (0 to 1), the old file stays, so a re-run with no visible change adds no new binary to git. |
| `timeoutMs` | `30000` | Timeout of each step. |

Keys that start with `_`, such as `_edit` and `_comment`, are notes, and the tool ignores them.
Any other unknown key is an error, so a typo cannot pass silently.

### Network rules

The tool checks each request against the rules in this order:

1. `fixtures`: a URL glob that maps to a local file. The tool serves the file in place of the
   real response.
2. `block`: URL globs that are always stopped.
3. `allow`: URL globs that may pass. With no `allow` list, everything not blocked passes.
4. Anything else is stopped.

`failOnBlocked: true` fails the capture if any request was stopped, and names each one.
`closedPorts` lists local ports that must be closed; the tool refuses to start while any of
them answers.

Globs match the URL without its query string. `*` matches within one path segment, `**` across
segments, and a trailing `/**` also matches the folder itself, so `**/api/**` stops `/api` too.

Fixtures come before `block`, so this captures a private app with invented data only, even
when its dev server forwards `/api` to a real backend:

```json
"network": {
  "fixtures": { "**/api/transactions": "docs/preview/fixtures/transactions.json" },
  "block": ["**/api/**"],
  "allow": ["http://localhost:5173/**"],
  "failOnBlocked": true,
  "closedPorts": [8000]
}
```

### Steps

Each step is an object with one key.

| Step | Value | Does |
|---|---|---|
| `goto` | URL | Opens another page. |
| `waitFor` | selector | Waits until an element is in the page. |
| `waitForFunction` | JS expression | Waits until the expression is true. |
| `waitForLoadState` | `"load"`, `"domcontentloaded"` or `"networkidle"` | Waits for that state. |
| `click`, `hover` | selector | Clicks or hovers the first match. |
| `fill`, `select` | `[selector, value]` | Types into a field, or picks an option. |
| `press` | key | Presses a key, for example `"Escape"`. |
| `mouse` | `[x, y]` | Moves the pointer, for example off a map. |
| `wait` | milliseconds | Waits. |
| `eval` | JS expression | Runs the expression in the page and waits for it if it returns a promise. |
| `recordStart`, `recordStop` | `{ "fps": n }`, `{}` | Animation only: the tool records while the steps between them run. |

Selectors are Playwright selector strings, so `role=button[name="Close"]` works.

### Animation

Between `recordStart` and `recordStop`, the tool records what the page paints (the Chrome
DevTools Protocol screencast) and resamples it to a steady `fps`. A still page holds its last
frame. WebP merges identical neighbouring frames, so a calm animation has fewer frames than
`fps` times seconds, but it plays for the same time.

## Adding a repo

1. Choose the frame that shows what is special about the app, and find a ready signal: an
   element or a state that means the app has finished loading.
2. Apply the data rule. Write `data` and `dataNote`.
3. Write `preview.json`. Run `auto-generate-preview-image capture --headed` to watch the run,
   then `capture`.
4. Look at the images. A thumbnail is small, so one clear idea per image works best.
5. Point the README's top image at the new file and delete old preview images. Commit
   `preview.json`, the `docs/preview*` files and any fixtures on a branch, and open a PR.
6. After the merge, the homepage can opt in: `"preview": true` on the repo's entry in its
   `data/show_repo.json`.

## Refreshing

1. Run `auto-generate-preview-image status --fetch` in the folder that holds the repos.
2. For each `stale` repo: make a branch from the default branch, run `capture`, look at the
   images, commit, and open a PR.
3. After the merge, the homepage copies the new image on its next daily run.

## How `status` decides

`status` reads the repo's default branch (the remote's, when there is a remote), because that
is what readers see. The record names the commit that the capture showed: the merge base of the
capture with the default branch, so it stays right after a squash merge. Commits after it on
the `watch` paths make the preview `stale`. A record that exists only on another branch is
`pending merge`.

## Development

```sh
npm test
```

The tests run the real Chromium and real git, and take about a minute.

## License

MIT

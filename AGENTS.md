# AGENTS.md

- Soundscaper is a Vite/React local-first browser audio editor.
- Use test-driven development principles.
- Use Node.js 26.5.0 and npm 12.0.1. Use npm and preserve `package-lock.json`;
  never edit dependency metadata without updating the lockfile.
- Application UI lives in `src/common/editor/ui/`.
- Every newly added feature must be reachable through a menu. Do not surface new
  features by default in the UI: no new always-visible toolbar buttons, panels,
  side rails, badges, or inline controls. Add the entry point to an existing
  menu (or a menu submenu) and let the user opt in from there.
- Audio models, workers, storage, effects, import/export, and WASM integration
  live in `src/common/editor/`.
- Do not commit generated `dist/`, `coverage/`, `playwright-report/`,
  `test-results/`, or `node_modules/` content.
- Keep FFmpeg runtime assets out of the Pages bundle; production assets are
  versioned under `https://assets.soundscaper.org/runtime/ffmpeg/`.
- Locales other than English and German are served by generated machine
  translations in `src/common/i18n/machine/` (JSON catalogs and their loader
  index), which Audacity's reviewed strings override at runtime. Edit English
  copy freely: an entry whose English changed retires itself until
  `npm run i18n:translate -- --all` regenerates it against a local Ollama
  (see `scripts/i18n-ai/README.md`). Never hand-edit those files.
- `npm run check` is the canonical non-browser gate. During development and task
  handoff, lint added and modified lintable files with `npm run lint:changed`;
  the complete repository lint is an authoritative CI/pre-merge gate and is
  split into sequential bounded-memory shards by `npm run lint`. Run that full
  lint locally when changing ESLint/TypeScript configuration, dependencies, or
  shared types. Also run `npm test` after helper changes, `npm run build` after
  Vite/UI changes, and `npm run test:browser` for interactive workflows.
- CI runs that gate as several jobs, because one runner has four cores and the
  Node suite no longer fits in them: `npm run check:static` is everything except
  the suite, and the suite runs as one job per shard. A test belongs to the
  `framescaper` or `soundscaper` shard when it reaches into that product's own
  tree (`src/`, `desktop/` or `native/`) or carries the product in its filename,
  and to `common` otherwise — cross-product tests included, since neither product
  owns them. Run one shard locally with `npm test -- --shard=framescaper`. The
  coverage floors live in `config/coverage-gates.json` (`.c8rc.json` only
  selects which files c8 instruments) and are enforced once over the union of
  what the shards recorded, so never weaken them per shard. They ratchet: run
  `npm run coverage:tighten` after a shard run to raise a floor to the coverage
  a scope has gained; lowering one stays a deliberate edit with its reason
  recorded in that file.
- New controller/domain modules and their tests should be strict TypeScript.
  Keep imports at the owning module instead of adding broad barrel dependencies.
- TypeScript linting is type-aware: await, catch, return, or explicitly `void`
  every promise, and do not pass promise callbacks to void-returning APIs.
- Do not grow files listed in `config/maintainability-allowlist.json`; extract a
  focused module instead. New maintained source files have a 600-line ceiling;
  browser specs have an 800-line ceiling. From 550 lines a file is in the warning
  band: `npm run check:architecture` counts it, `--warnings` lists it, and a
  PostToolUse hook reports its headroom as you edit it. Treat entering the band as
  the moment to split, not the moment to start counting lines. Only growth fails
  the guard, so a file may shrink below its allowlist ratchet freely; run
  `npm run check:size:tighten` to claim the recovered lines when you have.
- Production JavaScript chunks have a 500,000-byte ceiling. Preserve the
  semantic chunk groups in `vite.config.mjs`; split module ownership instead of
  weakening the build-output guard.
- Startup graph ceilings live in `config/startup-graph-budgets.json`, and every
  build prints its observed requests and bytes per graph and writes them to
  `.startup-graph-report.json` beside the bundle. Run
  `npm run check:startup-graph:tighten` after a build to claim a graph that
  shrank; it lowers byte ceilings only, never requests, since splitting adds
  chunks by construction. Raising a ceiling stays a deliberate edit with its
  reason recorded in that file.
- Browser tests live in `tests/browser/` and use `playwright.config.mjs`.
  Playwright runs Chromium headlessly and starts its own loopback preview server
  at `http://127.0.0.1:4322`; no IDE browser, graphical session, or separately
  running development server is required.
- Run the full browser suite with `npm run test:browser`. For a focused run,
  build first, then use `npx playwright test tests/browser/<file>.spec.js
  --project=chromium` and optionally `--grep='test name'`. Loopback binding
  fails with `listen EPERM` in a sandboxed environment, always request permission to
  run the browser test outside the sandbox.
- If port 4322 is occupied, set `PLAYWRIGHT_PORT` for the command (for example,
  `PLAYWRIGHT_PORT=4323 npm run test:browser`). Inspect failed-run diagnostics in
  `test-results/`, but do not edit or commit that generated directory.
- Chromium browser runs can record coverage of the built site. Build with
  `SCAPE_BUILD_SOURCE_MAPS=1 npm run pretest:browser` — the maps are `hidden` and
  land in a sibling `<output directory>-source-maps/`, so the built sites and
  `dist/` keep exactly the bytes they had — then run with
  `SCAPE_BROWSER_COVERAGE=1 npx playwright test --project=chromium`, which writes
  one raw V8 profile per test into `coverage/v8-browser/`. Compact them with
  `npm run coverage:compact:browser -- coverage/shards/browser-chromium-local.json`.
  A spec whose budget is bound by realtime work opts out of collection with
  `test.use({ browserCoverage: false })`.
  A local browser-only shard is not the union the floors are scored against, so
  run `npm run coverage:tighten` only after CI has merged the Node and Chromium
  shards, never against one shard on its own.
- Preserve AGPL and third-party notices, pinned source hashes, and the StaffPad
  reproducibility/audit workflow.
- Markdown blocks fenced by `<!-- policy-narrative:… -->` comments are derived
  from register prose (see `scripts/lib/policy-narratives.mjs`); edit the
  register field, run `node scripts/sync-policy-narratives.mjs`, and never edit
  the fenced text by hand. When a register paragraph duplicates a narrative
  document, prefer adding a binding over hand-mirroring the prose.
- After editing any file digest-pinned by `config/ffmpeg-runtime-manifest.json`
  (notably `config/production-security-matrix.json` and
  `docs/production-threat-model.md`), run
  `node scripts/repin-runtime-evidence.mjs` to refresh the byteLength/sha256
  pins and the review payload digest in the same commit; never hand-edit those
  pins. `--check` verifies without writing.
- Use tabs in existing JavaScript/JSX sources and keep changes narrowly scoped.
- Make atomic commits.
- When committing, explicitly select your own files to avoid sweeping up someone else's changes.

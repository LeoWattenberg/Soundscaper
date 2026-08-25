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
- `npm run check` is the canonical non-browser gate. During development, run
  `npm test` after helper changes, `npm run build` after Vite/UI changes, and
  `npm run test:browser` for interactive workflows.
- CI runs that gate as several jobs, because one runner has four cores and the
  Node suite no longer fits in them: `npm run check:static` is everything except
  the suite, and the suite runs as one job per shard. A test belongs to the
  `framescaper` or `soundscaper` shard when it reaches into that product's own
  tree (`src/`, `desktop/` or `native/`) or carries the product in its filename,
  and to `common` otherwise — cross-product tests included, since neither product
  owns them. Run one shard locally with `npm test -- --shard=framescaper`. The
  coverage thresholds live in `.c8rc.json` and are enforced once over the union
  of what the shards recorded, so never weaken them per shard.
- New controller/domain modules and their tests should be strict TypeScript.
  Keep imports at the owning module instead of adding broad barrel dependencies.
- TypeScript linting is type-aware: await, catch, return, or explicitly `void`
  every promise, and do not pass promise callbacks to void-returning APIs.
- Do not grow files listed in `config/maintainability-allowlist.json`; extract a
  focused module instead. New maintained source files have a 600-line ceiling;
  browser specs have an 800-line ceiling.
- Production JavaScript chunks have a 500,000-byte ceiling. Preserve the
  semantic chunk groups in `vite.config.mjs`; split module ownership instead of
  weakening the build-output guard.
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

# AGENTS.md

- Soundscaper is an Astro/React local-first browser audio editor.
- Use npm and preserve `package-lock.json`.
- Application UI lives in `src/components/tools/audio-editor/`.
- Audio models, workers, storage, effects, import/export, and WASM integration
  live in `src/lib/tools/audio-editor/`.
- Do not commit generated `dist/`, `test-results/`, or `node_modules/` content.
- Keep FFmpeg runtime assets out of the Pages bundle; production assets are
  versioned under `https://assets.soundscaper.org/runtime/ffmpeg/`.
- Run `npm test` after helper changes, `npm run build` after Astro/UI changes, and
  `npm run test:browser` for interactive workflows.
- Browser tests live in `tests/browser/` and use `playwright.config.mjs`.
  Playwright runs Chromium headlessly and starts its own loopback preview server
  at `http://127.0.0.1:4322`; no IDE browser, graphical session, or separately
  running development server is required.
- Run the full browser suite with `npm run test:browser`. For a focused run,
  build first, then use `npx playwright test tests/browser/<file>.spec.js
  --project=chromium` and optionally `--grep='test name'`. When loopback binding
  fails with `listen EPERM` in a sandboxed environment, request permission to
  rerun the browser test outside the sandbox.
- If port 4322 is occupied, set `PLAYWRIGHT_PORT` for the command (for example,
  `PLAYWRIGHT_PORT=4323 npm run test:browser`). Inspect failed-run diagnostics in
  `test-results/`, but do not edit or commit that generated directory.
- Preserve AGPL and third-party notices, pinned source hashes, and the StaffPad
  reproducibility/audit workflow.
- Use tabs in existing JavaScript/JSX sources and keep changes narrowly scoped.

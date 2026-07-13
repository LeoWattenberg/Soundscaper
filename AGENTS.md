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
- Preserve AGPL and third-party notices, pinned source hashes, and the StaffPad
  reproducibility/audit workflow.
- Use tabs in existing JavaScript/JSX sources and keep changes narrowly scoped.

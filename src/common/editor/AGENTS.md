# Editor guidance

- Keep domain, persistence, worker, import/export, and effect logic independent
  of `ui/`; React components may call the domain, never the reverse.
- Put new stateful coordination in a focused strict-TypeScript module under
  `controller/`, inject browser resources, and make cleanup idempotent.
- Import the narrow implementation module. Do not recreate the removed
  `app.js`/`index.js` cycle or import the external `index.js`/`facade.ts` surface
  from editor implementation code.
- Add focused `tests/*.test.ts` coverage for new controller code. Run `npm test`
  and `npm run typecheck`; add the relevant reproducibility audit when touching
  codecs, WASM, project formats, or storage.
- Treat files in `native/`, compiled WASM, generated assets, pinned hashes, and
  notices as audited supply-chain material, not ordinary source.

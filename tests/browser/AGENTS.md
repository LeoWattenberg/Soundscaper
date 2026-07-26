# Browser test guidance

- Test user-visible workflows through roles and stable accessible names. Avoid
  implementation selectors and fixed sleeps.
- Never commit `test.only`; CI rejects focused tests. Failed-run traces and
  screenshots belong in generated `test-results/` or `playwright-report/`.
- `npm run test:browser` builds first. After an explicit `npm run build`, use
  `npm run test:browser:built` or a focused `npx playwright test` invocation to
  avoid rebuilding.
- Keep new scenarios in the matching focused editor spec. Reuse
  `audio-editor-test-fixtures.js` and
  `audio-editor-test-helpers.js`; keep feature-specific setup beside its spec
  rather than rebuilding a catch-all file.

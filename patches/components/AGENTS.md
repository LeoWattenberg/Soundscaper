# Component patch guidance

- These patches are pinned to `@dilsonspickles/components` 0.9.0 and may target
  only `node_modules/@dilsonspickles/components/dist/`.
- Never edit or commit `node_modules`. Regenerate patches from a fresh `npm ci`,
  review every path, and keep one deterministic file change per numbered patch.
- The postinstall validator rejects traversal, absolute paths, renames, copies,
  binary patches, and targets outside the pinned package. Do not bypass Git's
  safe-path checks.
- After changing a patch, verify a clean install and run `npm run check:notices`
  plus the smallest affected application tests.

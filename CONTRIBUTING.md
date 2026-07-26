# Contributing

Use Node.js 26.5.0 and npm 12.0.1 (the versions pinned by `.nvmrc`, `package.json`,
and CI). The component package is read from GitHub Packages, so set a
`NODE_AUTH_TOKEN` with package-read access before a fresh install.

```sh
npm ci
npm run check
```

`npm run check` runs linting, strict TypeScript checks, architecture and file-size
guardrails, reproducibility/notice audits, unit coverage, and the production
build. The external EBU R128 conformance corpus is intentionally separate; run
`npm run audit:ebu-r128 -- --test-set /path/to/test-set` when changing metering.

Browser workflows are a separate gate because they install Chromium and bind a
loopback preview server:

```sh
npm run test:browser
# When a current production build already exists:
npm run test:browser:built
```

Prefer small, typed modules with narrow imports. Existing oversized files are
recorded as ratchets, not precedents:
do not raise an allowlist merely to make a check pass. The same applies to
`eslint-suppressions.json`: fix or extract legacy lint debt; never increase a
suppression count for new code. The previous editor facade cycle has been
removed and must not be recreated. See
[`docs/architecture.md`](docs/architecture.md) and the nearest nested
`AGENTS.md` before editing a subsystem.

Do not commit generated `dist/`, `coverage/`, `playwright-report/`,
`test-results/`, `.desktop-build/`, `release/`, or `node_modules/` content.
Preserve AGPL notices, third-party integrity records, pinned source hashes, and
the reproducibility audits.

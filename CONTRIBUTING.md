# Contributing

Use Node.js 26.5.0 and npm 12.0.1 (the versions pinned by `.nvmrc`, `package.json`,
and CI). A fresh install needs no registry credentials; the Audacity design
system is vendored in-tree at `vendor/audacity-design-system/`.

```sh
npm ci
npm run check
```

`npm run check` runs linting, strict TypeScript checks, architecture and file-size
guardrails, reproducibility/notice audits, unit coverage, and the production
build. The external EBU R128 conformance corpus is intentionally separate; run
`npm run audit:ebu-r128 -- --test-set /path/to/test-set` when changing metering.

CI runs the same work as several parallel jobs: `npm run check:static` covers
everything except the Node suite, and the suite is split by product into a
`common`, a `framescaper` and a `soundscaper` shard. To run just the shard your
change touches, use `npm test -- --shard=framescaper`. The coverage thresholds
are checked once over the union of all three shards, never per shard.

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

## Community translations

In either editor, open **Help > Contribute translations**, select a language, search
for a string or select visible text, and edit it while using the application.
Drafts stay on your device. Export your changes as a JSON contribution file and
send it to **team@kw.media** for review; nothing is uploaded automatically.
Use the export before clearing browser storage. Importing a contribution file
restores its original source and baseline; outdated or conflicting edits remain
available for correction and export, and are excluded from preview.

The same menu can download a PO ZIP for an external translation editor. Keep
`manifest.json` unchanged and return it alongside `messages.po`, preferably in
the original ZIP. It includes a POT source template and the upstream notices.
PO context is the stable application key, `msgid` is the
English source, and `msgstr` is the translation. Fuzzy and obsolete entries are
skipped. Only changed text is proposed; an untouched download never promotes
machine translations to human ownership. Include your preferred contributor
name and optional translator comments. Contributions use the repository's
AGPL-3.0-only license; existing Audacity strings retain their upstream notices.

Maintainers can create a current PO ZIP without starting the application:

```sh
npm run i18n:community -- export --locale fr --output /tmp/fr.zip
npm run i18n:community -- import --file /tmp/contribution.json
npm run i18n:community -- import --file /tmp/fr.zip --contributor "Contributor name"
```

Import defaults to a read-only diff report of clean changes, changed English, conflicting
published baselines, and invalid translations. Review the file and choose the
accepted keys explicitly:

```sh
npm run i18n:community -- import --file /tmp/contribution.json --apply --keys key1,key2
# A standalone PO needs its original manifest:
npm run i18n:community -- import --file /tmp/messages.po --manifest /tmp/manifest.json
```

Only selected clean entries are written as `human`, with contributor names,
notes, original baseline entries, and upstream attribution retained in catalog
metadata. Automatic translators and Audacity sync preserve these human entries.
Merged JSON drafts retain each entry's contributor separately from the file's
submitter. Maintainer imports prefer that entry attribution; the file contributor
or `--contributor` supplies credit only for entries without their own author.
The canonical writer regenerates the locale loader index. Commit the catalog
and index together. This workflow covers the editor; handbook translation uses
the separate documentation pipeline, whose automatic writers need human ownership
protection before community handbook edits can be promised preservation.
English remains the source language; new
locale routes require a separate change.

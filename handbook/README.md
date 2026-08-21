# Soundscaper handbook

This workspace builds the public product documentation at
`https://docs.soundscaper.org`. Product and engineering evidence in the
repository's existing `docs/` directory is intentionally not published here.

Run commands from the repository root:

```sh
npm run docs:generate
npm run docs:check
npm run docs:dev
```

The generated command, format, and capability pages are committed. Change
their authoritative runtime registries, run `npm run docs:generate`, and review
the resulting Markdown in the same pull request.

Local AI authoring and translation commands are optional maintainer tools. They
write draft files by default, record provenance, and never run in CI or a
Cloudflare build. Review their Git diff and revert output that is not suitable
for publication.

## Cloudflare Pages deployment

Use a separate Direct Upload Pages project so the handbook cannot accidentally
inherit the editor application's root `wrangler.jsonc`. Create it once with
`npx wrangler pages project create`, choose `soundscaper-docs` and `main` when
prompted, then deploy from the repository root with:

```sh
npm run deploy:docs
```

That command selects `handbook/wrangler.jsonc`, runs deterministic reference,
content, and static-build checks, exercises desktop and mobile Chromium
navigation, local-search privacy, and accessibility, and only then uploads
`handbook/dist`. Attach `docs.soundscaper.org` to the Pages project after the
first deployment.

The repository's canonical quality and Chromium browser jobs run the same two
validation layers on pull requests. Direct Upload intentionally keeps
production publication explicit; add the same `npm run deploy:docs` command to
an authorized CI release job if automatic publication becomes a requirement.

Keep Cloudflare Web Analytics disabled so the deployed site continues to match
the handbook's static, first-party-only privacy statement.

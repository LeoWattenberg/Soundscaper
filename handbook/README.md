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

## Cloudflare Pages project

Create a separate Git-integrated Pages project named `soundscaper-docs` with:

- Production branch: `main`
- Repository root directory: repository root
- Build command: `npm run docs:check`
- Build output directory: `handbook/dist`
- Node version: the root `.nvmrc`
- Custom domain: `docs.soundscaper.org`

Keep the default `*` build watch path. The reference generator imports runtime
modules and their transitive dependencies, so a hand-maintained narrow list can
miss a source change and publish stale documentation. Pull requests then
receive an isolated Pages preview without changing the editor's existing
`soundscaper` Pages project.

Keep Cloudflare Web Analytics disabled so the deployed site continues to match
the handbook's static, first-party-only privacy statement.

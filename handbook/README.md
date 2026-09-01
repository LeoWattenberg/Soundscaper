# Soundscaper handbook

This workspace builds the public product documentation at
`https://soundscaper.org/docs`. Product and engineering evidence in the
repository's existing `docs/` directory is intentionally not published here.

The handbook is a path on the Soundscaper origin, not a documentation
subdomain, so it needs no DNS record and no Pages project of its own.
`scripts/lib/product-web-routing.mjs` owns the base path: the Astro config, the
editor's documentation links, the Cloudflare header rules and the browser suite
all read it from there rather than repeating it.

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

## Authoring links

Write internal links root-absolute and base-free: `[Project files](/projects-and-data/project-files/)`.
`src/plugins/rehype-handbook-base.mjs` supplies the base at build time, and
`scripts/check-handbook-content.mjs` resolves the base-free target against the
page tree so a link to a page that does not exist fails the check.

Frontmatter is the exception. A hero action's `link` is data read by a Starlight
component rather than Markdown a transform ever sees, so it has to carry the
base itself. The same content check enforces that in the opposite direction.

## Deployment

The handbook ships inside the Soundscaper deployment. `npm run build:pages`
runs the reference, content and static-build checks, then
`scripts/stage-handbook-build.mjs` copies `handbook/dist` into the product
build under the base path, and `npm run deploy` uploads the one `dist`. There is
nothing to attach and no second project to publish to.

Staging fails closed rather than deploying something broken: a `handbook/dist`
built for a different base path is refused, because Astro bakes the base into
every asset URL and a stale build looks complete while every stylesheet points
somewhere the deployment does not serve.

The repository's canonical quality and Chromium browser jobs run the handbook's
deterministic checks and its browser suite on pull requests.

Keep Cloudflare Web Analytics disabled so the deployed site continues to match
the handbook's static, first-party-only privacy statement.

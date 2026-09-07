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

The generated reference pages are committed. Change one of the authoritative
runtime registries, run `npm run docs:generate`, and review the resulting
Markdown in the same pull request. `scripts/lib/docs-reference-generator.mjs`
is the only module that knows which registries exist; each page has its own
renderer under `scripts/lib/docs-reference/`, and a renderer is a pure function
of the values it is handed so a test can supply them.

A generated page never invents wording for a runtime identifier. Where an ID
was not written for readers, the renderer looks it up in a reviewed label map
and throws when it finds nothing, so a new capability, effect category, model
task, or package format fails `npm run docs:check` until somebody writes its
public name.

Local AI authoring and translation commands are optional maintainer tools. They
write draft files by default, record provenance, and never run in CI or a
Cloudflare build. Review their Git diff and revert output that is not suitable
for publication.

## Languages

The English pages are the source, and a language is a directory of the same
tree beside them: `src/content/docs/fr/` is the French handbook.
`scripts/lib/handbook-locales.mjs` reads which languages exist from those
directories, so translating a language's first pages is what publishes it and
deleting the directory withdraws it. Starlight fills a page a language has not
reached yet with the English one, so a language may be published while its
translation is still being written.

A directory is the lowercased tag - `pt-br`, not `pt-BR`. Astro lowercases the
slug it derives from a content path and Starlight reads the language out of
that slug, so a directory named `pt-BR` builds a duplicate English page tree
under a language that does not exist.

Translations are written by a local model:

```sh
npm run docs:translate:handbook -- --locale fr
npm run docs:translate:check
```

See `scripts/docs-ai/README.md`. The navigation the site is configured with -
the site title and the sidebar headings - is not part of any page, so it lives
in `scripts/lib/handbook-chrome.mjs` and one catalog per language under
`handbook/i18n/`; the same run translates it. Everything else in the sidebar is
a page's own frontmatter title and translates with the page.

## Authoring links

Write internal links root-absolute and base-free: `[Project files](/projects-and-data/project-files/)`.
`src/plugins/rehype-handbook-base.mjs` supplies the base and the page's own
language at build time, and `scripts/check-handbook-content.mjs` resolves the
base-free target against the page tree so a link to a page that does not exist
fails the check.

Frontmatter is the exception. A hero action's `link` is data read by a Starlight
component rather than Markdown a transform ever sees, so it has to carry the
base itself, and a translated page's has to carry the language too. The same
content check enforces that in the opposite direction, and the translator
writes the language in when it translates the page.

A heading that is linked to has to write its id out as `## Sharing programs
{#sharing-programs}`. Astro otherwise derives the id from the heading text,
which changes when the heading is translated, while a link destination is
protected during translation and keeps the English id. The content check
refuses an anchor that names a heading without a written-out id.

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

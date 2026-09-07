# Local documentation AI tooling

This optional authoring tool talks only to a locally reachable Ollama server. It is not used by documentation builds, CI, or deterministic reference generation. Generated files are ordinary working-tree changes: review them and use Git to keep or revert them.

Draft an English page from a bounded fact packet:

```sh
node scripts/docs-ai.mjs draft \
  --facts handbook/facts/first-project.json \
  --output handbook/src/content/docs/drafts/first-project.md
```

Translate the whole handbook into a language:

```sh
node scripts/docs-ai.mjs handbook --locale fr
```

A run walks every English page, translates the ones the language is missing or
has fallen behind on into `handbook/src/content/docs/fr/`, then translates the
navigation the site is configured with into `handbook/i18n/fr.json`. Each page
is written as it finishes, so an interrupted run resumes where it stopped, and
a page the model cannot answer acceptably in three attempts is named and left
untranslated rather than stopping the language for it.

The handbook publishes a language by having a directory of pages for it, so the
first page a run writes is what puts the language in the site's language
picker; Starlight fills the pages the language has not reached yet with the
English ones. Deleting the directory withdraws the language again.

- `--all` runs every language that already has pages.
- `--pages a.md,b.md` limits a run to named pages, to redo one page on its own.
- `--prune` first removes the translations of English pages that no longer exist.
- `--check` reports what each language owes without contacting Ollama, and
  `--strict` makes that fail when anything is stale, missing or invalid.

`npm run docs:translate:handbook -- --locale fr` and `npm run docs:translate:check`
are the same commands.

Translate one page on its own:

```sh
node scripts/docs-ai.mjs translate \
  --source handbook/src/content/docs/soundscaper/first-project.md \
  --target handbook/src/content/docs/de/soundscaper/first-project.md \
  --locale de
```

Both commands write their target by default. Add `--stdout` only when console output is specifically wanted. Add `--check` to validate an existing output and its source provenance without contacting Ollama or changing files.

An invalid model JSON, schema, Markdown structure, protected token sequence, or translated frontmatter response receives concise corrective feedback and may be attempted up to three times. Endpoint, HTTP, and timeout failures stop immediately and are never retried.

A draft fact packet is JSON with an English locale, simple Starlight frontmatter, and one or more bounded claims:

```json
{
  "locale": "en",
  "frontmatter": {
    "title": "Create your first project",
    "description": "Start a local Soundscaper project."
  },
  "outline": ["Create the project", "Import audio", "Save your work"],
  "facts": [
    {
      "id": "local-editing",
      "claim": "Editing occurs locally in the browser."
    }
  ]
}
```

The model must cite supplied fact IDs in its structured response. This makes grounding reviewable; it does not replace human review of every claim.

Configuration precedence:

- Endpoint: `OLLAMA_DOCS_URL`, then `OLLAMA_URL`, then a discovered WSL nameserver gateway, then `127.0.0.1:11434`.
- Draft model: `--model`, `OLLAMA_DOCS_DRAFT_MODEL`, `OLLAMA_MODEL`, then the locally installed `qwen3.8:latest`.
- Translation model: `--model`, `OLLAMA_DOCS_TRANSLATE_MODEL`, `OLLAMA_MODEL`, then the model the
  target language calls for. That choice lives in `scripts/lib/translation-models.mjs` and follows
  the language rather than the tool: `aya-expanse:32b` for the twenty-three languages it speaks and
  `qwen3.8:latest` for the rest, so a handbook page and the interface strings it quotes are written
  by the same translator.
- Bounds: `OLLAMA_DOCS_TIMEOUT_MS`, `OLLAMA_DOCS_TEMPERATURE` (maximum `0.3`), and `OLLAMA_DOCS_CHUNK_CHARS`.
- Cache: `DOCS_AI_CACHE_DIR`, defaulting to `.docs-ai-cache/`.

Each output records its operation, prompt version, exact installed model digest, source hash, locale, and fact-packet identity in an HTML comment. Translation localizes the Starlight `title` and `description`, points the page's frontmatter links at its own language, preserves every other frontmatter field, protects code, URLs, link destinations, command IDs, and file extensions, then rejects structural or locale drift before writing.

Locale drift is what a local model actually produces for a language it is weak in: an English
answer reported as a success. `scripts/docs-ai/locale.mjs` decides which check applies from the
locale's own script — a language written in Arabic, Greek, Hebrew, Devanagari, Armenian, Cyrillic,
Japanese, Korean or Han must answer in that script, and a Latin-script language is held to its own
function words against English.

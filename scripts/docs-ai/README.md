# Local documentation AI tooling

This optional authoring tool talks only to a locally reachable Ollama server. It is not used by documentation builds, CI, or deterministic reference generation. Generated files are ordinary working-tree changes: review them and use Git to keep or revert them.

Draft an English page from a bounded fact packet:

```sh
node scripts/docs-ai.mjs draft \
  --facts handbook/facts/first-project.json \
  --output handbook/src/content/docs/drafts/first-project.md
```

Translate an existing page into the future German content tree:

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
- Translation model: `--model`, `OLLAMA_DOCS_TRANSLATE_MODEL`, `OLLAMA_MODEL`, then the locally installed `qwen3.8:latest`.
- Bounds: `OLLAMA_DOCS_TIMEOUT_MS`, `OLLAMA_DOCS_TEMPERATURE` (maximum `0.3`), and `OLLAMA_DOCS_CHUNK_CHARS`.
- Cache: `DOCS_AI_CACHE_DIR`, defaulting to `.docs-ai-cache/`.

Each output records its operation, prompt version, exact installed model digest, source hash, locale, and fact-packet identity in an HTML comment. Translation localizes the Starlight `title` and `description`, preserves every other frontmatter field, protects code, URLs, link destinations, command IDs, and file extensions, then rejects structural or locale drift before writing.

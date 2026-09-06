# Machine-translated editor copy

Soundscaper ships two human catalogs, English and German, in `src/common/i18n/catalogs.js`. Every other route locale is served by a machine-translated catalog in `src/common/i18n/machine/<locale>.json`, generated from the English copy with a locally reachable Ollama model by this tool. At runtime a locale's copy is composed lowest priority first:

1. the English catalog;
2. the bundled German catalog, for German locales only;
3. the machine catalog for the locale, loaded lazily as its own chunk;
4. Audacity's reviewed strings for the locale, published weekly by `sync-audacity-translations.yml`, which override any key they carry.

So a key Audacity's translators have covered always shows their wording, and everything else shows ours. The site chrome swaps its few strings in the same way once the chunk arrives, and the static route documents carry the machine description and loading text at build time.

The tool is optional authoring tooling: it is not used by documentation builds, CI, or deterministic reference generation, and it never contacts anything but the configured Ollama server and, for the glossary, the public translation manifest. Generated files are ordinary working-tree changes: review them and use Git to keep or revert them.

## Staleness

Each entry records the English it was translated from:

```json
"addTrack": ["Add track", "Ajouter une piste"]
```

An entry is shown only while that English is still the current English. Edit English copy freely: the translations of a changed string retire themselves, without a model run, and the key falls through to Audacity's string or to English until the catalog is regenerated. Keys that no longer exist are dropped on the next write. A catalog written under an earlier prompt version keeps showing its entries but is regenerated in full by the next run. Nothing in CI needs the model.

One key is never translated: `nyquistPromptDefault` is Nyquist code the editor executes, so it stays English (German has its own hand-written entry).

## Commands

Translate whatever the current English copy has and a catalog lacks or holds a stale translation of:

```sh
OLLAMA_URL=http://<windows-host-ip>:11434 OLLAMA_DOCS_TIMEOUT_MS=600000 npm run i18n:translate -- --locale fr
OLLAMA_URL=http://<windows-host-ip>:11434 OLLAMA_DOCS_TIMEOUT_MS=600000 npm run i18n:translate -- --all
```

`--all` covers every committed route locale that no bundled human catalog serves. Add `--model MODEL` to pick an installed model, `--batch-size N` (default 30, and about 1,500 characters of key names and English per request) to change how many keys one request carries, `--keys a,b` to limit a run, and `--glossary DIR` to read the Audacity strings from a snapshot made by `manage-audacity-translation-release.mjs snapshot` instead of the public manifest, or `--no-glossary` to send none. The catalog and the loader index are rewritten after every batch, so an interrupted run resumes where it stopped, and every answer is cached under `.docs-ai-cache/` by the exact packet it came from.

Report each catalog against the current English copy:

```sh
npm run i18n:check
npm run i18n:check -- --strict
```

`--strict` fails when anything is stale, missing, orphaned or invalid; the plain form only fails on an invalid file. `tests/i18n-ai-catalog.test.js` holds every committed catalog to the file shape at gate time.

## How a batch is translated

Each request is a closed packet: the English messages of one batch, the reviewed German translations of the same keys as a meaning reference (the same English is translated differently in different places, and German has already resolved which is which), the Audacity-reviewed glossary for the target language, and the language's name. The answer must return exactly the requested keys, and every value is held to the rule the runtime applies before it shows a machine translation: a non-empty string once any ellipsis a language's dialog convention adds has been removed (as the Audacity converter removes theirs), the same `{placeholders}`, line count, `*identifiers*` and file extensions as the English, and not far longer than it. An answer that fails, or that the model cut off at its output limit, receives concise corrective feedback and may be attempted up to three times; a batch that still fails, or that outruns the request timeout, is split in half until the one key that resists is skipped and named in the summary. Other endpoint and HTTP failures stop the run immediately; the batches already written stay.

## Configuration

- Endpoint: `OLLAMA_DOCS_URL`, then `OLLAMA_URL`, then a discovered WSL gateway, then `127.0.0.1:11434`. From WSL, a Windows Ollama started with `OLLAMA_HOST=0.0.0.0` answers on the host's adapter addresses, so set `OLLAMA_URL=http://<windows-host-ip>:11434` when the gateway does not.
- Model: `--model`, then `OLLAMA_I18N_MODEL`, then a default per language: `aya-expanse:32b` (Cohere's translation-focused model, which has worked best for this) for the languages it covers, and `qwen3.8:latest` for Finnish, Galician and Armenian, which it does not. The run says which model each locale uses.
- Bounds: `OLLAMA_DOCS_TIMEOUT_MS` (default 120000; set `600000` for an unattended `--all` run so a slow batch is halved rather than abandoned), `OLLAMA_DOCS_TEMPERATURE` (maximum `0.3`).
- Cache: `DOCS_AI_CACHE_DIR`, defaulting to `.docs-ai-cache/`.

## Files

- `src/common/i18n/machine/<locale>.json` — the catalog: schema version, locale, the provenance of the run that last wrote it (model, exact model digest, prompt version) and the sorted entries.
- `src/common/i18n/machine/index.js` — the generated loader index the runtime and the site read; regenerated from the files present.
- `src/common/i18n/machine-catalog.js` — the runtime: which catalog serves a locale and which entries may be shown.
- `scripts/i18n-ai/catalog.mjs`, `prompt.mjs`, `workflows.mjs`, `cli.mjs` — reading, assessing and writing catalogs; the packet and the answer's validation; the translate and check workflows; the command line.

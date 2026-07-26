# Editor storage boundaries

`AudioEditorProjectStore` in `../storage.js` is the public facade and owns the
terminal `closing`/`closed` lifecycle. Persistence work is split by domain so a
change can be reviewed without loading the complete storage implementation:

- `project-repository.ts` stores current projects and bounded revisions.
- `key-value-repository.ts` backs the separate settings and analysis domains.
- `source-repository.ts` is the source-domain facade. Its read, write, durable
  record, and background migration workflows live in the corresponding
  `source-*-repository.ts` and `pcm-migration-repository.ts` modules.
- `media-repository.ts` owns original media and video-derivative records.
- `pcm-repository.ts` owns PCM codec fallback, validation, and corruption errors.
- `opfs-repository.ts` owns the `audio-editor-sources` directory, blobs, and PCM
  containers.
- `retention-repository.ts` coordinates cross-domain reachability, temporary
  cleanup, and whole-store clearing.
- `repositories.ts` is the composition root. Repositories receive only the
  narrow backend port defined in `repository-port.ts`.

## Compatibility invariants

- Change the IndexedDB version, store names, indexes, or keys only in
  `indexeddb-backend.ts`, with migration tests.
- Preserve project snapshots and source/media record shapes. These records are
  durable user data, not implementation details.
- Preserve the OPFS directory and path formats. Existing projects refer to those
  paths from IndexedDB metadata.
- Do not bypass `AudioEditorProjectStore` for application calls. Its database
  state and `close()` behavior prevent work from restarting after disposal.
- Keep repository modules acyclic and below the repository's 600-line limit.

When changing a repository, add a focused test for its domain and retain the
facade delegation, lifecycle, IndexedDB, disk-backed-source, and video-storage
tests.

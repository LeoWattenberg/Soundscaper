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
- `media-asset-lifecycle-coordinator.ts` fences admitted retained-media loads
  and streamed writes while clear or close drains their terminal settlement.
- `pcm-repository.ts` owns PCM codec fallback, validation, and corruption errors.
- `opfs-repository.ts` owns the `audio-editor-sources` directory, blobs, and PCM
  containers. Its capability-detected dedicated worker handles the six bounded
  synchronous operation classes; unsupported browsers retain asynchronous OPFS
  and the owning repositories' IndexedDB fallback.
- `retention-repository.ts` coordinates cross-domain reachability, temporary
  cleanup, and whole-store clearing.
- `repositories.ts` is the composition root. Repositories receive only the
  narrow backend port defined in `repository-port.ts`.

## Compatibility invariants

- Change the IndexedDB version, store names, indexes, or keys only in
  `indexeddb-backend.ts`, with schema tests.
- Pre-current databases are not migrated: a version bump wipes the stores and
  recreates the current schema. Nobody relies on stored data surviving an
  upgrade until a release promises otherwise.
- Preserve project snapshots and source/media record shapes within a database
  version. These records are durable user data, not implementation details.
- Preserve the OPFS directory and path formats. Existing projects refer to those
  paths from IndexedDB metadata.
- Do not bypass `AudioEditorProjectStore` for application calls. Its database
  state and `close()` behavior prevent work from restarting after disposal.
- Register retained-media loads with the shared lifecycle before their first
  await. Once a streamed-writer begin passes synchronous argument and signal
  validation, register it before its first awaited backend operation and attach
  its prepared staging identity after preparation returns. Release only after
  publication or cleanup can no longer continue. Propagate staged-path and
  durable-lease cleanup failure through the maintenance barrier; never report
  successful quiescence while cleanup is known to have failed.
- The facade tracks one active clear and one shared close barrier. Clear captures
  its backend admission before its first wait; close installs the permanent
  media and terminal facade fences before its first await, joins an admitted
  clear without revoking that clear's captured availability fallback, and
  returns the same terminal cleanup promise to concurrent callers. Do not extend
  that close-time fallback exception to unrelated pending database admission
  when no clear is active.
- Keep repository modules acyclic and below the repository's 600-line limit.

When changing a repository, add a focused test for its domain and retain the
facade delegation, lifecycle, IndexedDB, disk-backed-source, and video-storage
tests.

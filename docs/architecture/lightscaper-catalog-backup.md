# Photo catalog backup snapshots

The L3 backup enumerator lends the existing catalog repository and retained
original loader to the photo Scape archive exporter. It opens no additional
repository, media store, command owner or writer. Session composition must hold
its existing catalog lease until the export and destination cleanup settle.
The menu and save-target composition is a separate integration packet.

## Snapshot consistency

`readSnapshot` reads the normalized catalog root and its metadata index revision
in one readonly IndexedDB transaction. The root revision and photo count must
agree with the index state. A root without state, state without root, corrupt
identity or disagreeing counters is refused. Photo edits advance the index
revision even when they leave the catalog root revision unchanged.

The enumerator captures that snapshot, then reads ordered pages of at most 64
summaries. Each photo is point-read and its complete derived summary must match
the captured row before original access. Continuations bind the catalog, all-row
scope, initial index revision and last summary key. Pages must advance strictly,
remain within the root count and exhaust exactly that count. An exact full page
may require a final empty page; the maximum is `floor(photoCount / 64) + 1`.

After the last original, the enumerator rereads the root and index revision.
Both must still equal the initial snapshot before it finishes its iterator.
This fences an edit to a photo whose bytes were exported earlier, as well as
definition, title, publication and count changes. A conflicting export aborts
before the ZIP destination closes; it never reports a mixed snapshot as saved.

## Original and archive ownership

The original reference is immutable. Its canonical photo JSON and declared byte
length must fit one existing archive pack before the loader opens its body.
The pack owner supplies this measurement to both the archive sequence and the
backup enumerator, including the magic and record header bytes. The loaded Blob
must match the declared length; the existing pack encoder authenticates its
exact bytes against the persisted SHA-256 digest. Missing or changed originals
refuse the whole backup. Backup writes no catalog rows or custody roots and
never includes disposable previews.

The original loader adapter passes the declared byte length as `expectedSize`
to the shared media repository. That owner compares it against the same stored
record used for body loading before opening or assembling any original chunks.
A mismatched durable media size cannot expand the loader's working set first
and rely on the backup's later Blob-size check. The runtime adapter must also
verify the existing durable original identity before the bounded load.

| Resource | Existing bound |
| --- | --- |
| Summary page | 64 rows, 4 KiB per row |
| Current photo document | 2 MiB |
| Archive pack | 512 MiB; 4,096 records |
| Emitted original chunk | 4 MiB |
| Sequence lookahead | One photo and original Blob handle |
| Cross-pack photo identity inventory | 16 MiB of scalar IDs |
| Archive document | 4 MiB |
| Archive entries / pack descriptors | 4,096 entries / 4,094 packs |
| Manifest | 32 MiB |
| Expanded archive bytes | 64 GiB |
| Browser Blob fallback | 512 MiB; a caller may tighten it |

Original Blob handles do not imply a constant-memory media loader. Repository
loading may assemble bounded retained chunks before returning the Blob; record
preflight prevents opening a body that cannot fit the existing pack. Streaming
output avoids accumulating the whole ZIP, while the Blob fallback owns its
bounded emitted parts. The page, current aggregate, one lookahead, identity
inventory and archive metadata all contribute to the working set. These are
logical resource limits, not measured browser heap or RSS guarantees.

## Cancellation and save-target lifecycle

Closed options admit only a native unmodified AbortSignal, a native writable
destination and an optional tighter Blob maximum before any repository read.
Cancellation joins an outstanding original read rather than detaching its
promise. Once export has acquired the destination, the existing Scape owner
aborts failed output and releases the writer lock, including enumeration,
digest, index-fence and write failures. An already errored native stream need
not call its sink's abort callback; its released lock remains the witness.

The save-target composition owns a prepared target before the exporter acquires
it. It must discard or abort that target on admission, pre-cancellation or
initial snapshot failure as well as on subsequent export failure. The core
does not claim ownership of an unacquired caller stream.

## Verification and integration boundary

The focused tests export actual durable catalog rows and retained originals
across page boundaries, then authenticate the archive through the existing
importer and compare every authored field and original byte. The receiving test
sink is in memory; it does not prove durable production restore publication.
Other tests cover empty catalogs, terminal full pages, stale summaries, changes
to earlier exported photos, missing and incorrect bytes, oversized original
preflight, held-read cancellation, hostile options, root changes and output
failure. The core adds neither a database nor a photo/Scape schema revision.

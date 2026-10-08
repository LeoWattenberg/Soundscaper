# Photo import settings and presets

This bounded L3 packet owns pure import naming, authored metadata/keyword
settings and one catalog-scoped preset settings row. Session, writer lease,
managed publication and UI composition remain with their existing owners.
Options are opt-in within the existing File > Import modal. No default UI,
database migration, photo/Scape schema change or decoder capability follows.

## Contract recorded before implementation

A canonical recipe has three required fields: nullable rename, a partial
metadata object and existing keyword IDs. Omitting the entire recipe preserves
plain import behavior. Metadata permits only title, caption, creator, copyright
and location, using the existing field limits and Unicode text rules. An absent
field preserves the prepared source display value; an explicit empty string
clears its authored value. Immutable extracted facts, including repeated
creators and partial capture timestamps, remain separate and unchanged.

Rename templates contain literal text and exactly the case-sensitive tokens
`{stem}`, `{sequence}` and `{extension}`. Unsupported/unmatched braces refuse
admission. Split the source filename at its last non-leading, non-terminal dot;
the extension excludes the dot and retains its case. A leading-dot name or a
terminal dot has no extension. No trimming, Unicode normalization or invented
extension occurs. Template and result each obey the existing 256-code-unit
filename bound. These are authored display names, not filesystem operations.

Sequence start is an integer from 1 through Number.MAX_SAFE_INTEGER; padding
is 1 through 16. Reserve a sequence by original selected-file index, including
failed selections. Actual gesture overflow and every expanded name are checked
before original reads. The transient plan retains at most 64 source/output
name pairs and one shared frozen recipe, without copying that recipe per file.
Genuine File metadata uses its intrinsic accessor, without subclass overrides.

The session validates the current catalog under its existing writer lease
before building the plan or reading originals. Explicit IDs must all exist in
that fresh root and stay within 1,024 memberships. Apply these settings AFTER
source metadata extraction and before the existing extracted-keyword resolver.
Explicit memberships have priority at capacity; unresolved extracted keyword
facts retain the existing notices and immutable extraction. Final managed
publication independently checks current references. Only metadata.fileName
changes during rename: selected File.name, outcome/receipt source names,
original name/body/SHA, capture/orientation facts and develop versions persist.
The transformed photo still obeys the existing 2 MiB document limit; no fact is
discarded to make an oversized result fit.

## Preset storage and finite resources

One namespaced settings key per catalog stores a closed schemaVersion 1 row
with kind photo-import-presets, catalogId, revision and at most 16 presets.
Each preset has a stable ID, a name and the complete recipe. This is a new
local settings format, not a change to the database or photo schema. Read only
that exact key through the existing settings get/putIfAbsent/replaceIfCurrent
port. No inventory scan, per-preset body store or new custody owner is added.

The complete normalized row is bounded by 10 MiB UTF-8 JSON. The maximal fixture
uses sixteen presets, five 16,384-code-unit metadata fields each, 1,024 distinct
128-character keyword IDs per recipe, 256-code-unit names/templates, a maximal
catalog ID and safe-integer revision/sequence. Existing safe text admits lone
surrogates, which JSON escapes at six bytes per code unit. Exact serialized
sizes are 627,374 bytes for one maximal recipe and 10,065,352 bytes for the full
row, below the 10,485,760-byte cap with 420,408 bytes headroom. Sixteen maximal
keyword-only recipes already require 2,149,896 bytes; 768 KiB cannot promise
full sixteen-slot capacity. Admission checks dense counts/closed scalar fields
before serializing. Future/corrupt or oversized rows refuse without replacement.

Preset CAS retains at most four row equivalents (40 MiB), a conservative JSON
UTF-16 serialization (20 MiB), UTF-8 encoding (10 MiB), and bounded fresh-root
admission/scalar work within a 96 MiB serialized-equivalent envelope. This
counts owned representations, separately from engine object overhead, native
IndexedDB buffers, garbage collection and process RSS. The maximal canonical
string payload itself is 3,418,240 UTF-16 units, or 6,836,480 bytes per row.
The catalog session admits one preset read or write at a time and refuses
overlapping requests without queuing them. Aborting a caller does not release
this slot until its native settings operation settles. Dialog replacement or
reopening cannot overlap that work, and session close joins it before releasing
storage resources.
Preset operations do not read original/media bodies or grow gesture decode
budgets: 64 files, 64 MiB/original, 512 MiB/gesture, one decoded original at a
time, and the existing 60-second per-file deadline remain unchanged.

Missing rows read as revision 0; first creation writes revision 1 using
putIfAbsent. Later saves/deletes compare the exact validated stored row and
increment its revision once. Deleting the last preset persists an empty row,
avoiding revision reset/ABA. Stale writes require explicit reload rather than
automatic retry. Save validates keyword IDs against the supplied fresh root;
read retains stale IDs for explicit import-time refusal. Native cancellation
is checked before reads/writes and after reads. A successful durable CAS
acknowledgment wins a cancellation arriving with that acknowledgment. Lost
acknowledgments reconcile only the exact intended row, never a later winner.

## Test-first gates and stop condition

Node tests cover token/extension/Unicode cases, sequence overflow and failed
slot gaps, hostile getters before ports, omitted/empty authored fields,
unchanged original/extracted/develop identity, and missing keyword refusal
before bytes. Preset tests prove the exact maximal row, counts/byte/schema
refusal, first creation, concurrent CAS conflicts, empty-row revision retention,
lost acknowledgments, late cancellation and settings-key isolation. Focused
strict TypeScript, lint, size and diff gates accompany meaningful Node tests.

The session composes these helpers with its existing writer and lifetime,
retaining bounded durable per-file acknowledgments on cancellation. Native
browser tests qualify original preservation, preset persistence and interrupted
publication recovery through the production session and storage adapters.
Opt-in menu composition remains a separate UI packet. No new import format,
RAW/HEIC admission, pixel transform or assistance runtime is activated.

# Opt-in photo import options

The existing File > Import photos dialog owns the selected FileList and working
authored recipe. Import options start collapsed. Expanding that section mounts
the preset and keyword controls; opening the plain importer does not request
preset settings, keyword names or original bytes. No additional entry point,
default panel or decoder behavior follows from this presentation packet.

## Authored draft and borrowed ports

The controlled recipe contains nullable rename, partial authored metadata and
existing keyword IDs. A checked metadata override includes its field, even
when blank; an unchecked field is omitted. Plain import omits the complete
settings option. Input text preserves Unicode and case. Naming templates alter
catalog display names only; the selected File, scalar receipt source name,
retained original digest/name and immutable extracted facts remain independent.
The product applies authored overrides after extraction under its writer.

Choosing a named preset does not change the working recipe. Explicit Load
detaches the chosen recipe. Reload refreshes inventory while keeping the draft,
selection, name and allocated retry ID. A conflict retains those same values.
Delete changes inventory and selection after acknowledgment while preserving
the working recipe. The UI allocates a new preset ID once and reuses it through
failed save attempts; it never retries a stale CAS automatically.

Preset callbacks are stable within a session factory generation. They borrow
the existing session's serialized settings read/write ports. Canceling or
unmounting an observer aborts its signal and prevents late UI publication; it
does not claim that IndexedDB has settled. The session retains its one-active
preset slot until the native request finishes, rejects overlaps without a
queue, and joins that operation during close. A factory replacement waits for
the old session's close before opening a new storage owner.

The keyword controls reuse the App-owned definition reader and existing
definition selector/name widgets. They display at most 64 selected keyword
names at once and preserve all unseen IDs from loaded presets. Only explicit
Add or Remove changes the recipe. Removed or missing catalog definitions remain
visible as unavailable rather than silently deleting authored memberships.

## Gesture acknowledgment and cancellation

The pure shared import helper snapshots authored scalars before lazy session
acquisition. Its collector stores at most 64 original source names and detached
scalar receipts. Receipt index and fileName must match the selected source;
renamed display names cannot replace this provenance. Accessors, unknown fields,
sparse arrays and conflicting durable photo identities refuse admission.
Duplicate publication callbacks have no second effect. The collector retains
no File, Blob, frame, catalog aggregate or native resource.

The session's public import return remains the final per-file item array. Its
optional synchronous acknowledgment callback exposes verified durable
publication before later promotion or cancellation. The workflow collects
those callbacks, merges final results once, and invalidates an old library
cursor before refresh. A completed final array is reviewable even if every
selected file failed. An incomplete final array refuses a finished completion.

A pre-acknowledgment failure, cancellation or busy refusal preserves the dialog's
selected files and working draft. The dialog awaits the workflow's outcome and
closes on acknowledged results or explicit Cancel. Known publications survive
a later exception or abort with completion failed or cancelled. Their receipts
remain visible in the existing opted-in library with an interrupted status;
no unfinished selection is relabeled finished. Refresh failure retains known
receipts and clears the unusable cursor. The returned outcome and published
state retain the same truth even when the native operation finishes late.

Explicit Cancel aborts that gesture's signal. Registering the pending observer
before invoking borrowed callbacks handles synchronous unmount. Page changes
do not replace the form's callback generation. Factory replacement hides the
old dialog, aborts its demand and fences old acknowledgments from replacement
state; callers still receive truthful durable receipts. Callback collection
ends when the import promise settles, so a retired observer cannot overwrite a
later gesture.

## Finite resources and qualification

Presentation retains one selected batch of at most 64 File references, one
working recipe, one detached gesture recipe, at most 64 scalar source names and
receipts, and one pending import. Source names use the existing 256-code-unit
admission bound and are refused before lazy acquisition without truncation.
Presentation reads no File body. Metadata has five
fields of at most 16,384 code units; template text has at most 256; memberships
have at most 1,024 IDs of at most 128 code units. The active display contains one
64-row keyword selector and one 64-name membership page. Preset inventory has
at most 16 recipes and uses the existing 10 MiB settings-row bound and serialized
session owner. Object detachment reuses immutable strings; no original-sized
buffer or JSON serialization is introduced in presentation.

Strict Node and React tests qualify blank/omission, Unicode, explicit preset
loading, conflict/reload/delete draft retention, stable retry IDs, unseen
keyword preservation, source-bound acknowledgments, post-ack cancellation,
busy refusal, observer retirement and actual File-menu composition. Shared
chunk membership tests keep these scalar helpers apart from timeline control,
storage and copy passengers. Native tests qualify the completed production File
menu in English and German on Chromium and Firefox: refused drafts retain their
selected files, presets load explicitly and persist through reopen, authored
overrides preserve extracted facts, and two logical photos deduplicate exact
original bytes while retaining their Unicode source names. Arabic copy isolation
and existing product navigation also pass on both engines after all three
product builds. No RAW/HEIC format, develop preset, pixel processing, schema
change or assistance runtime asset update is claimed by this UI packet.

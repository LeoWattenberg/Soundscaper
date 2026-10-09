# Saved Develop presets during managed import

File > Import photos > Import options exposes an optional saved Develop preset
selector. Its initial section is collapsed. Opening the plain importer reads
no Develop preset inventory; choosing a preset is explicit. The existing
metadata, rename and keyword recipe remains independent.

## Versioned capability and capture

The old closed `PhotoLibraryImportRequestOptionsV1` contract is unchanged.
The optional `PhotoLibraryDevelopImportPortV1` adds a closed schema-version-1
request whose choice contains only catalog ID, preset ID and expected preset
revision. Its current-library `listPresets` method also works before any photo
exists. Presentation receives at most sixteen scalar identities, names, scopes
and digests, without stored settings bodies.

Admission detaches the choice before lazy initialization. Import pins the
constructor-selected settings method and receiver before awaiting its existing
writer. Under that same writer lease, it checks the current catalog, reads the
exact preset key once, validates the complete closed row, and requires the
selected revision and recipe to exist. Missing, malformed, stale or foreign
choices refuse before preparation or original storage. Production point-entry
reads distinguish missing rows from physically present invalid values.

The gesture captures one immutable recipe before preparation. A later external
row replacement or deletion cannot mix recipes across its selected files. It
neither updates nor deletes the saved preset row. An explicit new selection
captures a new revision; Reload and collapsing/reopening the section preserve
the existing selected revision rather than silently choosing newer settings.

## Application and ownership

The existing naming and metadata plan applies after source extraction. The
captured full or partial recipe then uses the shared Develop merge operation
on the prepared photo's active version. Unselected effect groups, geometry and
local adjustments retain their existing semantics. Other versions, original
identity, source bytes, extracted facts and authored metadata are preserved.
Digest deduplication may canonicalize the original storage key through its
existing verified-custody owner.

Import accepts only unpublished revision-zero photos. Changed settings create
or append a bounded per-version history entry using the preset's authored name
and the existing version creation clock. The initial import remains one photo
publication at revision zero; history can return to its prepared settings.
Existing snapshots remain intact. Document/history byte limits still apply;
the importer does not discard facts or settings to make an oversized photo fit.

The gesture keeps its existing 64-file limit, one preparation/decode owner,
per-file failures, original verification, journal, writer lease and publication
acknowledgments. A known publication survives later cancellation. Cancel and
Close join held settings reads before resources retire. The selector likewise
keeps pending ownership until its canceled read settles, including across
collapse and callback replacement. Retired list handlers cannot authorize a
fresh inventory revision.

## Evidence and remaining qualification

Strict Session tests exercise full and partial settings, original bytes and
deduplication, failed selection slots, selected/anchor namespace separation,
captured-body consistency, early refusal, method pinning, held cancellation,
durable acknowledgments and history. React tests exercise scalar-only choices,
explicit selection, retained revisions, stale handlers, whole-dialog admission
and joined list retirement. The English/German browser witness authors both
recipes through Develop menus and applies them through Import options before
reopen, with exact original-byte observations.

The browser witness and combined build/full gates await fresh qualification of
this committed source. No raw format, deeper pixel profile, photo schema,
archive format, desktop target or assistance-engine closure changes. A manual
**Update AI assets** run is not required.

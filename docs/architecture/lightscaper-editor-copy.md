# Lightscaper editor copy ownership

The initial site graph retains four Lightscaper brand and route strings:
`lightscaperTitle`, `lightscaperMetaDescription`, `photoEditor`, and
`workspacePhoto`. The 46 photo menu, library, culling, and metadata strings
belong to the lazy Lightscaper editor graph. This extraction preserves their
flat catalog keys and English/German values.

The initial graph keeps its existing 255,350-byte, ten-request ceiling; each
production chunk keeps its 500,000-byte ceiling. The focused copy chunk has a
400,000-byte split target. Measured startup savings must be claimed through the
existing startup-budget tightening command after the coordinated build; source
string size alone does not establish a production saving.

`lightscaper-editor-copy.ts` owns the bundled English and German editor strings.
The complete canonical catalogs spread that source so the existing translation
inventory and automatic writers continue to discover the same flat identities.
Committed locale catalogs and their loader index need no manual changes.

`use-lightscaper-editor-copy.ts` combines only those editor strings with the four
site strings. Its first render uses the bundled English or German fallback.
For other published locales it asks the shared catalog loader for entries
current against this small English reference. Stale source tuples, unrelated
keys, and unacceptable translations remain filtered by that loader. Failed or
late requests retain the current bundled copy; a prior locale cannot replace
the active locale. An optional loader map supports controlled lifecycle tests.

The hook imports no complete catalog, inventory, translation runtime, or Sound
or Frame editor copy. A focused semantic chunk owner keeps the hook and its
source together without assigning the Lightscaper shell to the timeline shell.
The editor App and optional metadata dialog select the hook at their own lazy
entry points. Existing menu reachability and visible controls stay unchanged.

Verification covers exact bundled values and flat inventory identities,
automatic-writer discovery, accepted and retired translation tuples, locale
replacement and unmount during held loads, and static graph/chunk ownership.
The coordinated all-product build passes startup and chunk ceilings: Lightscaper
initial bytes are 249,090 raw and 67,845 Brotli, with six requests. The all-product
maximum initial graph is Frame at 253,795 raw bytes; the tightening command has
no smaller candidate with its required five-percent headroom. Native English/
German metadata and privacy workflows pass in Chromium and Firefox. The
published Arabic menu and lazy importer pass in all three engines without a
complete timeline copy chunk. This changes no AI
runtime closure and requires no manual **Update AI assets** run.

# Shared HDR exposure merge

HDR merge creates an independent generated Original from two through nine
canonical Originals. Raster inputs are opaque, oriented sRGB8; RAW inputs are
the canonical linear sRGB16 decoder output. Saved creative Develop settings,
camera previews and optional RAW headroom/recovery profiles do not supply the
merge samples. Inputs share an extent and fit the 8,192-side, 16-megapixel and
64 MiB per-Original admission limits.

Each input has an explicit positive exposure multiplier. The reference input
has multiplier one; two means twice its captured exposure. Metadata may help a
product suggest these controls but cannot replace them. Raster values use the
declared sRGB response assumption. Clipping weights describe the rendered input
profile, rather than claiming sensor reliability or recovering absent detail.

## Menu-owned authoring

The Current Photo menu and Frame Effect menu open the same scalar authoring
dialog. The Photo operation captures selected Photo revisions; the Frame
operation captures two through nine distinct timeline image sources and the
exact project selection. Generated HDR Originals cannot be bracket inputs.
Sources remain unchanged, and the result is a new managed Photo or Project Bin
image respectively.

Exposure advice comes only from immutable capture metadata: every source must
have a positive shutter time and matching, present aperture and ISO. Authored
metadata does not supply this advice. Selecting another reference rebases every
exposure multiplier; an out-of-range result refuses rather than clamps it.

Text fields preserve incomplete edits, including an empty filename or a
negative-decimal exposure draft. Preview and Merge require every field to be
valid; correcting one field does not clear another field's error.

Preview performs the actual native merge without publishing a result. Only a
fitted, clipped sRGB8 display plane is borrowed for synchronous canvas painting;
the dialog retains scalar controls and diagnostics. Source readers, staging,
the native master and encoded result all retire through their scoped owners.
Close and replacement join accepted work. A detached canvas stays owned until
that join clears its backing. Creation acknowledges the actual native commit
before later cancellation or refresh errors; Frame adoption notices remain
visible beside that acknowledgement.

## Native result and provenance

The generated Original uses `image/x-lightscaper-hdr`, format
`lightscaper-hdr`, and the `.lshdr` suffix. It is a private versioned container,
separate from exported raster formats. Its fixed header authenticates canonical
JSON provenance, followed by tightly packed top-left RGBFloat32LE. Signed,
above-one, tiny and negative-zero samples survive byte-for-byte; native decode
adds alpha exactly one. Finite samples, exact geometry, padding, lengths and
provenance are admitted before lending a native frame.

Provenance records each source product, owner, source identity and revision,
Original name, MIME type, SHA-256, length and extent, canonical profile,
exposure multiplier, measured translation and alignment confidence. It also
records the selected reference, deghosting controls and exact common output
intersection. Lightscaper source identity means the Photo ID; its private
publication guard separately retains the complete Original locator and facts.

A generated Photo starts with one default master. It does not copy a source's
crop, masks, repairs or history, and does not invent a single exposure's EXIF or
IPTC facts. Its immutable Original remains available when later Develop edits
reduce exposure or otherwise reveal values beyond the display range.

## Execution and temporary storage

The shared owner borrows and stages the reference first, then each remaining
source serially. Every native borrower joins before the next source opens.
Ward median-threshold registration measures integer translations bounded to
128 pixels and refuses unsupported overlap or ambiguous texture. Explicit
alignment-none requires zero translations. Only a copied reference guide
persists between source borrows; all guides retire before the floating-point
master is allocated.

Fusion reads dedicated windows for cores at most 256 by 256 pixels, including
the two-pixel motion halo. Exposure-normalized, endpoint-weighted linear RGB
retains static highlights. Reference deghosting selects complete reference RGB
for inconsistent moving regions. Diagnostics retain unresolved and clipped
cases; endpoint fallback does not claim reconstructed detail.

Canonical staging requires persistent OPFS before decoding begins. It reuses
the existing binary repository, `audio-editor-exports` directory, temporary
export file leases and startup recovery. Opaque owner handles identify at most
nine 128 MiB planes. Writes and reads are at most one MiB, and closed native
snapshots are verified against the written SHA-256. There is no whole-image
memory fallback or additional operation queue.

Accepted writes and range consumers join before exact file deletion and lease
release. The master and all staged files retire before the encoded result is
lent to publication. A cleanup failure suppresses an uncommitted result and
remains distinct from an opaque primary failure. An ended lease is released
even when deletion fails, so existing recovery can retry the retained path.
The encoded result is authenticated and wiped after its joined consumer.
The execution phases are admitted against a one-GiB working limit, with the
native HDR codec retaining its separate 768-MiB ceiling.

## Durable publication and Frame interoperability

Lightscaper's named generated-HDR publication policy admits one result up to
196 MiB while ordinary file import retains its 64 MiB limit. It reuses the
existing intent, Original digest/dedupe, provisional roots, native catalog ACK,
promotion and recovery. The catalog transaction checks every selected Photo
revision and complete Original identity in the same transaction that inserts
the result and its indexes. Comparing the catalog root alone is insufficient:
an ordinary Photo save advances its own revision without advancing that root.

A positive native publication ACK remains authoritative after later source
edits or cancellation. Recovery settles custody from the committed result and
does not replay source guards against inputs which may since have changed.

Frame captures the complete live project and selection before lazy loading.
After admission it joins the existing forced snapshot preparation, then checks
that exact captured project again before opening native readers. This persists
selection changes which do not mark the editor dirty. Publication retains the
complete project and base-revision comparison in its native transaction.

Current Frame Source5 retains the exact generated Original and an explicit HDR
receipt containing native descriptor, RGB payload SHA-256 and provenance
SHA-256. FramePack1 byte pixels remain a presentation cache. Native rendering,
authoring, save/resource audit and archive handoff authenticate the HDR body;
reverse Photo preparation retains the same Original and saved recipe. Old
Source1–4 formats, RAW receipts and their capacity policies remain unchanged.
Phase admission may refuse a large combination of pack, resources and native
working planes before loading bodies, even when each individual declaration
fits its format limit.

Qualification covers 185 selected Lightscaper tests and eight English/German
Chromium/Firefox workflows. The creation workflows import RAW DNG brackets
through the pinned decoder, use both products' menus and preview, and verify
native result bits against independent references, provenance, source custody
and reopened headroom. Separate Source5 workflows
poison the byte cache and exercise masks, Clone, native save/reopen, Scape and
editable reverse Photo delivery. The [roadmap](../../roadmap-lightscaper.md)
retains the remaining GPU, desktop and broader milestone exit gates.

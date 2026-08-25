# Post-milestone-8 Framescaper image plan

> Owning source for Framescaper timeline-image product, project-model,
> conversion, runtime, security, and qualification decisions. The
> [roadmap](../roadmap.md#8i-post-milestone-8-framescaper-image-extension)
> owns sequencing and closure status.

## Outcome and boundaries

Framescaper imports static, animated, and multipage raster files into the
Project Bin and timeline. One selected file becomes one source and one grouped
clip; its pages or animation frames remain internal to that clip. The original
file is retained byte-for-byte and a deterministic, timeline-ready sRGB RGBA8
frame pack is stored beside it.

The feature is Framescaper-only and is reached through existing menus and
import surfaces. It adds no always-visible control. Soundscaper may preserve a
newer project opaquely but does not author image clips. Existing V28 `still`
sources and the dormant numbered-file image-sequence model remain unchanged
and distinct.

The first release does not provide editable PSD layers, vector or document
rendering, animation-loop controls, RAW-development controls, or speculative
interpretation of ambiguous HDR data.

## Product and timeline contract

- Rename Framescaper's `Generate > Add Still…` command to `Add Images…` while
  preserving the command identity and existing single-still behavior.
- Admit images through Framescaper's normal media picker, Project Bin picker
  and drop, and timeline drop. Desktop uses a Framescaper-specific combined
  media file purpose rather than broadening Soundscaper's picker.
- `Add Images…` always targets the timeline. Normal media import targets an
  open Project Bin and otherwise starts at the playhead. Timeline drops start
  at the pointer time.
- Preserve picker or drop order. Multiple successful image files are placed
  sequentially on one lane. Prefer the selected unlocked video track and then
  a suitable unlocked video track. If the complete planned range collides or
  no suitable lane exists, create one `Images` track; never ripple or
  overwrite existing clips.
- Import each file atomically. A failed file leaves no source, storage body,
  clip, or timeline gap; later files continue and earlier successful imports
  remain independently undoable. Cancellation stops future work without
  reverting prior successes.
- Mixed image, audio, and video selections are classified independently.
  Existing audio/video behavior remains intact and the UI reports one
  per-file completion summary.
- Static images and untimed pages last exactly five seconds each. Positive
  embedded delays are preserved as integer microseconds; missing, zero, or
  invalid delays use the five-second fallback. Embedded loop counts are
  ignored and one finite cycle is imported.
- Sample image time with integer rational arithmetic. Frames shorter than a
  project frame may be skipped rather than lengthened. Extending a clip holds
  its final frame; trimming and splitting preserve the exact source tick.

## V30 project and asset contract

Framescaper schema V30 derives from V28. V29 remains Soundscaper-owned. V30
explicitly reimports V28; V25 and V26 remain opaque, and unknown later schemas
remain read-only. Existing V28 `kind: "still"` records are preserved without a
body rewrite.

V30 adds strict `kind: "image"` source and clip records. A source owns one
immutable body whose storage key equals its source id. The descriptor records
the original filename, MIME hint, recognized format, byte length and digest;
canonical width, height, alpha, frame count, microsecond duration and timing
mode; and a digest-bound conversion receipt. A clip records its source,
sequence placement, frame length, and decimal-string source-start ticks.

The body uses MIME `application/vnd.framescaper.image-asset`, magic `FSCIAB01`,
and a versioned little-endian layout containing:

1. a fixed header and whole-section bounds;
2. the exact original file;
3. a canonical JSON conversion receipt;
4. a fixed-size frame index with integer PTS and duration; and
5. independently zlib-compressed, top-left row-major, straight-alpha sRGB
   RGBA8 frames.

Every index entry carries compressed and raw lengths and digests. Readers
validate the body digest, section arithmetic, index ordering, exact inflated
lengths, and both frame digests before exposing pixels. Animation disposal and
blend are coalesced before persistence. Temporal formats retain their logical
canvas and offsets; independent pages are centered without scaling on the
largest page canvas. Fully transparent output pixels have zero RGB.

Preview, thumbnails, web export, and native export share one frame-pack reader
and timing mapper. History, clipboard, storage retention, garbage collection,
`.scape`, project handoff, and the desktop library treat the body as one
immutable asset. Clipboard reuse is digest-based; an id conflict copies the
same bytes to a new source/storage identity without recompression.

Projects containing image sources declare
`org.soundscaper.capability.timeline-images-v1`. The requirement is absent when
no V30 image source exists.

## Format, decoder, and color contract

Classification is byte-signature and metadata based; an extension or MIME
type is only a picker hint. The reviewed raster tier is:

- JPEG/JFIF/MPO, PNG/APNG, GIF, WebP, BMP/DIB, and ICO;
- AVIF, HEIF/HEIC, TIFF/BigTIFF, JPEG 2000, JPEG XL, QOI, TGA, and PCX;
- flattened PSD/PSB;
- DNG, CR2/CR3, NEF/NRW, ARW/SR2, RAF, ORF, and RW2; and
- OpenEXR only when its tagged color transfer passes the admitted policy.

SVG, PDF/PostScript, AI, XCF/ORA, DICOM, DDS/KTX, PNM/PFM, Radiance HDR,
pseudo-coders, URLs, filesystem paths, and arbitrary delegates are excluded.
ICO selects the highest-resolution rendition, PSD/PSB uses the visible
composite, and RAW develops one primary image with recorded deterministic
settings.

Decoding is layered:

1. browser-native APIs for qualified common 8-bit SDR files;
2. the existing pinned FFmpeg runtime for admitted standardized high-bit or PQ
   inputs it can decode; and
3. a lazy, pinned Q16-HDRI ImageMagick WASM runtime for reviewed remaining
   formats.

Fallback occurs only after a typed unavailable or unsupported result. Invalid,
spoofed, oversized, timed-out, cancelled, or security-rejected input is never
retried in a more permissive decoder.

Valid ICC-tagged SDR and wide-gamut sources convert to sRGB with relative
colorimetric intent and black-point compensation. Tagged PQ converts through
float linear Rec.2020 using a fixed Mobius tone-map recipe and a 100-nit sRGB
target. Peak is valid MaxCLL, then mastering maximum, then 10,000 nits. HLG,
scene-linear, contradictory, untagged high-dynamic-range, and ambiguous
profiles fail visibly rather than being guessed. Alpha is preserved. The
receipt records decoder and runtime versions, input signature, dimensions,
orientation, bit depth, profile hashes, peak choice, recipe, and every lossy
conversion warning.

## Runtime and security contract

The ImageMagick API and lockfile are pinned. The production runtime is a
reproducible Q16-HDRI build from pinned ImageMagick, Emscripten, and delegate
sources rather than an unreviewed general-purpose coder installation. Its WASM
and delegate assets are versioned outside the Pages bundle, downloaded only by
a user-initiated import that needs them, digest-verified before execution,
cached by version, and packaged with Electron.

Run decoders serially in disposable workers with no network, shell, path,
filesystem, or arbitrary delegate authority. ImageMagick uses an affirmative
coder policy, 384 MiB memory limit, and disabled disk/map storage. FFmpeg is
single-threaded with no stdin or network and fixed virtual paths. Cancellation,
timeout, and failure terminate the worker.

Initial hard limits are 64 files and 512 MiB input per gesture; 64 MiB per
file; 8192 pixels per side; 16,777,216 SDR or 8,388,608 high-precision pixels
per frame; 4,096 pages/frames; 512 MiB decoded RGBA and canonical body per
file; 4 MiB ICC; 8 MiB metadata; 24 hours; and 60 seconds per file. Violations
fail before allocating the claimed output where metadata permits.

Runtime activation requires a digest-pinned manifest, positive coder policy,
reproducible build command and sources, corresponding-source payload,
third-party notices, delegate licensing and patent review, threat-model and
production-security bindings, and packaged/web runtime evidence. Runtime
assets remain absent from the initial application and production JavaScript
chunks remain below the repository ceiling.

## Work packets

### 8+I-0: Plan and compatibility

- Land this owner plan and roadmap sequencing first.
- Add V30 predicates, capability requirement, V28 reimport, and future-schema
  custody tests without changing V25/V26 treatment.

### 8+I-1: Deterministic image asset

- Implement the strict source/clip model, frame pack, receipt, validation,
  storage ownership, commands, history, clipboard, and archive contracts.
- Start with fixtures and corrupt-body tests before production writers/readers.

### 8+I-2: Native decoder and timeline rendering

- Implement signature classification and native SDR decoding in a cancellable
  worker, then shared preview/export frame sampling and bounded caching.
- Carry static files, embedded animation timing, multipage timing, orientation,
  transparency, disposal, and conversion notices through save/reopen.

### 8+I-3: Import surfaces

- Replace Add Still with the multi-file Add Images workflow and extend media
  import, Project Bin, drag/drop, collision placement, progress, partial
  failure, accessibility, selection, and undo behavior.
- Extend the desktop file contract without exposing paths or broadening the
  Soundscaper surface.

### 8+I-4: FFmpeg and ImageMagick tiers

- Add typed decoder routing, admitted high-bit/PQ conversion, and the pinned
  external Q16-HDRI ImageMagick runtime with its fail-closed policy.
- Enable each non-native format only after its licensed fixture, color,
  malformed-input, resource-limit, and runtime-unavailable tests pass.

### 8+I-5: Qualification and activation

- Complete web and packaged Electron workflows, deterministic render parity,
  archive/handoff tamper tests, runtime publication audits, memory and timeout
  budgets, notices, security evidence, and user documentation.
- Activate the capability only when every advertised row has passing evidence;
  unqualified formats remain absent rather than silently falling back.

## Exit gate

- Static, animated, and multipage admitted fixtures survive import, edit,
  preview, render, save/reopen, clipboard, `.scape`, and desktop handoff with
  exact source timing and authenticated asset bodies.
- Menu, picker, Project Bin, and drop workflows pass collision, mixed-media,
  partial-failure, cancellation, focus, status, undo, and accessibility tests.
- Browser and native renderers agree on canonical image pixels and frame
  selection, including orientation, alpha, ICC conversion, PQ tone mapping,
  animation disposal, trim/split, transitions, effects, and final-frame hold.
- Every malformed, spoofed, bomb, timeout, offline-runtime, forbidden-coder,
  unsupported-profile, and tampered-body fixture fails closed without retained
  partial state.
- Runtime hashes, sources, policies, licenses, notices, security evidence, and
  production size gates pass before the roadmap status advances to accepted.

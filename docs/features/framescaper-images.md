# Framescaper image media

Framescaper imports supported raster images as authenticated, editable timeline
media. The browser-native vertical slice is implemented. Extended converter,
multipage, high-precision, and color-managed formats remain outside the active
surface until their runtimes and fixtures are admitted.

The feature is reached through the existing image and media import menus. It
adds no always-visible control. Soundscaper can preserve unsupported foreign
state through the normal project rules, but it does not author Framescaper image
clips.

## Current import surface

The active decoder recognizes bytes by signature rather than trusting a file
extension or MIME hint. It admits JPEG, PNG, GIF, WebP, and BMP only when the
browser-native route can decode the reported static or animated topology as
8-bit sRGB. A recognized format without an admitted decoder fails visibly; it
is not retried through a more permissive route.

One selected file becomes one immutable image source and one image clip. The
original bytes are retained inside the source's canonical body. Static images
and frames without a positive embedded duration receive the five-second timing
fallback. Animated frames retain positive embedded durations for one finite
cycle; authored loop counts are not project state.

Import preserves selection order and places successful clips sequentially.
Each file publishes atomically. A failure leaves no source, body, clip, or
timeline gap, while earlier successful files remain independently undoable and
later files may continue. Cancellation stops future work without undoing
already published files.

The current product workflow is covered by
[`tests/browser/framescaper-images.spec.js`](../../tests/browser/framescaper-images.spec.js).
Decoder routing and publication are owned by
[`timeline-image-native-decode-v1.ts`](../../src/common/editor/timeline-image-native-decode-v1.ts)
and
[`editor-image-import-coordinator-timeline-image.ts`](../../src/framescaper/editor-image-import-coordinator-timeline-image.ts).

## Project and asset model

The family-v1 project stores closed version-1 image source and clip records. A
source owns one body whose storage key equals its source ID. Its descriptor
binds:

- the path-free original name, MIME hint, recognized format, length, and SHA-256;
- canonical width, height, alpha, frame count, duration, and timing mode;
- the complete asset length and SHA-256; and
- the canonical conversion-receipt SHA-256.

The body MIME type is `application/vnd.framescaper.image-asset`; its magic is
`FSCIAB01`. The versioned little-endian frame pack contains the exact original,
a canonical JSON conversion receipt, a fixed-size frame index, and independently
zlib-compressed top-left row-major straight-alpha sRGB RGBA8 frames. Every frame
index binds compressed and raw lengths and SHA-256 digests. Fully transparent
output pixels have zero RGB.

Readers authenticate the complete body before exposing it, then validate
section arithmetic, the original and receipt bindings, ordered timing, exact
inflated lengths, and both frame digests. Preview, clipboard, archive, browser
export, and desktop storage use the same immutable body instead of creating
parallel image authorities. Projects containing these sources declare
`org.soundscaper.capability.timeline-images-v1`.

The exact model, limits, and timeline mapping are owned by
[`timeline-image-model.ts`](../../src/common/editor/timeline-image-model.ts),
and the authenticated body is owned by
[`timeline-image-frame-pack-v1.ts`](../../src/common/editor/timeline-image-frame-pack-v1.ts).

## Timing and editing

Image time is expressed as integer microsecond ticks and mapped to sequence
frames with rational arithmetic. Trimming and splitting preserve the source
tick. Extending a clip holds its final frame. A frame shorter than a sequence
frame may be skipped rather than lengthened.

Image sources participate in ordinary history, selection, placement, clipboard,
storage retention, garbage collection, Scape, project handoff, preview, and
video export. They remain distinct from generated stills and the native
numbered-file image-sequence delivery model.

## Resource and trust boundary

Admission occurs before expensive allocation wherever metadata permits. The
current hard ceilings are:

| Resource | Ceiling |
| --- | ---: |
| Files per gesture | 64 |
| Input per gesture | 512 MiB |
| Input per file | 64 MiB |
| Width or height | 8,192 pixels |
| SDR pixels per frame | 16,777,216 |
| High-precision pixels per frame | 8,388,608 |
| Frames per file | 4,096 |
| Decoded RGBA per file | 512 MiB |
| Canonical body per file | 512 MiB |
| ICC data per file | 4 MiB |
| Metadata per file | 8 MiB |
| Duration per file | 24 hours |
| Decode time per file | 60 seconds |

The source of truth for these values is
[`image-import-admission.ts`](../../src/common/editor/image-import-admission.ts).
A change to a ceiling must update that authority and its adversarial tests; this
document is descriptive.

## Formats not yet admitted

FFmpeg and ImageMagick converter tiers, multipage documents, RAW formats,
high-precision sources, and general ICC/PQ conversion are not part of the
active image-import route. SVG, PDF/PostScript, URLs, filesystem paths, and
arbitrary delegates are deliberately excluded.

Adding a decoder requires a typed route, licensed fixtures, deterministic
canonical pixels and timing, resource-limit and malformed-input coverage,
runtime-unavailable behavior, source and notice evidence, and the applicable
security controls. Runtime assets must remain lazy and outside the initial
Pages bundle. A format is absent until its complete route passes those checks;
the importer must never silently reinterpret it through another decoder.

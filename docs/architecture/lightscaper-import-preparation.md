<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Photo import preparation foundation

`preparePhotoImportGestureV1` accepts genuine selected `File` objects, a catalog
root snapshot, a parallel ownership array (`photoId`, `originalId`,
`originalStorageKey`, `masterVersionId`), an injected UTC `createdAt`, optional
virtual `folderId`, and an optional cancellation signal. It validates every
definition and the complete gesture before reading any original.

The iterator yields one `prepared` or `failed` outcome with file index/name. A
failed file does not hide later files; admission errors and caller cancellation
abort the gesture. Reads, decode and outcomes are serial. Stop iteration to stop
starting more work. The custody owner must retain the original, verify its binding,
publish the photo, and release transient decode artifacts before requesting the
next outcome. Preparation itself does not write storage or publish documents.

The original Blob snapshots the exact single native File read, independent of
the decoder's writable input. Its SHA-256 and length must agree with the shared
decoder publication. EXIF/IPTC extraction uses those same bytes; repeated facts
and unknown capture offsets remain in immutable extraction, separate from authored
metadata. Ordered keyword names await catalog resolution. Each master starts
with validated process-v1 develop state and the injected creation timestamp.

Photo filenames preserve the selected Unicode string exactly, including
decomposed characters. Selected filenames are bounded to 256 UTF-16 units;
persisted originals retain the existing 512-unit admission. The photo-owned
original normalizer validates exact text with the shared control rules, then
reuses shared still identity, digest, geometry and MIME admission with a fixed
neutral label. The transient shared decode pack uses the filename's NFC label
when it fits the shared 512-unit bound, or the admitted ASCII original ID when
normalization expands beyond that bound. Receipts, authored filename defaults,
original facts and original bytes retain their selected identity.

The shared browser-native decoder owns orientation, sRGB conversion and RGBA8
normalization. Preparation never applies EXIF orientation a second time; it checks
oriented geometry against the source header. `decodeArtifact` is an immutable
shared frame pack with its receipt/digest and embedded original bytes. It is a
transient foundation artifact, not a thumbnail or fit-preview tier.

Hard budgets are 1–64 files, 64 MiB input per file, 512 MiB input per gesture,
8192 pixels per side, 16,777,216 pixels/64 MiB RGBA per static frame, 4096 container
records and 8 MiB metadata. Shared frame-pack output remains capped at 512 MiB;
photo documents remain capped at 2 MiB. No warning override raises these limits.
One 60-second cooperative cancellation deadline covers each file; native File
reads and decoder awaits must settle before another file starts. Synchronous
codec work inherits the bounded shared implementation and cannot be preempted.

Static JPEG, PNG, GIF, WebP and uncompressed BMP structures can use the verified
shared native route. Animation/multipicture declarations, container ICC/HDR
fields and the checked precision/color declarations fail closed before opening a decoder.
The proven EXIF checks inspect ColorSpace, Gamma, embedded ICC and DCF
InteroperabilityIndex through the shared bounded TIFF traversal; unsupported
declarations are refused independently of descriptive text/date extraction.
Unprofiled SDR inputs use the existing browser interpretation; this does not claim
an original color profile. WebP EXIF is refused until the shared metadata reader
supports it. TIFF, RAW, HEIC/AVIF and other unverified routes remain unavailable.
Malformed descriptive metadata stays visible through extraction issues; mapping
notices remain distinct from a file refusal. Browser integration must verify
genuine rotated JPEGs on each supported engine before claiming orientation support.

Container admission follows the primary [PNG specification](https://www.w3.org/TR/png-3/),
[GIF89a specification](https://www.w3.org/Graphics/GIF/spec-gif89a.txt),
[WebP container specification](https://developers.google.com/speed/webp/docs/riff_container),
[JFIF specification](https://www.w3.org/Graphics/JPEG/jfif.pdf), and
[BMP header definition](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/ns-wingdi-bitmapv5header).
EXIF color and DCF interoperability declarations follow the
[CIPA Exif specification](https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf).

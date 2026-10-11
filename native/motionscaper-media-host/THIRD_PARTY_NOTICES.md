# Motionscaper native media helper notices

The Motionscaper helper and its float frame carrier are licensed under
AGPL-3.0-only. It links the same authenticated FFmpeg 9.0.1 static build closure
as the repository's native media build, with its GPL configuration and pinned
codec libraries. The exact component versions, hashes, upstream source locations,
and license notices remain in
`native/framescaper-media-host/THIRD_PARTY_NOTICES.md`,
`native/framescaper-media-host/source-manifest.json`, and
`native/framescaper-media-host/build/ffmpeg-9.0.1-external-sources.json`.

The source manifest pins the reused strict JSON parser and common SHA-256
implementation. This helper admits only its own versioned float frame carrier
and ProRes 4444 output operation. No editorial project, plugin, or source-media
operation is exposed by this executable.

The current FFmpeg `prores_ks` encoder accepts YUVA444P10 input. Motionscaper
retains float32 precision through the carrier, performs unpremultiplication and
the Rec.709 transfer explicitly, and quantizes at that codec boundary. The MOV
uses ProRes 4444 with 16-bit alpha storage; its input precision remains ten bits.
The native round-trip test checks decoded colors, alpha endpoints, partial-alpha
precision, and the exact frame count.

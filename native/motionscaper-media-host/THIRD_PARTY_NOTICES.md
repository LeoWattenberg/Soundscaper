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

Flat MOV delivery admits at most 32,768 frames. This bounds the muxer's retained
sample index independently of the one-frame working set and streamed carrier.
Longer compositions require a different output strategy; the helper refuses them.

Native audio delivery uses a separately versioned float32 interleaved PCM sidecar,
then rounds/clamps once to signed 24-bit little-endian PCM in MOV. Mono and stereo
at 8–192 kHz are admitted. Exact cumulative frame durations determine the sample
count; audio starts at zero in the delivered range. At most 134217728 samples
are admitted in 4096-sample packets (32768 retained MOV audio index entries).
Packets are written in timestamp order without an interleaver queue.

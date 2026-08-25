# Bundled Ogg Vorbis codec notice

Soundscaper's bundled desktop Vorbis runtime contains memory-only WebAssembly
builds of libvorbis 1.3.7 and libogg 1.3.6 from Xiph.Org. The official release
archives and their SHA-256 digests are pinned in `source-manifest.json`. The
payload contains no FFmpeg code.

- libvorbis source: <https://downloads.xiph.org/releases/vorbis/libvorbis-1.3.7.tar.xz>
- libogg source: <https://downloads.xiph.org/releases/ogg/libogg-1.3.6.tar.xz>
- libvorbis license: [licenses/VORBIS.txt](licenses/VORBIS.txt)
- libogg license: [licenses/OGG.txt](licenses/OGG.txt)

The admitted public profile is single-logical-stream Ogg Vorbis encode/decode,
mono or stereo, at the contract's 8–192 kHz sample rates and integer quality
settings 0–10. A strict bounded parser validates Ogg pages, lacing, CRCs, serial
and sequence continuity, Vorbis identification/comments/setup headers, UTF-8
comments, granules, EOS, and source geometry. The libvorbisfile decoder then
independently probes the headers and exact decoded frame geometry. Valid profiles
outside the reviewed subset fall through to another provider; malformed streams
are terminal.

Vorbis encoding is lossy. Soundscaper preserves and reports decoded stream
geometry but makes no sample-exact round-trip claim. The fixed stream serial,
vendor tag, and encoder tag contain no filesystem, host, time, or user metadata.

Soundscaper's wrapper is AGPL-3.0-only. libvorbis and libogg are redistributed
under their retained BSD-style terms in `licenses/VORBIS.txt` and
`licenses/OGG.txt`. Those copyright licenses and this technical review are not a
patent-clearance or non-infringement representation for any use or territory.

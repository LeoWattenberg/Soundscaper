# Bundled Ogg Opus runtime notice

Soundscaper's bundled desktop Opus runtime contains memory-only WebAssembly
builds of libopus 1.6.1 and libogg 1.3.6 from Xiph.Org. The official release
archives and their SHA-256 digests are pinned in `source-manifest.json`.

The public bundled profile is deliberately narrow: Ogg Opus encode/decode at
the mandatory 48 kHz presentation rate, mapping family 0 mono or stereo,
20 ms packets, zero output gain, and 16–256 kbit/s encoding. The strict parser
bounds and verifies Ogg pages, lacing, CRCs, serial and sequence continuity,
Opus headers and tags, packet durations, pre-skip, EOS, and final granule
trimming before the native decoder executes. Valid profiles outside that
reviewed subset fall through to another provider; malformed streams are
terminal.

Opus encoding is lossy. Soundscaper preserves the encoded frame count through
the explicit Ogg pre-skip and final-granule relationship, but makes no
sample-exact round-trip claim. The fixed stream serial and vendor string contain
no filesystem, host, time, or user metadata.

Soundscaper's wrapper is AGPL-3.0-only. libopus and libogg are redistributed
under their retained BSD-style terms in `licenses/OPUS.txt` and
`licenses/OGG.txt`. The libopus notice also records the upstream royalty-free
patent-license disclosures. Those disclosures and this technical review are
not a patent-clearance or non-infringement representation for any use or
territory.

# TwoLAME 0.4.0 WebAssembly notice

Soundscaper's desktop build includes one reproducible WebAssembly build of the
TwoLAME 0.4.0 MPEG-1 Layer II encoder. It is used only by the reviewed bundled
MP2 encode provider and contains no decoder, command-line frontend, filesystem,
network, thread, or SIMD support.

TwoLAME is Copyright (C) 2001-2004 Michael Cheng and Copyright (C) 2004-2018
The TwoLAME Project. It is distributed under the GNU Lesser General Public
License, version 2.1 or (at your option) any later version. The retained
`licenses/TWOLAME.txt` notice identifies those terms. The exact official source
archive, digest, upstream revision, build recipe, local wrapper, and relinking
instructions are supplied by `source-manifest.json`, `SOURCE.md`, and
`scripts/build-twolame-wasm.mjs`.

Upstream: <https://www.twolame.org/>

Exact source: <https://downloads.sourceforge.net/project/twolame/twolame/0.4.0/twolame-0.4.0.tar.gz>

The memory-only float API clamps and quantizes each finite input sample to a
signed 16-bit value before lossy MP2 encoding. TwoLAME zero-pads a final partial
1,152-sample MPEG frame; the output has no gapless metadata and must not be
described as sample-exact. Source and binary identity evidence is not patent
clearance or a non-infringement representation.

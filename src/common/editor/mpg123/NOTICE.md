# mpg123 WebAssembly notice

Soundscaper distributes one exact WebAssembly build of the reusable libmpg123
decoder from mpg123 1.33.7. The build accepts memory-fed MPEG-1 Layer II and
Layer III audio and emits interleaved 32-bit floating-point PCM. It contains no
mpg123 command-line program, audio-output library or module, filesystem reader,
network reader, ID3/ICY parser, encoder, thread support, or SIMD implementation.

Upstream source: <https://www.mpg123.de/download.shtml>

The exact source archive and detached signature are pinned in
`source-manifest.json`. The signature is made by Thomas Orgis' published key,
fingerprint `D021 FF8E CF4B E097 19D6 1A27 231C 4CBC 60D5 CAFE`. The build
script verifies the archive, signature, key fingerprint, compiler version,
local wrapper and retained license before producing the artifact.

mpg123 is Copyright (c) 1995-2020 by Michael Hipp and others and is distributed
under LGPL-2.1-only terms. The complete upstream `COPYING` file is retained as
`licenses/MPG123.txt`. Soundscaper's wrapper and JavaScript/TypeScript
integration are AGPL-3.0-only. `scripts/build-mpg123-wasm.mjs` supplies the
corresponding-source and relinking recipe for the exact WebAssembly object.

# LAME 4.0 notice

Soundscaper's desktop build includes one reproducible WebAssembly build of the
LAME 4.0 `libmp3lame` encoder. It is used only by the reviewed bundled MP3
encode provider and contains no decoder, command-line frontend, filesystem,
thread, networking, or SIMD support.

LAME is Copyright (c) 1999–2026 The LAME Project and other contributors named
in the upstream source. The library is distributed under the GNU Library
General Public License, version 2 or (at your option) any later version. The
upstream archive's `COPYING` and `LICENSE` files govern the library. The short
upstream linking guidance is adapted in `licenses/LAME.txt`; the complete GNU
Library General Public License version 2 is reproduced in
`licenses/LGPL-2.0.txt` and remains in the exact source archive fetched by the
reproducible build.

Upstream: <https://lame.sourceforge.io/>

Exact source: <https://downloads.sourceforge.net/project/lame/lame/4.0/lame-4.0.tar.gz>

This source and binary identity evidence is not patent clearance or a
non-infringement representation. Product release remains subject to the
project's jurisdiction and redistribution review.

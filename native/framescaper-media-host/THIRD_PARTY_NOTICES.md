# Framescaper media host third-party notices

The native media host build recipe links against FFmpeg 9.0.1
“Lei”, obtained from `https://ffmpeg.org/releases/ffmpeg-9.0.1.tar.xz` and
verified against the source digest in `source-manifest.json`. FFmpeg is
available under the GNU Lesser General Public License version 2.1 or later;
configurations that enable GPL components are available under the GNU General
Public License version 2 or later. The pinned build recipe enables the GPL
configuration. FFmpeg copyright and licence texts are included in its source
archive.

The target-native configuration also statically links the manifest-pinned
x264 stable b35605ac (GPL-2.0-or-later), x265 4.2 (GPL-2.0-or-later), libvpx
1.16.0 (BSD-3-Clause), Opus 1.6 (BSD-3-Clause), and zlib 1.3.1 (Zlib) source
releases. Their complete licence texts and copyright notices are present in
the exact digest-authenticated source archives provisioned by the workflow.

The host uses the manifest-pinned Boost 1.92.0 Multiprecision header closure
under the Boost Software License 1.0. Its licence text is present in the exact
digest-authenticated Boost source archive provisioned by the workflow.

The source template contains no payload bytes until a target result is staged.
The dedicated CI workflow generates target-native payloads with self-tests,
architecture inspection, exact file hashes, this complete notice text, and a
corresponding-source descriptor binding the repository revision and every
upstream archive identity. Packaging accepts only a matching result after the
staging command revalidates it.

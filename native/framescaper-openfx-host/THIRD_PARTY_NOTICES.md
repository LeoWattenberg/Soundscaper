# Framescaper OpenFX host third-party notices

The scanner and runtime-host source builds against the OpenFX
1.5.1 SDK at tag `OFX_Release_1.5.1`, commit `ab77951`. The SDK is
copyright its contributors and distributed under the BSD 3-Clause License. Its
license and notices remain in the pinned source archive described by
`source-manifest.json`.

The exact V12 Retimer seam reuses the Framescaper media host's pinned render-
plan validator and Boost.Multiprecision 1.92.0 header closure. Boost is a
build-only input under the Boost Software License 1.0; it is not a separately
loadable runtime payload. The archive and header-closure identities are pinned
by `config/boost-multiprecision-source-manifest.json`.

Framescaper does not redistribute user-installed OpenFX plug-ins. No scanner,
runtime-host, SDK, or plug-in payload is currently included in production
packages. The source template contains no payload bytes; the dedicated CI
workflow generates target-native payloads with source and notice closure,
isolation checks, self-tests, conformance evidence, architecture inspection,
and exact file hashes. Packaging accepts only a matching result after the
staging command revalidates it.

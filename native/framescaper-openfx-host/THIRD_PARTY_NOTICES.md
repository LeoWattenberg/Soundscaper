# Framescaper OpenFX host third-party notices

The dormant candidate scanner and runtime host are built against the OpenFX
1.5.1 SDK, signed tag `OFX_Release_1.5.1`, commit `ab77951`. The SDK is
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
packages. All five target rows remain `pending-external` until licensing,
build-host, signing, isolation, self-test, conformance, and hardware evidence
agree.

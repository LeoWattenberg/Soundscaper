# TwoLAME corresponding source and relinking recipe

The complete corresponding upstream source for the distributed `twolame.wasm`
is the official `twolame-0.4.0.tar.gz` archive named and SHA-256-pinned in
`source-manifest.json`. Soundscaper's complete wrapper source is
`native/soundscaper_twolame.c`; its exact digest is pinned in the same manifest.

Run the following from this repository with Docker available:

```sh
docker run --rm -v "$PWD:/src" -w /src \
  emscripten/emsdk@sha256:8847dad4171ebc8a53d9ae5cda86a2546ef5b2e68834c14dc1ba2b2962e125cc \
  node scripts/build-twolame-wasm.mjs --output /src/twolame-relinked.wasm
```

The build fetches the complete exact archive over HTTPS, rejects any digest or
redirect drift, builds the static library with the pinned compiler and flags,
and links it with the wrapper. To relink a modified object, use the build script
as the complete recipe and apply changes after its verified archive extraction
and before its `emmake`/`emcc` steps; update the local-file and output pins in a
copy of the manifest so its identity checks describe that modified build.

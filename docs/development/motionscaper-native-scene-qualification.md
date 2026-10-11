# Packaged Motionscaper scene qualification

This Linux X11 qualification drives the authenticated packaged Motionscaper app through its existing menus and real native file dialogs. It does not replace the desktop bridge, renderer, native encoder or output publication. The reference decoder and scene helpers are external test tools and are not included in the package.

Prepare the current Motionscaper package with a verified native build result, using the existing native source/build receipt workflow. Set `MOTIONSCAPER_REFERENCE_FFMPEG_PREFIX` to that build's pinned FFmpeg install directory. The test decoder is compiled locally against those libraries; it does not download a decoder or modify the native runtime closure.

```sh
SCAPE_PRODUCT=motionscaper SOUNDSCAPER_SOURCE_REVISION="$(git rev-parse HEAD)" MOTIONSCAPER_NATIVE_BUILD_RESULT=/path/to/verified-result npm run desktop:prepare
SCAPE_PRODUCT=motionscaper npx electron-builder --config electron-builder.config.cjs --dir --config.directories.output=release/desktop-nightly-products/motionscaper
MOTIONSCAPER_REFERENCE_FFMPEG_PREFIX=/path/to/ffmpeg-install xvfb-run -a node scripts/motionscaper-scene-native-smoke.mjs
```

The scene contains a moving translucent 3D caster, lit receiver, shadow-casting point light and perspective camera with nonzero aperture. Four exact rational shutter samples and sixteen lens samples are authored. A focused Node regression checks that disabling camera, lighting, shadows, shutter sampling or lens sampling changes actual CanvasKit reference pixels. It also verifies motion between the two delivered frames and transparent/partial-alpha coverage.

The packaged run verifies its complete stage/resource inventory, opens the retained `.mscape`, seeks frames 1 and 2 in Composition Preview, and exports that range as ProRes 4444. Both previews are compared to the full-quality float CPU reference. Canvas readback allows at most one premultiplied 8-bit code of RGB quantization and requires exact 8-bit alpha. Native output is decoded through libav, requires Rec.709 tags and at least ten-bit decoded color/alpha, and is compared in straight nonlinear Rec.709. The declared lossy ProRes RGB tolerance is eight 10-bit code values (`8/1023`); partial-alpha tolerance is two 10-bit input code values (`2/1023`), with exact transparent and opaque endpoints. The native path converts RGBA16 to ten-bit YUVA before ProRes encoding; sixteen-bit alpha storage and twelve-bit decoder output do not imply sixteen-bit source precision. The wider scene covers values beyond the independent single-swatch regression, which retains its `0.0006` alpha bound. RGB under exactly zero alpha has no rendered color authority and is excluded from color comparison. Frame count, dimensions and exact 30000/1001 cadence must match.

The independent decoder regression additionally encodes and decodes actual stereo 24-bit PCM, checking exact sample count and error below one 24-bit signed code (`2^-23`). Its optional native integration requires `MOTIONSCAPER_REFERENCE_STAGE` to name a prepared Motion stage and the same FFmpeg prefix. The decoder admits at most 256×256 pixels, 32 frames, 192,000 PCM frames and a 64 MiB input movie.

The final `MOTIONSCAPER_NATIVE_SCENE_QUALIFIED` record contains the packaged source revision, immutable project digest, output digest, exact decoded metadata and measured maximum errors. The harness launches Electron with `--disable-gpu`, so this receipt covers software rendering on the actual available Linux architecture; it does not claim hardware GPU coverage. Other desktop platforms, installed After Effects comparisons and broader codec/color profiles require separate qualification. No manual **Update AI assets** run is needed: this work changes no assistance runtime closure or inventory.

The Linux x64 development run from packaged source revision `3b3d1e4801090663f1fa8040bb3f3e29f7b3faaa` passed with these measurements:

| Check | Observed maximum | Admission |
| --- | ---: | ---: |
| Preview premultiplied RGB readback | 0.980392 byte code | 1 byte code |
| Preview alpha | exact | exact |
| Native straight Rec.709 RGB | 0.005994712 | 8/1023 |
| Native partial alpha | 0.001403988 | 2/1023 |
| Native transparent/opaque endpoints | exact | exact |

The two decoded frames were 64×48 at timestamps `0/30000` and `1001/30000`. The authored input revision digest was `7219f27ab78cfe79c4e676f94b3572a28ee3e495bc84c70989c19e7e1b7e0b82`; the actual MOV SHA-256 was `cf03af644b7e279bbdc9c43242ead9694bc3cb417e8aa7de63e48d67e20fec53`. This is a measured development receipt, not a cross-platform release certification.

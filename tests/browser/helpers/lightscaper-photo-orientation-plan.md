<!-- SPDX-License-Identifier: AGPL-3.0-only -->

# Native JPEG EXIF pixel qualification

Budget recorded before implementation: a 32×24 asymmetric opaque color grid,
3072 RGBA bytes, genuinely JPEG-encoded by each browser's canvas at quality 0.95,
with a 64 KiB encoded ceiling. Eight independent classic TIFF EXIF headers are
injected into copies of the same compressed data. One gesture admits eight
files (at most 512 KiB total), with serial preparation and artifact reads.
Chromium/WebKit canvas encoders attach sRGB ICC metadata. The test-created sRGB
seed removes only these APP2 ICC segments before constructing selected Files;
all remaining headers and compressed bytes stay exact. This fixture construction
does not relax production ICC refusal or change a selected original afterward.

An independent Node golden raster defines all eight rotations/mirrors. Each
browser's actual orientation 1 packed JPEG pixels provide the baseline; every
orientation must equal the corresponding byte-exact permutation. Center samples
also establish that the baseline preserves the encoded color-grid structure.
Every outcome verifies source orientation, retained original bytes, independent
WebCrypto SHA-256, shared artifact original binding, packed original bytes and
unchanged fixture input. An explicit unsupported EXIF ColorSpace checks refusal
before the native decoder opens.

Fixture code uses the existing preparation/browser-native/packed-frame owners.
It bundles in memory with esbuild and fulfills test-only routes; it does not edit
product builds, source modules, UI, storage, manifests or capability declarations.
Chromium, Firefox and WebKit run the same decode-only gate; no native IndexedDB
Blob storage behavior participates. No generated JPEG file is committed.

EXIF orientation follows the [CIPA Exif specification](https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf).
The native bitmap route uses the [HTML ImageBitmap orientation rules](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-imagebitmapoptions-imageorientation).

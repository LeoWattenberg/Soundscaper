# Motionscaper platform qualification

This is a bounded M12 development gate, not a public-release certification. The
dedicated Motion configuration retains the existing Chromium suite and adds one
focused workflow spec for Firefox and WebKit. The main repository configuration
and CI continue to select all three engines for the broader suite.

## Run locally

Use Node 26.5.0, npm 12.0.1, and the browsers installed for the locked Playwright
package. The October 11, 2026 run used existing browser binaries; it installed no
packages or browsers and changed no dependency metadata.

```sh
npm run build:browser:motionscaper
node --import tsx --test tests/motionscaper-platform-config.test.ts tests/motionscaper-browser-video-admission.test.ts tests/motionscaper-video-delivery.test.ts
npx playwright test --config playwright.motionscaper.config.mjs tests/browser/motionscaper-platform.spec.ts --workers=2
```

The spec attaches `motion-platform-receipt` JSON with the actual engine version,
font byte count, preview pixel hashes, encoder outcome, and offline outcome. Add
`--reporter=json` to retain those receipts in a machine-readable report. Generated
reports, traces and browser binaries are not committed.

## Measured workflow

The local Linux x64 run exercises four cases per engine:

1. The isolated Motion shell starts without initializing a project or displaying
   an authoring panel. German keyboard menus open a composition dialog, focus its
   title field, and restore menu focus on Escape.
2. A menu-created rectangle and retained-font text layer survive authored
   position keys, Save, portable `.mscape` export, reload and Project Library
   reopen. Archive import verifies the complete retained font body. Two actual
   CanvasKit preview frames differ at the expected position; opaque text pixels
   are present. Each delivered PNG matches its corresponding preview exactly.
3. A real browser video capability either produces a two-packet VP9 WebM with
   the declared size and millisecond container timestamps, or yields a visible
   refusal without a download. PNG delivery then succeeds with the same pixels.
   The browser does not advertise native ProRes.
4. After the service worker installs, the page reloads under its control and
   opens the lazy project/preview features. The test closes its disposable Pages
   origin, reloads, reopens the saved composition and reproduces the retained-font
   preview pixels with the server unavailable. The ordinary preview server and
   other tests remain independent.

| Engine on Linux x64 | Version | Editing, retained fonts, save/reopen, PNG | Video boundary | Offline retained preview |
| --- | --- | --- | --- | --- |
| Chromium | 151.0.7922.34 | Qualified by this fixture | Actual VP9 WebM | Qualified by origin shutdown |
| Firefox | 153.0 | Qualified by this fixture | Actual VP9 WebM | Qualified by origin shutdown |
| WebKit | 26.5 | Qualified by this fixture | Linux WebKit refused before native probing | Qualified by origin shutdown |

This small 64×48, three-frame composition does not qualify maximum canvas or
duration, all authoring features, all media codecs, audio-device clocks, hardware
GPU behavior, mobile browsers, or installed macOS Safari. Those require their
own evidence. The retained font uses project bytes, not a system-font fallback.
All twelve cases passed without skips or retries. Each engine retained 23,664
font bytes and produced 48 opaque text pixels in the measured region. Exact PNG
comparison is against the same engine's preview; Firefox's complete frame hashes
differed from Chromium/WebKit, so this gate does not assert bit-identical output
between engines.

## Native WebKit boundaries

On this Ubuntu 24.04.5 host, locked WebKit build 2336 aborts its web process when
`VideoEncoder.isConfigSupported` is called for VP9 on an empty page, without any
Motion code. Browser debug output identifies
`GStreamer:ERROR:../gst/gst.c:617:gst_register_core_elements: code should not be reached`.
A fresh GStreamer registry does not change the result. WebKit's Linux ports use
[GStreamer for WebCodecs](https://docs.webkit.org/Ports/WebKitGTK%20and%20WPE%20WebKit/Multimedia.html).

Motion's narrow video-host admission refuses Linux WebKit before invoking any
native encoder probe. The message offers a PNG sequence or another qualified
browser; no muxer or output is acquired. The platform is determined from
`navigator.platform` as well as the engine user agent: Playwright's Desktop Safari
device advertises a Mac user agent while its actual platform remains Linux.
Chromium, Firefox and macOS Safari are not blocked by this Linux-specific rule.
macOS encoder support still needs its own actual qualification.

The isolated failing probe can be reproduced outside the application:

```js
import { webkit } from '@playwright/test';
const browser = await webkit.launch();
const page = await browser.newPage();
try {
  await page.evaluate(() => VideoEncoder.isConfigSupported({
    codec: 'vp09.00.10.08', width: 64, height: 48, framerate: 30,
    bitrate: 8000000, latencyMode: 'quality', alpha: 'discard',
  }));
} finally { await browser.close(); }
```

WebKit's driver `context.setOffline(true)` also rejects navigation with an
internal error for a minimal, already-controlled, cached HTML service-worker
fixture. The Motion test therefore removes the actual origin instead. It does
not replace service-worker responses, mock renderers, or claim success from a
crashing probe. Initial feature use before service-worker control does not count
as warming the offline cache; installation and a controlled reload precede the
offline workflow.

## Distribution and remaining gates

The current local evidence complements these configured gates:

| Gate | Repository authority | Remaining work/evidence |
| --- | --- | --- |
| Full browser matrix | `playwright.config.mjs`, `.github/workflows/quality.yml`, `.github/workflows/desktop-preview.yml` | Full current-revision Chromium/Firefox/WebKit suites, regressions and coverage union remain the final integration gate. |
| Native helper builds | `.github/workflows/motionscaper-media-host-native-build.yml` | Source-bound build/self-test/verification is configured for Linux x64/arm64, Windows x64/arm64 and macOS arm64. Configuration alone is not a successful target receipt. |
| Internal packaged smoke | `.github/workflows/desktop-nightly-tests.yml` | Each selected target downloads its verified Motion helper before packaging and runs `motionscaper-desktop-smoke.mjs --require-native-prores`. Current branch receipts on the other four targets are still required. |
| Packaged 2.5D reference | [Native scene qualification](motionscaper-native-scene-qualification.md) | Actual Linux x64 software-rendered own-origin preview and native ProRes output have bounded reference evidence. Hardware GPU and other target matching-quality references remain open. This external reference harness is not yet a CI target-matrix gate. |
| Public candidate release | `.github/workflows/desktop-preview.yml`, `config/product-release-lines.json` | At this audit snapshot, Motion has an own release prefix but no Motion tag trigger or verified Motion helper staging in the public package job. A separate focused implementation must connect these before release; untagged Sound/Frame scope must stay unchanged. |
| Signing and installation | `scripts/lib/desktop-signing-config.cjs`, public package workflow | Existing conditional Developer ID/notarization and Windows certificate/Azure paths need credentialed Motion artifact, installation and own-channel update receipts. Ad-hoc internal packages do not satisfy signing. |
| External application/platform behavior | M09/M11 implementation gates | Installed macOS Safari, target-native file associations/launches, installed Adobe After Effects interchange and target-specific color/alpha behavior require actual environments. |

No site, package, release tag, update or runtime asset is published by this gate.
The assistance runtime closure and inventories are unchanged; a manual
**Update AI assets** run is not required.

# Framescaper successor native composition delivery

The Framescaper 1.1 development desktop provides **File > Export sequence as
ProRes 4444** when its dedicated desktop bridge is present. The dialog discovers
the authenticated helper capability on demand. A package without that helper
reports the unavailable capability. The baseline Frame native service and its
V14 project authority are not admitted.

The export captures the Frame v2 project digest and primary sequence ID. It
uses the maintained Frame exact finishing graph, including accepted immutable
Motion compositions and ordinary retained media. Generated compositions have
no encoded proxy body or fabricated media URL. The full primary sequence is
exported at its existing cadence; this first route has no separate work-area
or frame-rate override. Project changes cancel the captured operation.

Frame finishing supplies straight-alpha managed SDR RGBA8. Its exact finishing
node supplies the output transfer, either sRGB or Rec.709; the adapter decodes
that transfer and premultiplies linear Rec.709 float samples. It does not infer
transfer from a codec/profile name. Upstream effective picture precision remains
8-bit. The existing authenticated helper accepts the float carrier and encodes
ProRes 4444 through 10-bit YUVA444 input, with 16-bit alpha storage. A decoded
ProRes pixel format reporting 12-bit channels is not evidence of 12-bit input
precision.

The audio path streams the committed Frame stereo mix through its existing
render engine, including linked PCM providers. It retains at most one bounded
4096-frame mix block at the adapter boundary. The sample count is the exact
ceiling of the picture duration on the project sample grid; no effects tail is
appended. Float PCM reaches the helper before 24-bit PCM quantization. Picture
and audio share the same Frame revision and sequence identity. Carrier and
codec admissions remain explicit: at most 32768 picture frames, 134217728 audio
frames, and sample rates through 192 kHz. Main-process IPC writes are bounded to
4 MiB. Frame sources, timing leases and mixer resources are released before
native commit publishes the output by atomic replacement.

The successor exposes only the closed
`framescaperSuccessorDesktop.v1.delivery` methods: capability discovery,
destination selection, bounded writes, commit and cancellation. Paths remain in
the main process. The selected main document must retain its origin/window
ownership. The package inventory authenticates its own capability manifest,
notices and exact helper bytes; extra native files and foreign service methods
are refused. The Motion helper source, carrier source pins and assistance
runtime closure are unchanged.

## Historical Linux x64 qualification

The following committed report describes an earlier package, not the current
source. Temporary qualification receipts were lost in the 2026-10-13 reboot.
New source-328 packages passed a fresh bounded Linux aggregate independently.
The historical measurements below are not receipts for those packages. See
[final validation status](motionscaper-final-integration-validation.md).

The external harness in
`desktop/motionscaper-successor-delivery-qualification.ts` drives the real
packaged application, GTK Open and Save dialogs, own preload and IPC. It uses
software WebGL2 (SwiftShader) for the maintained Frame preview, with Electron's
sandbox enabled. No chooser or native provider is replaced by a test double.

At package source `d2aece393c4f9f47bd53c4b66317c0a746d8c08a`, qualification:

- Received automatic saved revisions and refused a corrupt replacement, then
  disconnected and verified the native directory watch was released.
- Deleted the original `.mscape`, reopened the retained Frame project offline,
  and displayed the same non-primary preview pixel `[74,29,138,255]`.
- Saved an actual three-frame 64×32 ProRes 4444 MOV through GTK, with a moving
  half-transparent card and two mixed retained stereo WAV placements.
- Decoded the MOV through a test-only libav reader. Picture timestamps were
  exactly 0, 1/30 and 2/30 second. PCM was 48 kHz stereo with 4800 samples.
- Measured maximum straight Rec.709 RGB error `0.0057984455`, alpha error
  `0.0006033479`, and PCM error `0`. The declared test bounds are eight 10-bit
  RGB codes, two 10-bit alpha-input codes, and one PCM24 quantization step.
  Transparent endpoints remained exact. The decoded picture composited over
  black differed from the retained Frame preview by at most one 8-bit display
  code (declared bound: three codes).

The movie SHA-256 was
`3c37b639b24c65dc7e60c59b7a055a2407700f02cc21044016446c4b9361f313`.
The accepted Motion revision was
`c7a473504fbf389a8e82c834f863622163d2018d4332a0c09276fe21e003dac0`.
The receipt additionally records the fresh Frame project ID and digest, exact
metadata and package source revision. Temporary media and profiles are removed.

Build and exercise an existing qualified native build result with:

```sh
SOUNDSCAPER_SOURCE_REVISION=$(git rev-parse HEAD) \
SCAPE_PRODUCT=framescaper SCAPE_FRAMESCAPER_LINE=successor \
SCAPE_FRAMESCAPER_DESKTOP_PROFILE=framescaper-successor-v2 \
FRAMESCAPER_SUCCESSOR_NATIVE_BUILD_RESULT=/absolute/native-build-result \
npm run desktop:prepare

SCAPE_PRODUCT=framescaper SCAPE_FRAMESCAPER_LINE=successor \
SCAPE_FRAMESCAPER_DESKTOP_PROFILE=framescaper-successor-v2 \
npx electron-builder --config electron-builder.framescaper-successor.cjs --linux --x64 --dir

xvfb-run -a node scripts/framescaper-successor-desktop-smoke.mjs
MOTIONSCAPER_REFERENCE_FFMPEG_PREFIX=/absolute/pinned-ffmpeg-install \
xvfb-run -a node scripts/motionscaper-successor-native-smoke.mjs
```

The test-only reference decoder is built against the already qualified pinned
FFmpeg installation; it is absent from the package. Run this harness with
Node's maintained TypeScript stripping, not a transformer that injects helpers
into functions serialized to the browser.

The historical package above also had a GPU-disabled omission-warning
experiment. That result predates the current CPU finishing preview and must not
be described as qualification of the later fallback.

Current successor preview includes CPU finishing for retained linked scenes
and ordinary timeline images when WebGL is unavailable or lost, using the same
authenticated picture executor as export. Declared Rec.709 finishing bytes are
converted to sRGB at the preview boundary without changing delivery bytes.
Inherited Frame adjustment effects that require WebGL2 still refuse explicitly;
an incomplete picture is never presented as successfully rendered. Source
replacement, context recovery and offline reopen have maintained browser tests,
but the lost earlier receipts cannot qualify source 328.

The File dialog also owns Retry Output Cleanup. Failed native cancellation
retains its cleanup handle and prevents another export or dialog closure until
retry succeeds; a successfully published destination remains distinct from late
cancellation. This uses the existing helper and PCM contract.

Hardware GPU, Windows, macOS, other architectures, Wayland, installation and
broader native format/duration cases remain outside the historical Linux result.
Fresh source-328 offline successor picture/PCM delivery passed in the bounded
Linux aggregate. Complete browser matrix and duration acceptance remain open.

No manual **Update AI assets** run is required.

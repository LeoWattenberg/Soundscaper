# Controlled browser and Linux duration qualification

Status: harness preparation; no sustained browser or native result is recorded
here. The policy identifier is `motion-browser-linux-duration-v1`. Its numeric
authority is `scripts/performance/motionscaper-sustained-plan.ts`. A reviewed
commit and SHA-256 of that file must be recorded before a run starts. A failed
limit remains a failure; changing the profile requires a separately reviewed
plan and fresh evidence, never reinterpretation of an earlier run.

## Workload and production paths

Both durations use one immutable 1,200-frame project at 160×90 and exactly
30 fps. The short output covers [0,300); the long output covers [0,1200).
Both use the same retained Inter font and the same 40-second, 48 kHz stereo
16-bit WAV. The WAV left sample is `(sampleIndex % 127 - 63) / 128`; the right
sample is its negative. Input bytes, project revision and asset digests do not
change with output duration. The scene contains shaped text and an animated,
translucent solid over transparency. Animation must change representative
pictures; a static repeated-frame loop would not qualify this profile.

The Chromium run imports the archive through File > Open, opens View >
Composition Preview, and seeks every frame through the existing Frame input.
It checks completed frame identity, the default worker backend and selected
canvas pixels. Closing and reopening Preview must release the original worker
and create a fresh one. The real File > Render and Render Queue dialogs submit
PNG-sequence and WebM jobs. Each completed job is removed before the next phase.
There is no injected renderer, decoder, delivery implementation or fake Blob
consumer. Failure to admit the real worker or VP9/Opus is an unqualified run,
not a substituted backend success.

The browser's unavailable headless OS save chooser is replaced by an external
test-only `showSaveFilePicker` adapter returning a real OPFS file stream.
Writes await the disk stream, with at most one outstanding write and no retained
chunk list. The adapter records write sizes, close/abort and eventual physical
entry removal. This qualifies disk-stream delivery, **not the browser OS file
chooser**. It does not modify production code or expose a production API.

The Linux run authenticates a fresh source-pinned package and unchanged native
helper closure, starts the actual own-origin app with an owned temporary
profile, and drives File > Open and File > Render through real GTK choosers.
It uses ProRes 4444 with the real main process, bounded carriers and actual
encoder process. Software rendering is declared explicitly. No bridge/helper
substitution or production smoke channel is admitted.

Each platform starts a fresh owned process tree for each duration. Warmup is
the first 120 frames of that duration, included in peak measurements but outside
tail comparisons. Phase order is Preview, PNG, WebM for Chromium and Preview,
ProRes for the packaged app. There is one active job, followed by an explicit
cancel/retry exercise using the original pinned revision. Native cancellation
must separately observe cancellation during carrier upload and while the real
encoder PID exists. If the latter phase cannot be observed, that gate stays
unqualified; the harness must not replace the encoder with a delayed fake.

## Predeclared memory and resource acceptance

Linux `/proc` observations bind PID and process start ticks, retain ownership
after reparenting, and refuse PID reuse. RSS and PSS include only the launched
browser/app and its actual descendants. The harness/reference decoder is
reported separately and excluded from application totals. Cadence is 100 ms;
a gap over 1,000 ms or a missing completion sample refuses memory qualification.
There are at most 64 owned processes, 12,000 samples per phase and ten minutes
per phase. There must be at least three samples in each final 60-frame tail.
Short phases that cannot provide those samples remain unqualified rather than
being extrapolated.

| Guard | Predeclared limit |
| --- | ---: |
| Sum of owned process RSS | 2 GiB |
| Sum of owned process PSS | 1.5 GiB |
| One observed JS isolate used heap | 512 MiB |
| One observed WASM memory capacity | 256 MiB |
| Native encoder process RSS / PSS | 384 MiB / 256 MiB |
| Long minus short median tail RSS | 128 MiB |
| Long minus short median tail PSS | 64 MiB |
| Long minus short median aggregate JS used heap | 64 MiB |
| Long minus short median aggregate WASM capacity | 32 MiB |
| Concurrent destination writes | 1 |
| Qualification output admission | 512 MiB per output |
| External reference/read window | 64 KiB |

The absolute process limits accommodate the browser or Electron shell, decoder,
CanvasKit, codec and shared mappings; they are an acceptance envelope for this
small workload, not a product allocation guarantee. PSS prevents shared pages
being counted once per child, while RSS is retained as a separate conservative
observation. The stricter tail deltas allow bounded allocator/GC/cache slack
without allowing retention of the extra 900 float RGBA frames (197.8 MiB).
The 64 MiB PSS delta would detect retaining roughly one third of those extra
frames. It does not prove absence of every small per-frame leak.

CDP records actual JS used/total heap and externally observed WASM
`Memory.buffer.byteLength` at an attempted 100-ms cadence. Actual per-target
monotonic timestamps and target/session identities are retained. Repeated cached
values do not count as new measurements; tails need three independent captures.
Observation work and scheduling overhead are included in the declared workload.
Weak references and passive
constructor/instantiation observation must not keep native objects alive.
WASM capacity is not live allocation size; JS used heap is not a count of live
application objects. Neither forced GC nor a heap snapshot is used. Missing
worker/isolate or WASM evidence refuses that measurement gate; RSS alone must
not be relabeled WASM evidence. Worker disposal and disappearance are recorded
separately from allocator capacity, which may remain resident in the main page.

Browser WebM and native MOV indexes legitimately grow with frame/packet count.
The existing 32,768-entry admissions remain unchanged. This profile has at most
1,200 picture entries and `ceil(frames * 1600 / 960) + 8` admitted audio packets;
it cannot support a duration-independent claim for muxer index bytes. Native
carrier and encoded disk files also grow with duration and are reported as
disk, not resident memory. The long raw float carrier is about 264 MiB and must
never be read wholesale by qualification code.

## Output and lifecycle evidence

The PNG tar verifier streams headers/bodies, checks exact pinned sequence
identity and frame count, and retains only first/middle/last encoded pictures.
Their alpha and pixels are checked against the actual matching-quality CPU
reference. Preview canvas comparisons allow one premultiplied 8-bit code.
Native decoding retains only those three pictures, checks every presentation
timestamp against `frame / 30`, and streams every PCM sample through the exact
signed/channel oracle. Native straight Rec.709 color allows eight 10-bit codes;
alpha allows two 10-bit codes, preserving exact zero/one endpoints.

WebM verification checks every picture timestamp with the existing one-ms
container quantum, frame count and geometry, selected decoded pixels, 48 kHz
stereo metadata and complete audio coverage. Opus is lossy: decoded amplitudes
are **not** labeled exact PCM. The following are new, pre-run qualification
criteria, not existing product guarantees or observations:

| WebM reference guard | Fixed admission |
| --- | --- |
| Selected full-image RGB RMS | ≤12 eight-bit code values |
| RGB error inside a constant-color 5×5 reference neighborhood | ≤18 codes |
| Decoded alpha | exactly 255 (opaque delivery) |
| Opus decoded window | ≤8,192 stereo frames |
| Header preSkip / total extra decoded frames | ≤1,920 samples (40 ms) |
| First audio timestamp | −40 ms through +1 ms |
| Final audio coverage | authored end through +40 ms |
| Consecutive packet timestamp gap/overlap | ≤1 ms |
| One-time source alignment candidates | 0 or OpusHead preSkip, each ±48 samples |
| Calibration window | 4,096 samples after the first 1,920 decoded samples |
| Each signed channel against retained source | correlation ≥0.90 and normalized RMS error ≤0.40 |
| Opposite-channel correlation | ≤−0.98 |
| Each channel RMS / peak | 0.24–0.33 / ≤0.65 |

The fixed input is flattened over linear black using premultiplied linear RGB,
then encoded with the Rec.709 transfer for the video reference. Production uses
explicit BT.709 limited-range I420, including 2×2 chroma subsampling; decoded
WebM RGB is compared at that nonlinear boundary. It is not compared to the
transparent straight-sRGB preview/PNG. The 12-code whole-image RMS admits edge
chroma loss while the 18-code interior check retains local color authority.
The existing Motion video browser regression already uses an 18-code uniform
color check and admits less than 40 ms output padding; 12-code whole-image RMS is
an additional qualification criterion. These finite bounds do not imply lossless
video or the precision of the native ProRes boundary.

The Opus header must be the 19-byte stereo, mapping-family 0, zero-gain OpusHead.
The pinned muxer reads preSkip into SeekPreRoll and writes CodecDelay 0; the
encoder output path snaps timestamps to the 48 kHz grid, while WebM stores 1 ms
timestamps. The fixed alignment search therefore covers either already-trimmed
or header-delayed output with one container quantum around each. Once selected,
it never changes across packets. All later valid samples are compared with the
signed retained source; at most 40 ms at each unmatched boundary is excluded,
and at least authored-count−1,920 samples must be compared. Arbitrary opposite
tones, swapped/inverted channels and later drift are refused. The periodic
127-sample waveform cannot disambiguate a shift by a whole period, so absolute
latency beyond the independently checked timestamps/count is not claimed.
Native PCM retains the exact every-sample value/channel proof.

Source authority for those boundary descriptions is
`motion-browser-video.ts`, `motion-browser-audio-writer.ts`, the pinned
Mediabunny `media-source.ts`, `codec-data.ts`, and
`matroska/matroska-muxer.ts`. WebM reads use an explicit custom source with
64 KiB pulls and 64 KiB cache; a browser-selected Blob stream chunk size is not
treated as a read-window guarantee. No unavailable codec qualifies.

Cancellation must publish no complete destination, retain the same submitted
revision for retry, close or abort the physical destination, release the render
lease, terminate any active native helper, and remove temporary carriers after
cleanup. Preview worker termination is verified separately by its target identity.
Completed output is streamed to a hash and bounded verifiers; the receipt
includes bytes/digest, selected-picture results, audio/timestamp counts,
backend/codec identity, PID/start-time sample logs, cancellation/retry outcomes
and clean-close evidence. Source, dependency, package, helper, font, archive,
plan and harness pins accompany actual process argv/code/signal observations.

The existing 32-frame native reference decoder and its historical receipts stay
unchanged. A separate test-only sustained decoder uses the same authenticated
libav installation, streams timestamps/PCM and emits only three picture bodies.
Its binary/source/compile invocation are separately pinned and excluded from
the production runtime inventory.

Before compilation, an independently prepared and reviewed inventory binds the
complete approved FFmpeg include/lib trees and every external codec library
directory referenced by pkg-config. Its SHA is supplied in the reviewed run
manifest. Every file and exact tree membership is rechecked before and after
compilation. `PKG_CONFIG_PATH`, `PKG_CONFIG_SYSROOT_DIR` and compiler include/link
search overrides are cleared; include/library flags outside the approved trees
are refused. The verified native build receipt binds the existing helper/source
closure; merely hashing an arbitrary newly supplied prefix is insufficient.

The reference decoder's custom AVIO read window is 64 KiB. Separately, each
demuxed compressed packet must be at most 1 MiB before decoding (over nine times
the 115,200-byte RGBA16 representation of this 160×90 picture). The largest
observed read and packet are recorded. These are different bounds: libav may
allocate a demuxed packet before its size can be checked. Input file admission
is 512 MiB, and this external verification process is not application-memory
evidence. Decoded geometry and planar, little-endian 10–16-bit alpha layout are
validated before reading the alpha plane; conversion scratch holds one frame.

## Execution and retained evidence

The sole entrypoint is `scripts/performance/motionscaper-sustained-run.ts`.
It requires a closed approved JSON manifest and its independently supplied
SHA-256. The manifest pins schemaVersion 1, mode (browser/native), exact clean
sourceRevision, planSha256, fresh absolute outputDirectory, and exactly one
platform record. Browser fields are url and siteDirectory; native fields are
stage, package, ffmpegPrefix, nativeResult, prefixAuthority and
prefixAuthoritySha256. Unknown fields, an existing output directory, another
HEAD, dirty source, coverage flags or a mismatched build/package are refused.
No historical source/package identity may be silently repinned.

After review, the concrete invocations are:

```sh
taskset -c0-3 node --import tsx scripts/performance/motionscaper-sustained-run.ts /tmp/<approved-browser-run>.json <approved-json-sha256>
taskset -c0-3 xvfb-run -a node --import tsx scripts/performance/motionscaper-sustained-run.ts /tmp/<approved-native-run>.json <approved-json-sha256>
```

Placeholders must be replaced and reviewed before execution. The browser origin
must already be served by the owned canonical preview server; this driver does
not start a server or rebuild production. Native requires the real configured
GTK/X11 chooser and sandboxed package. Browser uses declared SwiftShader software
rendering; the packaged fixture uses `--disable-gpu` as prior native references.
The small WebM verifier bundle and separate C++ decoder are test-only artifacts
created by the approved run, never installed in the app.

Each preview phase binds the exact actual worker target/session, revision and
backend, observes WASM there, and requires monotonic delivered-frame progress
covering every distinct seek. It then proves detach and a different target/session
after reopen. Selected first/middle/last reference, preview and decoded-output
digests must all differ, independently of their pixel-comparison results.
Native encoding requires at least three actual PID/start-bound memory samples;
a too-short helper lifetime remains unqualified. Upload cancellation additionally
requires partial frame progress, existing carrier files and no encoder at the
boundary; encoding cancellation requires the same live encoder PID/start identity.
Both retries preserve the submitted revision and their actual output is decoded
under the same reference checks. A missed cancellation boundary is a failure,
not an inferred pass. Only owned process identities are terminated; remaining
owned descendants receive a bounded KILL fallback and cleanup still refuses
unexplained exits or survivors. Profiles are removed only after successful process cleanup; failed cleanup retains
them for custody. OPFS custody is removed after production cleanup settles. Encoded
outputs, streamed PCM/reference files, raw timestamped memory logs and receipts
remain in the fresh output directory for review. No complete qualification
receipt is written unless both durations, every phase and cleanup pass.

These gates qualify only this Chromium/Linux software-rendered project at these
two durations. Maximum geometry, maximum duration, concurrent jobs, macOS,
Windows, hardware acceleration and installed After Effects remain outside it.

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
`Memory.buffer.byteLength` at one-second cadence. Weak references and passive
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
are **not** labeled exact PCM. Any decoded audio tolerance/priming allowance
must be fixed in the verifier and reviewed before execution. Native PCM and the
retained source provide the exact sample-value proof. No unknown or unsupported
codec may be counted as a passing encoded workflow.

Cancellation must publish no complete destination, retain the same submitted
revision for retry, close or abort the physical destination, terminate the
actual worker/helper owner, and remove temporary carriers after cleanup.
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

These gates qualify only this Chromium/Linux software-rendered project at these
two durations. Maximum geometry, maximum duration, concurrent jobs, macOS,
Windows, hardware acceleration and installed After Effects remain outside it.

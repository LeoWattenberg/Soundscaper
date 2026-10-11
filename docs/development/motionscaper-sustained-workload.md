# Motionscaper sustained CPU workload

The `node-worker-cpu-png-pcm-v1` fixture exercises the maintained preview worker,
CanvasKit renderer, retained WAV decoder, PCM mixer and forward-only PNG-sequence
delivery. It renders imported-font text and a translucent solid at 64×32 and
30 fps. Each run previews every frame, terminates its actual worker, then
delivers every frame and every stereo sample through backpressured consumers.
PNG tar and PCM consumers hash bytes without retaining a complete output Blob.

Run the regression with Node 26.5.0 and npm 12.0.1:

```sh
node --import tsx --test tests/motionscaper-sustained-workload.test.ts
```

The test launches an isolated child with `--max-old-space-size=128`; its preview
worker inherits that V8 policy. Node reports a total heap-size limit of 224 MiB,
which also includes regions outside old space. The test retains its 512 MiB
sampled process-RSS guard, a 1 MiB preview cache and 32 KiB PCM cache. It verifies
80 and 320 frames, exact signed/channel-ordered PCM, one retained-source load,
one outstanding destination write, complete publication and font-owner release.
Counts beyond the 64 MiB retained WAV admission refuse before media allocation.

The longer local October 11, 2026 run used the same controlled profile:

```sh
node --max-old-space-size=128 --import tsx -e 'import("./tests/helpers/motionscaper-sustained-workload.ts").then(async ({qualifyMotionscaperSustainedWorkload}) => { console.log(JSON.stringify(await qualifyMotionscaperSustainedWorkload([300,1200]))); }).catch(error => { console.error(error); process.exitCode=1; });'
```

| Measurement | 300 frames / 10 seconds | 1,200 frames / 40 seconds |
| --- | ---: | ---: |
| Previewed and delivered frames | 300 / 300 | 1,200 / 1,200 |
| Exact samples per channel, 48 kHz stereo | 480,000 | 1,920,000 |
| Retained-source loads | 1 | 1 |
| Maximum outstanding destination writes | 1 | 1 |
| Maximum preview cache | 1 MiB | 1 MiB |
| Maximum PCM cache | 32 KiB | 32 KiB |
| Owned font providers / encoded bytes | 1 / 23,664 | 1 / 23,664 |
| Sampled peak process RSS | 305.1 MiB | 403.7 MiB |
| Sampled peak main-thread JS heap | 93.7 MiB | 81.1 MiB |
| Main-thread heap after lease release | 70.0 MiB | 70.7 MiB |
| Elapsed preview plus delivery | 7.93 seconds | 32.54 seconds |
| PNG tar bytes consumed | 616,448 | 2,459,648 |

The longer run's tar SHA-256 was
`3005e9bba0addc9ba0dd5828bba0b6c11721f669b99055d00cd9e166a3e7d9f3`;
its PCM SHA-256 was
`827d5c593e38a285768af9e9786243857a4aab37112a61fb56b68c620898904b`.
The consumers closed successfully and retained no published output Blob.

Font providers belong to one preview revision or render lease, keyed by ordered
imported/fallback font identities and exact byte digests. Their LRU admits at
most eight providers and 64 MiB of encoded registrations; active paragraphs
protect their providers until release. Reuse avoids filling Skia's native cache
with a new typeface identity for every frame. Separate real-CanvasKit tests
preserve shaped pixels and constrain the native allocator frontier across
320 identical frames; imported Arabic/CJK browser workflows also retain their
reference pixels.

RSS samples include the child process and its worker, but sample timing can miss
short peaks. Main-thread heap measurements exclude the worker heap. Heap after
lease release is an observation without forced GC, not a live-byte or leak count.
Unconstrained V8 runs reached roughly 524 MiB sampled RSS despite the same bounded
queues and font reuse; allocator and garbage-collector policy affect that result.
These measurements qualify the declared Node CPU profile and durations. They
do not qualify browser RSS, maximum composition geometry/duration, native codec
memory, concurrent jobs or a product-wide memory reservation.

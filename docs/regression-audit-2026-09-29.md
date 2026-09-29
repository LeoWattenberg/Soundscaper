# Regression audit, 29 September 2026

This audit closed **125 distinct bug or coverage-gap cases** with 101 new named Node tests. A case is counted once for an independently observable contract, even when one test checks several related inputs. A **reproduced defect** failed its new regression before the source fix. A **coverage gap** passed on the first run and now guards a previously untested boundary.

| Area and regression tests | Named tests | Reproduced defects | Coverage gaps | Cases |
| --- | ---: | ---: | ---: | ---: |
| [PCM interleaving](../tests/audio-editor-interleaved-float32-pcm.test.ts) | 2 | 5 | 0 | 5 |
| [Encoded audio rate inspection](../tests/audio-editor-audio-file-metadata.test.js) | 14 | 8 | 9 | 17 |
| [CUE import](../tests/audio-editor-cue-import.test.ts) | 6 | 0 | 10 | 10 |
| [Soundscaper mixer admission](../tests/audio-editor-soundscaper-mixer-surface-admission.test.ts) | 2 | 16 | 0 | 16 |
| [Soundscaper repository boundary](../tests/audio-editor-soundscaper-repository-boundary.test.ts) | 9 | 3 | 6 | 9 |
| [Desktop range admission](../tests/desktop-range-read-admission-boundaries.test.js) | 11 | 10 | 1 | 11 |
| [Desktop range streaming](../tests/desktop-read-capability-range-stream-boundaries.test.js) | 8 | 0 | 8 | 8 |
| [Desktop child framing](../tests/desktop-native-child-framed-control-boundaries.test.ts) | 6 | 0 | 6 | 6 |
| [Desktop port transfers](../tests/desktop-helper-data-plane-transfer-boundaries.test.ts) | 4 | 1 | 3 | 4 |
| [Desktop linked-file and model paths](../tests/desktop-linked-original-validation-boundaries.test.ts) | 5 | 5 | 0 | 5 |
| [Framescaper delivery reports](../tests/framescaper-delivery-report-validation-boundaries.test.ts) | 12 | 7 | 5 | 12 |
| [Framescaper OPFS spool](../tests/framescaper-native-opfs-spool-boundaries.test.ts) | 13 | 7 | 6 | 13 |
| [Framescaper frame-pack protocol](../tests/framescaper-native-frame-pack-protocol.test.ts) | 9 | 2 | 7 | 9 |
| **Total** | **101** | **64** | **61** | **125** |

The shared-editor cases cover missing and short PCM channels, invalid frame geometry and destination capacity, truncated WAV/AIFF/FLAC/ADTS/WavPack headers, embedded FLAC/Ogg signatures, container variants, and CUE encoding, chronology, and limits. The Soundscaper cases cover runtime mixer input types and repository save/load ownership. The desktop cases cover capacity tickets, bounded reads, native child framing, transfer-port ownership, and linked-file identity. The Framescaper cases cover report object shape, spool write and cleanup ordering, and frame-pack publication.

The fixes are in eight focused commits after `81b7d43b2`: `08cde5b18`, `4f973f180`, `1f0e74d08`, `cbd6b2207`, `4055142c1`, `8f5d8382d`, `a69f72091`, and `d8a35bc14`.

The changes do not alter the desktop assistance runtime closure. A manual **Update AI assets** run is not required.

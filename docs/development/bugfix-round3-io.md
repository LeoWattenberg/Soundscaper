# Round-three I/O bug fixes

Only ordinary, reachable workflows reproduced through the editor are counted.
The two interchange formats below share one source-clock defect. A second
export format, codec spelling, or test parameter does not add another count.

| ID | Ordinary user reproduction | Before | Fix and verification |
| --- | --- | --- | --- |
| R3-IO-001 | Framescaper: File → Import a normal WebM; select its video header; set the playhead to `00:00:00:12`; Edit → Audio clips → Trim left edge to playhead; File → Export other → Export FCPXML or Export edit list (EDL). | Both actual downloads referenced the source head (`0s` / `00:00:00:00`), discarding the authored trim. | Convert native source ordinals through their persisted source timing before crossing to the interchange grid; preserve the legacy sample-clock path. The frozen MediaRecorder file stores source ordinal 6 at PTS 456/1000s, which the 30 fps profile must emit as `7/15s` / `00:00:00:14`. The exact menu/picker/download regression is red on baseline and passes all six format/browser cases on green2; it also checks the persisted authored ordinal read-only. Four strict canonical-project regressions cover source rates 25 and 50 fps; 65 focused export/reference-reader tests passed. |
| R3-IO-002 | Framescaper: import ordinary camera files named `camera-take-001.webm` and `camera-take-002.webm`; use Project bin → Add to timeline to place the second after the first on the same video track; File → Export other → Export edit list (EDL). | Both delivered events used reel `CAMERA_T`, aliasing distinct sources after eight-character truncation. | Allocate unique eight-character reels by stable source identity, reserve existing short names, retain one reel for repeated uses, and report collision conversion. The actual baseline download has one reel for two events; the unchanged public workflow now passes Chromium, Firefox and WebKit, retaining exact event count and distinct-reel assertions. Three strict regressions cover shared prefixes, punctuation collisions, repeated media and reserved suffixes; 51 focused EDL/source-clock tests passed. |

No dependency pins, generated runtime bytes, or target inventories changed;
no manual **Update AI assets** run is required.

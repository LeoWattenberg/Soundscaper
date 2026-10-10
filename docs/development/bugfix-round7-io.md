# Round seven import and export bugs

Only distinct defects reached through ordinary menus and ordinary authored media
qualify. Parser grammar variants and output variants of one owner count once.
Verification records below retain small receipts; generated media, browser output
and raw coverage are removed immediately after verification by the owning runner.

| ID | Ordinary user workflow | Defect and repair | Evidence |
| --- | --- | --- | --- |
| R7-IO-001 | Framescaper → Tracks → Caption tracks → import an ordinary WebVTT transcript containing header text, a NOTE comment and whitespace around its timing arrow. | Passive WebVTT syntax was classified as invalid or active content. Accept the standard passive header/NOTE/timing grammar while preserving the existing closed content policy. Header, NOTE and whitespace variants count once. | Three causal RED tests: INVALID_HEADER, INVALID_TIMING and ACTIVE_CONTENT. Caption import/profile/closed-voice focused suite GREEN 27/27. Public menu regression `tests/browser/audio-editor-round7-io-caption-webvtt.spec.js` GREEN on the root's fresh Chromium product build; actual authored cue text and 4800–24000 frame timing verified. |
| R7-IO-002 | File → Open a normal Audition SESX session after overlapping clips and choosing Bring Clip to Front. | The importer ignored SESX zOrder and mixed every overlapping clip. Convert non-crossfaded stacking into audible source spans, preserving source offsets and original fade gain across fragments; discard fully occluded source leases. | Causal RED expected three audible spans, received two overlapping full clips. Corrected public native Open service, explicit zOrder, source cleanup and fade sample regressions GREEN 4/4; SESX/native service support GREEN 20/20 before the additional fade regression. [Adobe's ordinary clip stacking rule](https://helpx.adobe.com/ca/audition/desktop/mixing-multitrack-sessions/arranging-editing-multitrack-clips.html). |
| R7-IO-003 | Desktop File → Import an ordinary Broadcast WAVE named Dialogue.wav, then File → Overwrite Dialogue.wav. | Extension-only format inference re-exported plain WAV and silently discarded Broadcast WAVE metadata. Use validated BEXT/CART metadata to select the existing BWF delivery. Plain WAV iXML needs no format change, including supported float32 media. Refuse unsupported BWF float precision. | Causal RED preserved `wav` instead of `bwf`; corrected original import recorder and real export plan preserve description and time reference. Original precision/service/lease support GREEN 27/27 with an unchanged float32/iXML control. Public original-overwrite browser witness GREEN on the root's guarded product capture 220719574; existing overwrite support also GREEN 5/5. |
| R7-IO-004 (excluded; zero count) | Import a 32-bit integer WAV. | The low-level encoder accepts int32, but the maintained WAV export format intentionally excludes it. The shortcut was correctly disabled; the attempted whitelist change and tests are retired. | Inspection of MEDIA_EXPORT_FORMATS.wav disproved the assumed ordinary Export audio path. This adds no qualifying bug or count. |
| R7-IO-005 | Desktop File → Import an ordinary WAV → Overwrite the original; delete the selected clip while native destination preparation is still pending, then Undo and Overwrite again. | The action retained the unused native save target until its fifteen-minute expiry, eventually exhausting sixteen-target capacity. Retire the acquired target when the action settles and complete the actual packaged preload/IPC connection to the existing owner-checked release store; successful consumed targets acknowledge false idempotently. | The initial source-only mock exposed a release method absent from the packaged preload and is excluded as whole-path evidence. Strong unchanged guarded `32eb4cebf` baseline executes the actual bundled desktop preload, registered Main file handlers, original-file broker, selected-range protocol and atomic writer: healthy two consecutive overwrites GREEN 13.8 seconds; ordinary Delete during the second preparation, Undo and Overwrite causally RED 18.9 seconds with the visible native Save target capacity reached its product-wide limit of 1 refusal and only one completed save. The lower-only capacity fixture exposes the ordinary repeat leak; both initial bootstrap attempts missing the existing environment endpoint are excluded setup. Actual packaged preload/IPC/store focused RED independently exhausts capacity; corrected cleanup, owner fencing, idempotence, opaque identifiers, strict boolean acknowledgements, original-file delivery and MP3 import controls GREEN 16/16; existing final-prefix, SESX IPC, File menu, original-file port and FileService support GREEN 37/37. Preload remains exactly 549 lines. Every temporary media directory is removed in finally; completed baseline diagnostics/logs were read and removed immediately. Both unchanged complete actual packaged native delivery workflows pass Chromium on authenticated guarded capture `3b510658ddb254144c98e401603f23f5ba875aaf`: healthy repeated overwrite 5.5 seconds and Delete during preparation, Undo and completed overwrite 5.5 seconds. Successful output is inspected, actual owner-checked release restores capacity, and completed output/logs were immediately removed. This restores the prior single IO-005 qualification; it adds no second root. |
| R7-IO-006 | Framescaper → File → Project management → Project properties → Sequence timing: set the sequence start timecode to 01:00:00:00; import ordinary audio, then File → Export other → Export FCPXML. | The sequence carried its one-hour origin but every child remained at a zero-based offset, scheduling the media before the delivered sequence. Add the parent timecode origin to emitted clip offsets while retaining source trims, relative lane allocation and sequence duration. | Actual public Chromium RED on the root's unchanged guarded capture downloads tcStart=3600s with asset-clip offset=0s; the download and diagnostics were deleted immediately. Strict owning factory/export-action RED gives offset=1s instead of 3601s with the zero-hour control passing. Corrected clock and original FCPXML/interchange/current-document support GREEN 34/34. Public workflow GREEN on guarded capture `5c9787bec` in 3.1 seconds; the downloaded parent and source clocks are verified. [Apple's parent timeline example](https://developer.apple.com/library/archive/documentation/Miscellaneous/Conceptual/LegacyDTDsFinalCutPro/FCPXMLDTDv1.0/FCPXMLDTDv1.0.html). |
| R7-IO-007 | Soundscaper File → Import an ordinary WAV and a point label at its end → Export audio → MP3 → Embed labels as chapters. | The checkbox counted raw labels even when none could form a chapter in the chosen delivery span. The enabled choice then failed canonical export admission. Resolve availability over the actual exclusive project/selection/loop span and output-frame rounding; remove a stale opt-in from displayed and submitted values when changing to a range without chapters. | Public causal RED on guarded capture `5c9787bec`: the enabled checked option produces the actual `No labels occur in the exported range.` error toast, then remains enabled; the healthy in-range MP3 download with CHAP/title metadata passes in 3.2 seconds. Earlier dialog/status observer failures are excluded. Mounted checkbox RED receives enabled instead of disabled; endpoint, healthy chapter and changed-selection submission focused regressions GREEN 3/3, together with existing chapters/dialog/original-overwrite support GREEN 49/49. Public unchanged endpoint refusal/availability and healthy CHAP download workflows GREEN on the root's guarded capture `fef78921b`. |
| R7-IO-008 | Desktop File → Import an ordinary AAC M4A with its movie metadata muxed after more than one MiB of audio → File → Overwrite Programme.m4a. | Original overwrite inspected only a prefix and could not find the normal trailing movie sample entry, withdrawing a supported action. Skip top-level media boxes through bounded header reads and inspect a bounded movie metadata range wherever it was muxed. The existing AAC codec proof and metadata budget remain in force. | Mediabunny authors a normal 92.88-second AAC programme entirely in memory from pinned encoder packets; readback proves codec and duration. Non-faststart RED returns null original settings, while identical faststart media is healthy. Public baseline imports one actual clip then exposes only generic disabled overwrite, with no named original action. Tail/front metadata and bounded-read focused regressions GREEN 2/2, with combined support GREEN 49/49. Public actual M4A import and restored named overwrite action GREEN on guarded capture `fef78921b` in 9.7 seconds. |
| R7-IO-009 | Soundscaper Project bin → import an ordinary WAV → Add to timeline three times, leave two instances coincident and move the third later using Media settings → Replace with a shorter WAV → Contract gaps. | Coincident or overlapping shortened tails were summed per clip and the following audio moved too early. Contract each completed timeline interval once by its union on the owning track; preserve ordinary separated replacements and atomic Undo. | Real Soundscaper product factory/command/history RED: coincident removed tails move a following clip to 96000 instead of 120000 frames; partially overlapping tails give 96000 instead of 108000, while the separated control passes. Public causal RED uses three real bin placements and the replacement-choice dialog, giving Start=21600 instead of 40800 frames. Corrected overlap/separated/Undo focused regressions GREEN 3/3; bin service, video/loop/warp replacement, retained envelope and original clip-edit support GREEN 36/36. Public unchanged three-placement replacement workflow GREEN on guarded capture `fef78921b`, including exact 40800-frame following start. Strict fixture command annotations pass targeted lint and focused 3/3 after the tests compiler check. |
| R7-IO-010 | Soundscaper File → Import a normal single-file CUE sheet written by K3b with a populated performer and blank title; choose Labels. | The importer classified ordinary quoted empty TITLE/PERFORMER metadata as malformed, so no labels could be imported. Accept quoted empty optional metadata and retain the existing track-name and album-performer fallbacks. Bare missing values and empty FILE names still refuse. | K3b's ordinary [rip CUE writer](https://raw.githubusercontent.com/KDE/k3b/master/src/rip/k3bcuefilewriter.cpp) emits both quoted fields whenever either CD-text field is set. Focused causal RED rejects TITLE on line 4, with a populated-metadata control passing. Actual public RED on guarded capture `fef78921b` reaches File Import → Labels, publishes `A CUE TITLE directive is malformed.` and leaves zero rather than two labels. Corrected CUE parser and focused regression support GREEN 13/13; public unchanged import workflow GREEN on guarded capture `e2a38ecb5` in 1.3 seconds. |
| R7-IO-011 | Soundscaper Audio settings → select Stereo before microphone discovery; ordinarily record a negotiated mono microphone, then Record options → Timed recording → Schedule recording. | Ordinary default capture accepted the negotiated mono stream, but scheduling demanded two channels from the same prepared default input and refused it as closed. Reuse the live prepared microphone and its actual channel count, without requesting a second input. Ended inputs still refuse. | Actual public causal RED on guarded capture `fef78921b` first records an ordinary one-channel take exceeding 4096 frames, then scheduling publishes the prepared-input-closed error and creates no scheduled region. Strict negotiated mono/stereo reuse, ordinary mono and ended-input controls GREEN 4/4; timed inputs/service and recording-offset support GREEN 39/39. Targeted source, strict test and public spec lint passes; public unchanged ordinary mono recording and scheduling workflow GREEN on guarded capture `e2a38ecb5` in 5.5 seconds. |
| R7-IO-012 | Framescaper import two ordinary cameras → Tracks → Multicamera → Create from video sources on camera A → Move camera B to Project bin → Remove from project. | Clip-only source pruning removed the inactive camera while its editable group still owned it, so the normal removal failed document validation. Carry retained multicamera angle media through inherited clip/bin command projection before restoring native group authority. The same owner also handles replacing an inactive camera bin item. | Actual public causal RED on guarded capture `fef78921b` in 11.1 seconds: ordinary Create group and Move to bin pass, then confirmed removal reports a missing canonical video source and leaves the bin card in place. Strict actual product/menu/command RED gives the same missing-source refusal; ungrouped removal is healthy. Corrected removal/replacement, grouped/ungrouped and subsequent camera-switch controls GREEN 4/4, with bin/multicamera/sequence support GREEN 32/32; public unchanged removal and subsequent angle-switch workflow GREEN on guarded capture `e2a38ecb5` in 8.6 seconds. |
| R7-IO-013 | Desktop Soundscaper File → Import an ordinary Ogg Opus recording named Programme.ogg → File → Overwrite Programme.ogg. | The filename mapped every generic Ogg container to Vorbis, so validated Opus media lost its supported overwrite action. Select the existing Opus export profile when the actual Ogg identification packet proves that codec; retain the original chosen filename. | Mozilla's ordinary [MediaRecorder example](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder) records `audio/ogg; codecs=opus`; its [Ogg container guide](https://developer.mozilla.org/en-US/docs/Web/Media/Guides/Formats/Containers) describes Opus and Vorbis content. A bounded in-memory Mediabunny Ogg mux of the committed ordinary microphone recording passes Opus/48 kHz/mono/duration readback. Byte-identical .opus control passes the actual supported export plan while .ogg causally returns null settings. Actual unchanged public baseline on guarded capture `e2a38ecb5`: .opus action GREEN in 1.6 seconds, .ogg imports one clip but has no named overwrite action in 6.4 seconds. Corrected exact-byte controls and original overwrite/native/metadata support GREEN 27/27; public postfix verification awaits the next guarded build. |
| R7-IO-014 | Soundscaper Window → Freesound → Search → Play preview; change Playback volume while playing or paused. | Freesound's independent HTML audio player ignored the shared listening gain, including a zero-volume setting. Apply the current gain to new previews and update the owned playing or paused element when the control changes, retaining the existing preview transport. | Actual public causal RED on guarded capture `e2a38ecb5` in 7.2 seconds: ordinary search, a real encoded Vorbis preview, advancing playback and unity volume pass; Playback volume then reaches zero while the actual playing media remains at one. Strict initial-muted/unity, live change and paused-resume controls GREEN 2/2; Freesound lifecycle/upload and the separate bin listening-gain support GREEN 17/17. Targeted source, strict test and public spec lint passes. The normal service response and encoded preview remain in memory; the root removes public diagnostics immediately after recording this receipt. Public postfix verification awaits the next guarded build. |

| R7-IO-015 | Soundscaper Window → Clip spreadsheet → edit a source reference → Load referenced files → choose an ordinary audio-only Chromium WebM microphone recording. | The spreadsheet rejected a shared video-container suffix before the normal media track probe, despite ordinary File Import supporting the same audio. Resolve actual audio/video tracks at both spreadsheet admission gates, fence project or editing changes while probing, and include the supported .webm suffix in its picker. | Two causal focused RED tests refuse the committed ordinary MediaRecorder bytes before decoding, with 24 existing controls passing. Actual public baseline `48b7bf244` in 8.7 seconds passes WAV replacement/Undo, then retains the picker with `Select an audio file for /recordings/Voice memo.webm.` Corrected spreadsheet preparer/service and ordinary media-router focused suite GREEN 28/28; targeted six-file lint passes. The public observer uses a 0.1-second WAV template within the actual 0.708-second admitted WebM: corrected baseline `48b7bf244` remains causally RED with the audio-file refusal after healthy WAV reuse, and guarded advance capture GREEN completes import and Undo in 4.8 seconds. The original longer template correctly failed source-range admission after routing and is excluded setup. The owning diagnostics were removed after this small receipt. |

| R7-IO-016 | Soundscaper Record options → Record loop into takes; Window → Clip spreadsheet: place the recorded source on another audio track → Move to Project bin → Remove from project. | Bin removal and media replacement pruned sources according only to ordinary clips, despite the editable take graph retaining the same recording. Include surviving take-owned source identities in that pruning decision; preserve removal of media without a take owner. | Strict actual cycle-repository producer and Soundscaper product commands causally RED for removal and replacement, while both ungrouped controls pass. Public baseline `48b7bf244` in 13.1 seconds passes actual oscillator recording, take dialog, spreadsheet placement, Move and confirmation, then reports `project.takeGroups[0].takes[0] references missing source` and retains the bin card. The initial same-track partial placement was correctly refused by take coverage and is excluded setup. Corrected retained/unowned media, subsequent take audition, source retention, take commands and multicamera support GREEN 20/20; targeted three-file lint passes. Public unchanged removal and subsequent retained-take audition GREEN on the guarded advance capture in 6.7 seconds. Temporary diagnostics and receipt log were removed immediately. |

| R7-IO-017 | Framescaper File → Import an ordinary silent WebM → Edit → Audio clips → Video retime → Apply freeze at source frame 2 → Move to Project bin → Play. | The bin retained the exact authored curve but its independent media player used linear source endpoints and native playback, advancing the supposedly frozen picture. Resolve the retained curve through the existing authenticated source timing/frame owner and use an occurrence clock that seeks drawable pictures while keeping native video paused. Preserve pause/resume, completion, release, source timing activation and ordinary continuous previews. Reverse, ramp and freeze manifestations share this one owner. | Actual product Freeze → Move causal focused RED starts at zero rather than source frame 2. Public baseline `48b7bf244` continuous playback control passes in 6.3 seconds, then authored Freeze causally RED in 7.7 seconds because native media is playing. Corrected freeze/reverse/ramp, fractional sequence origin, verified irregular timing readiness, pause/resume, rewind/replay and idempotent callback release, plus existing bin model/presentation support GREEN 11/11; existing bin service/command/retime frame dispatch support GREEN 22/22. Targeted six-file type-aware lint, controller-domain direction/membership and diff checks pass. Temporary public diagnostics and the baseline shared log were removed immediately after reading. Public guarded advance capture GREEN completes Freeze, pause/resume, natural completion, replay and release in 7.9 seconds; ordinary continuous playback control passes in 5.6 seconds. The unchanged fixture is variable-rate: Mediabunny packet readback gives source ordinal 2 at 0.195 seconds, which the public timestamp observer now verifies instead of assuming a 30 fps source clock. The original causal native-paused assertion is preserved. |

| R7-IO-018 | Framescaper Tracks → Caption tracks → Choose sidecar file; close while ordinary native filesystem registration is pending → New project → open Caption tracks. | The completed file read published a command against the newly active project through the shared controller. Keep publication within the original live dialog and project identity, while allowing the scoped native read to finish and release its lease. | Mounted control causal RED commits a caption into the new project; healthy original-project import passes. Strong unchanged public baseline healthy import GREEN in 3.1 seconds, then changed-project causal RED in 8.6 seconds: the new project contains both Original dialogue and a subsequent visible New dialogue import. The earlier initially empty draft observer passed prematurely and is excluded. Corrected original completion, closed original dialog, closed/new project and mounted retarget controls GREEN 4/4; each selected read scope completes and releases exactly once. Caption file, finishing model, field and encoding support GREEN 13/13; targeted type-aware lint and diff checks pass. Own public diagnostics and log were removed immediately after this receipt. Guarded capture 68 public GREEN: original pending completion 3.2 seconds; closed/new-project completion, visible new import and exact Undo 4.4 seconds. Both guarded product builds and source/test strict TypeScript pass. |

| R7-IO-019 | Framescaper import an unchanged ordinary 25 fps camera MP4 into a 30 fps sequence → File → Export other → Export FCPXML. | Every original video asset referenced the sequence format, falsely declaring the 25 fps camera as 30 fps before relink. Give original assets their native frame clock and coded geometry, deduplicating equal source formats while keeping the independent sequence format and media identities. Reported anamorphic pixel geometry belongs to that same source-format owner. | Actual public baseline on guarded advance capture: 25 fps sequence control GREEN in 9.7 seconds; 30 fps sequence causally RED in 9.3 seconds with asset frameDuration `1/30s` instead of `1/25s`. The unchanged committed camera was generated through the pinned FFmpeg 25/1 conform path. Strict real product/export-action RED matches that discrepancy; corrected native clock, equal-format sharing and reported pixel geometry GREEN 3/3, with FCPXML/interchange/origin support GREEN 34/34 before the additional geometry control. Every public download is deleted in finally; own failure diagnostics were removed after reading. [Apple format properties](https://developer.apple.com/documentation/professional-video-applications/format?changes=_11), [asset format references](https://developer.apple.com/documentation/professional-video-applications/document-type-definition), and [media versus timeline frame rates](https://developer.apple.com/documentation/professional-video-applications/conform-rate). Guarded capture 68 public GREEN: native 25 fps source in the healthy 25 fps sequence 4.2 seconds and in a 30 fps sequence 4.0 seconds; native resource and independent sequence clocks remain exact. Both guarded product builds and source/test strict TypeScript pass. |

| R7-IO-020 | Soundscaper import an ordinary WAV → track menu → Move selection into new folder → folder context menu → New folder; File → Export other → Export DAWproject, then File → Open the unchanged download. | The app writes an ordinary empty child as contentType=tracks, but its importer identifies folders only by nonempty children and omits that folder as unsupported audio. Respect the declared tracks content type while retaining the existing child-based compatibility, hierarchy and bus identity rules. Empty root and child folders share this classification owner. | Actual product commands, own writer, parser and native product adapter: populated-folder control passes while empty root and child regressions causally lose Pickups. Corrected public baseline on guarded capture 68: populated-folder control GREEN in 4.1 seconds; empty child RED in 9.0 seconds at one imported folder instead of two, after the unchanged recording's exact start and duration pass. Earlier collapse row-count and normalized clip-title observer failures are excluded. Corrected round-trip cases GREEN 3/3; import, export, native archive service, mixer admission and folder commands support GREEN 68/68. Every downloaded archive is deleted immediately in finally; own baseline log and diagnostics were removed after reading. Targeted type-aware lint and diff checks pass. Guarded capture `73b99f5b8` public GREEN: populated folder 6.1 seconds and preserved empty child 6.3 seconds. |

| R7-IO-021 | Soundscaper create an annotation, enable Record options → Sound activation → Add timestamps, lock the annotation track, select an unlocked audio track, then Sound-activated recording → Stop. | Timestamp publication always reused the first label track, so its protected destination refused the entire completed recording transaction and the captured take disappeared. Reuse the first writable label track or create a new label track in that same atomic recording transaction; retain locked annotations and exact timestamp positions. Default/routed capture and destination-order variants share this admission owner. | Actual native microphone/public baseline on guarded capture 68: unlocked annotation control GREEN in 5.1 seconds; locked annotation causal RED in 9.5 seconds after actual captured frames and nonzero peak pass, with Track … is locked and zero committed clips instead of one. The earlier checkbox.check observer failed after its setting was already checked and is excluded. Strict actual Soundscaper commands causally refuse all-locked and first-locked destinations; unchanged unlocked control passes. Corrected destination and immutability controls GREEN 3/3; timestamp, default/routed capture/finalization and locked recording/command support GREEN 67/67 using the standard style-asset test loader. An initial support invocation omitted that loader and is excluded as a harness failure. Targeted type-aware lint and diff checks pass; own public diagnostics/log were removed immediately. Guarded capture `73b99f5b8` public GREEN: unlocked annotation recording 6.1 seconds and locked annotation recording 6.3 seconds, with atomic Undo/Redo. |

| R7-IO-022 | Soundscaper Window → Freesound opens an already connected account while its ordinary pending-upload list is slow; Disconnect, reconnect through OAuth as another account, then let the old list finish. | The old account's asynchronous restoration inserted its uploads into the new account's queue. Bind account publication and pending restoration to their live session generation, retire cancelled connection ownership, and prevent an old unauthorized response from disconnecting the replacement account. Initial and explicit connection continuations share this account publication owner. | Strict actual API/session causal RED restores both account filenames instead of just the replacement; the unchanged-account control passes. Public unchanged guarded capture 68: original-account healthy GREEN in 7.5 seconds; normal sign-out and OAuth reconnection succeed, then the late list causally RED in 7.3 seconds with Connected as new-account and both accounts' ready-to-publish rows (two instead of one). Corrected initial/explicit connection, restoration/expiry and original-account controls GREEN 6/6; API, upload queue and mounted account/upload support GREEN 39/39. The first incomplete OAuth URL fixture failed setup and is excluded. Targeted type-aware lint and own diff checks pass. Own public diagnostics were read and removed immediately. Guarded capture `73b99f5b8` public GREEN: original account 2.6 seconds and replacement account 2.9 seconds, preserving only the live account queue. |

| R7-IO-023 | Framescaper import an ordinary silent WebM into Project bin → Add to timeline → Video retime → Apply freeze at source frame 2; More file actions → Replace with the unchanged four-frame camera MP4 → Keep timeline spacing. | The native product hides authored retime maps while the inherited media replacement changes source and occurrence extents, then restores each unchanged old map against the new binding and refuses the confirmed replacement. Conform surviving authored points through authenticated presentation clocks or the exact CFR rate, carry the curve onto the replacement occurrence grid, and retain valid freeze/reverse/ramp authority and history. Timeline and bin curves, shorter media modes and changed source rates share this custody owner. | Actual immutable `73b99f5b8` public baseline: identical continuous replacement and Undo/Redo GREEN in 13.7 seconds; ordinary authored Freeze and shorter-media confirmation pass, then causal RED in 13.9 seconds because the original source remains. Actual product command RED gives The last curve outer frame must equal outerFrameCount for both spacing modes, while continuous controls pass. Corrected frozen/continuous, timeline/bin, reverse/ramp and authenticated irregular clock controls GREEN 8/8; existing bin service, shorter-media, retime command, re-probe and preview support GREEN 57/57 before the additional irregular clock control. The initially digest-less strict preview fixture is excluded as incomplete normal metadata and was corrected without broadening production admission. Targeted type-aware lint and own diff checks pass. Ordinary committed encoded media stay in memory; owned public diagnostics were read and removed immediately. Guarded capture `b04e692b7` public GREEN: continuous 11.5 seconds and authored Freeze 13.9 seconds, preserving exact conformed points and Undo/Redo. |


| R7-IO-024 | Soundscaper import an ordinary mono WAV → Edit → Metadata editor → ADM → Enable ADM → mono bed; File → Export other → Export DAWproject → File → Open the unchanged download → Export audio with Preserve channels. | The parser retained the master Channel audioChannels, but project assembly hardcoded a stereo master, silently widening the normal mono delivery. Carry the declared master width into the receiving project, retaining the vocabulary's stereo default and native output graph construction. Mono and surround declarations share this one channel-width owner. | Actual public baseline on guarded wave 82: stereo own-export/Open/WAV healthy GREEN in 4.8 seconds; mono original WAV and exact own archive declaration pass, then the reopened actual WAV causally RED at two channels instead of one in 5.7 seconds. An initial checkbox observer omitted its ordinary tail-limit suffix and is excluded setup. [Bitwig's primary Channel definition](https://github.com/bitwig/dawproject/blob/main/src/main/java/com/bitwig/dawproject/Channel.java) defines audioChannels and its stereo default. Strict actual metadata commands, own writer, parser and native project adapter causally RED for mono and 5.1, with stereo healthy. Corrected widths, native output channels and immutable original controls GREEN 3/3; import, export and authored folder support GREEN 42/42. Targeted type-aware lint and diff checks pass. Each downloaded archive is deleted immediately in finally; own baseline diagnostics were read and removed immediately. Guarded capture 24cbd04c0 public postfix GREEN: stereo 7.7 seconds and mono 8.0 seconds, retaining the actual original/archive/reopened WAV channel checks. |

| R7-IO-025 | Framescaper: ordinary Camera WebM → Project bin → Add to timeline; select the first clip, seek to 00:00:00:10, Add again to create a permitted edge transition. File → Export other → Export edit list (EDL) → Delivery Report. | The cut-only EDL emits overlapping record cuts for the automatic native transition, but its report claims the events are preserved and omits no transition. Inventory only positive overlaps between actually emitted cuts; warn with both clip identities and the exact overlap record-frame interval. Retain the existing restricted profile and export bytes so the operator can manually conform the disclosed unsupported overlap. | Guarded 24cbd04c0 public baseline: sequential native placements, actual download and external reader healthy GREEN 6.2 seconds. Proper overlapping native placements, same-track geometry and actual two-event download pass; the pinned CMX reference reader rejects its overlapping record in-point, then the real Delivery Report has zero warnings and zero omissions (causal RED 11.3 seconds). [The reference adapter's primary reader](https://github.com/OpenTimelineIO/otio-cmx3600-adapter/blob/main/src/otio_cmx3600_adapter/cmx_3600.py) rejects overlapping record cuts by default. Strict actual canonical factory, transition allocation and Bin placement independently give a healthy pass and causal missing disclosure. Corrected disclosure, exact identities/interval, frozen data and immutability with existing EDL adapter/timecode/reference support GREEN 35/35; targeted type-aware lint and diff checks pass. An initial Window action hid the default Bin and is excluded setup; equal-boundary overlaps are rejected by ordinary authoring and excluded. Actual downloads and owned diagnostics are deleted immediately. Guarded authenticated capture `678a672d0` public postfix GREEN: sequential 4.6 seconds and overlapping cuts 4.9 seconds, including actual downloads, external-reader behavior and the real Delivery Report. |

| R7-IO-026 | Framescaper: ordinary Camera WebM → Project bin → Add to timeline → Edit → Audio clips → Video retime → Apply freeze at source frame 2; File → Export other → Export edit list (EDL) → Delivery Report. | The EDL project boundary forwards only the old speedRatio scalar, so native Freeze, Reverse and Ramp curves with unity scalars silently become ordinary motion in the delivered cut list. Read the shared native time-effect authority and disclose its omission at the clip boundary, preserving the deliberately restricted EDL output and the formatter's existing scalar-speed disclosure. All curve variants count once. | Guarded 24cbd04c0 public baseline: ordinary continuous placement and actual download healthy GREEN 4.9 seconds. Native freeze publication and actual delivered unity event pass; the real Delivery Report has zero warnings and zero omissions (causal RED 11.5 seconds). Strict actual native freeze commands and public export action independently give the same missing warning while the native preview remains frozen. Corrected continuous/freeze/reverse/ramp, exact one-warning inventory, immutable data and unchanged project controls plus EDL overlap/adapter/formatter/timecode/reference and shared time-authority support GREEN 54/54. Targeted type-aware lint and diff checks pass. Actual downloads and owned public diagnostics were read and removed immediately. Guarded authenticated capture `678a672d0` public postfix GREEN: continuous 4.0 seconds and native Freeze 6.0 seconds, including actual unity cut bytes and the real Delivery Report. |
| R7-IO-027 | Soundscaper: Record level → Turn on input monitoring (hear yourself while recording) → Record; move Playback volume to mute while the microphone is monitored. | The recording worklet connects directly to the speaker destination, bypassing the live device listening gain. Bind each default, routed and take-cycle recorder to the engine’s current listening destination while keeping captured PCM upstream. Standalone low-level capture retains its explicit/default destination; Framescaper’s separate source-rate capture factory is outside this proved Soundscaper owner. | Actual unchanged guarded 678a672d0 public baseline: enabled ordinary monitoring, positive native microphone PCM and full-level monitor control pass; Playback volume reaches −∞ dB but the native recorder-to-speaker gain remains 1 instead of 0 (causal RED 7.5 seconds). A premature observer included the independent meter worklet and is excluded; the corrected passive observer identifies only the real kw-audio-recorder. Strict real app default/routed factory and captured-PCM tests plus the actual low-level worklet give three causal REDs and a healthy standalone control. Corrected focused recording, metering and shared-start support GREEN 16/16, preserving exact nonzero stored samples under listening mute. Targeted type-aware lint and diff checks pass. Owned logs and browser diagnostics were read and immediately removed. Guarded authenticated capture `04e87c277` public postfix GREEN in 3.8 seconds: real input monitoring mutes and restores live listening gain while captured PCM remains nonzero and the recording commits normally. |
| R7-IO-028 | Framescaper Tracks → Caption Tracks; import a normal WebVTT math-lecture cue containing a&lt;b, export the selected native track as SRT, then import that unchanged downloaded SRT. | The plain-text SRT writer preserves a<b correctly, but its importer interprets any less-than sign followed by a letter as markup, even without a closing angle bracket. Require a complete tag-shaped token before refusing unsupported markup, retaining literal comparisons and all existing complete active-content refusals. | Actual unchanged guarded db368adda public baseline: the spaced a < b own-export/reimport control passes 2.2 seconds; unspaced a<b imports as native text and exports the actual correct SRT, then reimport publishes Caption cue markup is outside the passive maintained subset (causal RED 7.9 seconds). Strict real WebVTT import → native writer → SRT reimport independently gives the same RED, with the spaced control and complete-script refusal healthy. Corrected self-writer, passive format, IMSC and active-markup support GREEN 27/27. Targeted type-aware lint and diff checks pass; source remains exactly530 lines. Actual downloads are deleted immediately after reading, and completed owned diagnostics/logs were read and immediately removed. Guarded authenticated capture `04e87c277` public postfix GREEN: spaced comparison 2.5 seconds and unspaced literal comparison 2.4 seconds, retaining actual SRT downloads and native reimports. |
| R7-IO-029 | Soundscaper Music workspace → author 1000 BPM in the normal Project tempo field → File → Export other → Export DAWproject → Open the unchanged downloaded archive. | The native editor accepts 1000 BPM, but the DAWproject writer declares a 999 BPM maximum and its importer clamps the reopened tempo to 999. Align this existing exchange owner with the maintained 1–1000 BPM project range for both root tempo and later events. [Bitwig's primary RealParameter contract](https://github.com/bitwig/dawproject/blob/main/src/main/java/com/bitwig/dawproject/RealParameter.java) defines bounds supplied by the exporting application, rather than a format-wide 999 BPM ceiling. | Actual unchanged guarded db368adda public baseline: native 999 BPM author/export/Open control GREEN 2.2 seconds. Native 1000 BPM authoring and actual exported value pass, then successful Open restores the visible tempo to 999 (causal RED 7.0 seconds). The initial absent default-workspace tempo toolbar is excluded setup; the corrected ordinary Music workspace route qualifies. Two strict canonical root/later 1000 BPM own-writer round trips independently RED while the 999 BPM control passes. Corrected tempo events, valid native reimport, honest parameter bounds, immutable original and existing DAWproject import/export/master-width support GREEN 42/42. Targeted type-aware lint and diff checks pass. Each actual download and all completed owned diagnostics/logs were read and immediately removed. Guarded authenticated capture `04e87c277` public postfix GREEN: 999 BPM control 2.2 seconds and native 1000 BPM author/export/Open 2.0 seconds, retaining actual archive values, advertised bounds and reopened tempo. |

| R7-IO-030 | Soundscaper import an ordinary WAV → track menu → Move selection into new folder → Window → Freesound → connected account → clip menu → Upload clip to Freesound. | The independent clip-upload materializer narrows production tracks while retaining the authored folder hierarchy, so its render engine rejects an otherwise ordinary upload. Derive trusted transient folder media state before narrowing, then explicitly inherit it across the isolated render clone; preserve the canonical project and the upload’s dry, mute-independent clip path. | Actual unchanged guarded `04e87c277` public baseline: ungrouped clip upload healthy GREEN 2.7 seconds, including the actual rendered RIFF request; normal folder authoring, connection and clip upload action pass, then the queue publishes project.tracks must contain every track in exact hierarchy preorder and no publishable upload (causal RED 7.4 seconds). Strict normal canonical folder commands and actual engine independently give the same RED with an ungrouped healthy control. Corrected ungrouped, folder-owned and muted-folder engine controls plus materializer, folder projection and serial upload support GREEN 29/29. Two older minimal production support fixtures now include their canonical empty trackFolders; no validator is weakened. An initial strict fixture added an unsupported track channelCount field and is excluded setup. Targeted type-aware lint and diff checks pass. Ordinary media and service response fixtures remain in memory, no live upload is sent, and all completed owned public diagnostics/logs were read and removed immediately. Guarded capture `8fba4b346` complete public GREEN: ungrouped rendered upload 5.1 seconds and folder-owned rendered upload 4.8 seconds, preserving real RIFF publication. Owned verification diagnostics/log were removed immediately. |

| R7-IO-031 | Framescaper Window → Recording setup → Microphone → Preview sources → Monitor microphone → Arm capture → Start capture; change Playback volume while capturing. | Native source-rate capture uses its own recording factory and may own an independent AudioContext, bypassing the editor’s listening output. Give that factory a context-local monitor gain which follows the live editor publication channel; retire its listener and node with recorder disposal or failed allocation. Preserve native source clocks, captured PCM, input gain, custom recorder ownership and the microphone-only role policy. This independent producer is separate from IO-027’s shared Soundscaper factory. | Actual unchanged guarded `04e87c277` public baseline: complete native full-level monitor/capture/durable import healthy GREEN 5.4 seconds. Actual positive native PCM and unity monitor pass, then Playback volume reaches −∞ dB while the capture recorder-to-speaker gain remains one instead of zero (causal RED 8.4 seconds). The initial Sound-only provider removed native display capability and failed setup; the corrected fixture replaces only the ordinary microphone stream and retains actual runtime capabilities. Strict native factory cases give three causal REDs and a healthy unmonitored control. Corrected 44.1/48 kHz live gain, unchanged source/PCM, idempotent release and failed-allocation controls plus native recording, source-rate, microphone scope and composition support GREEN 43/43. Targeted type-aware lint and diff checks pass; app.js remains exactly680 lines. Completed owned browser diagnostics/logs were read and removed immediately. Guarded capture `8fba4b346` complete public GREEN: full-level native monitor/capture/import 9.2 seconds and listening mute/native PCM/capture/import 8.4 seconds. All four IO-030/031 workflows pass in 31.3 seconds; complete source and test/tooling TypeScript passes. The strict allocation fixture uses Promise.resolve at the actual synchronous-or-async factory boundary. Owned verification diagnostics/log were removed immediately. |

| R7-IO-032 | Soundscaper File → Import an ordinary six-channel WAVEEXTENSIBLE dialogue recording; clip menu → Move to Project bin; card → Play. | The transient audition constructor defaults its output graph to stereo and discards centre and surround programme channels before the existing native-device or stereo surround monitor can fold them down. Infer the implicit output width from occupied native track media, retaining the stereo floor, explicit render widths, unused-source exclusion and immutable source/project data. Bin, source-editor and take auditions share this default allocation owner and count once. | Guarded unchanged `dc8bba540` actual public baseline: stereo programme import, Move and audible native output healthy GREEN 2.7 seconds; regular six-channel WAV written by the maintained encoder with the standard 5.1 mask imports and starts the Bin transport, but its centre-only programme is silent (causal RED 7.3 seconds). Strict actual canonical Bin service independently fails at two output channels versus six, with stereo and unused-source/explicit-width controls passing. Corrected Bin routing, mono/stereo/surround/32-channel constructor scope, explicit allocations, existing warp, companion audio and transport ownership GREEN 29/29; source audition and native take render/flatten controls GREEN 12/12. Targeted type-aware lint and diff checks pass. The tiny ordinary media fixture stays in memory; owned baseline diagnostics/log were read and removed immediately. Guarded authenticated capture `4fc2a8437` unchanged corrected public GREEN: complete stereo import/Bin/native playback 2.8 seconds and centre-only six-channel programme 2.6 seconds, retaining actual audio peak and audible-block assertions. Both cases pass in 7.0 seconds; completed owned diagnostics/log were removed immediately. |

| R7-IO-033 | Desktop Soundscaper File → Import an ordinary 128 kbps MP3 with front/back album cover photographs → File → Overwrite Programme.mp3. | The independently implemented MPEG frame inspector follows the ID3 payload length inside a fixed prefix, so normal album art beyond that prefix hides the supported original action. Seek to the first MPEG frame through an additional bounded read, retaining its actual bitrate strategy, codec/rate/channel proof, supported export profile and existing short-prefix behavior. This MPEG frame owner is separate from IO-008’s M4A movie-box reader. | Final standard pinned FFmpeg/libmp3lame 128 kbps producer on unchanged guarded `4fc2a8437`: unillustrated actual main-IPC selected read, original authority, atomic overwrite and fresh-project reimport healthy GREEN 4.8 seconds; illustrated import reaches one clip and the same real selected-range/original descriptor, then the named Overwrite action is absent and the generic action is disabled (causal RED 7.4 seconds). Strict original HEAD caller independently gives illustrated settings null with the supported 128 kbps plan control passing; corrected caller and original settings/native authority/menu/atomic-save support GREEN 45/45. Targeted type-aware lint and diff checks pass. The initial numeric-array transport import deadline and a preliminary remuxer’s unsupported synthetic 56 kbps delivery are excluded; the final producer uses the ordinary documented APIC writer and committed public-domain NASA photograph, validates its codec/rate/channels/duration and two attached images through the independent reader, and introduces no padding or edited media headers. The strict native fixture is discovered through its owning test import without TypeScript configuration changes. Own selected files, FFmpeg memory filesystem inputs, completed diagnostics and small logs are removed immediately. Guarded authenticated capture `9548d9a3a` complete corrected public GREEN: supported unillustrated native overwrite/reimport 3.0 seconds and ordinary illustrated native overwrite/reimport 3.2 seconds; both pass in 8.0 seconds, retaining actual main atomic saves, independently decoded saved MP3 and fresh-project reimport. Completed owned diagnostics/log were read and immediately removed. [FFmpeg MP3 album art writer](https://www.ffmpeg.org/ffmpeg-formats.html#mp3). |

| R7-IO-034 | Framescaper Desktop Window → Recording setup → Capture options → Web VCR; listen to normal page-audio preview and move Playback volume to mute. | The independently owned page-audio clone connects directly to the raw speaker destination instead of the documented shared monitor bus. Pass the existing context-local listening destination through the app capture composition to this preview owner; keep its independent local mute upstream and retain the original capture track. This clone owner bypasses both Soundscaper IO-027 and Framescaper IO-031 recording factories. | Actual unchanged guarded `9548d9a3a` public baseline: native full-level page audio, local mute/unmute and panel disposal healthy GREEN 3.1 seconds. The same positive controls pass before Playback volume reaches −∞ dB, while a passive native speaker analyser still measures peak 0.99999976 instead of silence (causal RED 7.3 seconds). The existing normal packaged-host service fixture supplies an actual oscillator-backed display MediaStream, without private application entrypoints or project injection. Strict real capture-adapter RED connects to raw-speakers despite its shared listening destination; existing local mute/allocation cleanup controls pass. Corrected shared route, immutable recorded track, local mute independence, idempotent clone disposal and existing Web VCR/app binding/composition/native recorder support GREEN 32/32. Targeted type-aware lint and diff checks pass; app.js stays680 lines and the capture composition stays589 lines. Completed owned baseline diagnostics/log were read and immediately removed. Guarded authenticated capture `1fb50c54d` complete corrected public GREEN: independent local mute, full-level restoration and disposal 3.2 seconds; global mute, exact −12 dB native output, full-level restoration, independent local mute and disposal 3.5 seconds (2/2 in 8.5 seconds). Two later fractional-gain observer failures are excluded: native range fill requires a leading zero, and the existing slider maps position through its documented 60 dB scale rather than linear amplitude. Preserve the original causal mute assertion and use actual position0.8/−12 dB with native peak0.24–0.26. Completed owned diagnostics/log were read and immediately removed. |
| R7-IO-035 | Soundscaper File → Import an ordinary WAV → Export audio → Individual clips (split by clips), WAV/16-bit PCM/None; use the enabled Cancel export while normal origin-storage final close is pending. | The streaming archive service finishes its ZIP, then cancellable output admission fails before its cleanup reaches the caller. Its fallback abort intentionally does nothing to an already-finished archive, leaving the file and live storage lease without an owner. Keep the finished cleanup until successful result handoff; on failure release the finished output, retaining ordinary unfinished abort and successful caller ownership. Stem, chapter, clip and archive-format variants share this one handoff owner. | Actual unchanged guarded `9548d9a3a` public baseline: cancellation during an actual native ZIP write removes its temporary file (healthy GREEN 3.7 seconds); cancellation after actual native close settles the dialog without a download but leaves the ordinary 153890-byte ZIP in OPFS (causal RED 8.4 seconds). The fixture delays only real browser storage completions; every export/cancel control and ordinary media import uses the product UI. Its finally block removes the tiny actual verification ZIP. Strict canonical clip plan plus the real sequential ZIP writer independently fails at retained finished output, while early cancellation and independently decoded successful archive controls pass. Corrected final-close cleanup, unfinished abort, successful ownership, original clip/stem/chapter services, archive admission and native ZIP/7z storage support GREEN 45/45. Targeted type-aware ESLint and diff checks pass. Initial unavailable tail-checkbox and wrong WAV-fixture input-shape setup failures are excluded. Completed owned baseline diagnostics/log were read and removed immediately. Guarded authenticated capture `56c2efd1a` complete corrected public GREEN: native-write cancellation 3.2 seconds and native-final-close cancellation 3.0 seconds (2/2 in 7.8 seconds), preserving normal dialog settlement, absent download and empty actual OPFS ZIP inventory. Both actual tiny verification files and all completed owned diagnostics/log were removed immediately. |
| R7-IO-036 | Soundscaper import an ordinary mono WAV → Window → Mixer → Routing graph → Add group bus → Channels 1 → Save node; File → Export other → Export DAWproject → Open the unchanged download. | The strip writer always declares the master width, and the receiving flat interchange strips drop each bus width before native graph promotion. Serialize each authored native strip width, retain parsed per-strip width in the existing DAW routing context, and restore its graph and channel maps before track routing. Group/send, mono/surround and both directions share one strip custody owner, distinct from IO-024 master assembly. | Actual unchanged guarded `32eb4cebf` public baseline: stereo own archive/Open healthy GREEN 5.3 seconds; the actual saved mono group has one channel but its own downloaded archive declares two (causal RED 5.3 seconds). An initial redundant pointer click on the already selected group is excluded setup. [Bitwig's primary Channel definition](https://raw.githubusercontent.com/bitwig/dawproject/main/src/main/java/com/bitwig/dawproject/Channel.java) defines width per mixer channel. Strict ordinary bus-add, routing-inspector resize, own writer/parser and native promotion fail four mono/6-channel declarations while stereo controls pass. Correcting the writer independently reveals the receiving width loss at the same four round trips. Corrected authored group/send widths, input/output channel maps, valid native projects, immutable original, existing master width, bus routing, pre/post sends, empty folders and interchange support GREEN 56/56. Targeted seven-file type-aware lint and diff checks pass. Corrected complete public awaits the next guarded build. Actual downloaded archives were deleted immediately in finally; completed own diagnostics and logs were read and removed immediately. Both unchanged complete authored group/archive/Open workflows pass Chromium on authenticated guarded capture `3b510658ddb254144c98e401603f23f5ba875aaf`: stereo group 5.8 seconds and mono group 6.3 seconds, checking actual downloaded channel width and the reopened native routing inspector. The complete native-overwrite and group-width batch passes 4/4 in 25.7 seconds; own downloaded media, result directory and log were immediately removed after reading. |
| R7-IO-037 | Soundscaper import an ordinary WAV → track menu → Move selection into new folder → Mute folder; File → Export other → Export DAWproject → Open the unchanged download. | The folder Channel writer copies canonical folder-owned bus mute/solo flags, which intentionally remain false, and its reader puts imported channel gates on that bus instead of the structural folder. Serialize the actual folder gate and restore folder authority while the owned bus stays ungated; the real DAW save path preserves authored leaf flags instead of applying edit-list folder flattening. Nested audio-folder gate decoding and audio-free profile loss disclosure share this one exchange owner. | Actual unchanged authenticated guarded `3b510658ddb254144c98e401603f23f5ba875aaf` public baseline: healthy unmuted archive/Open GREEN 9.8 seconds; ordinary Mute folder is visibly active, then the actual downloaded Folder 1 Channel declares mute=false (causal RED 9.8 seconds; two-case batch 27.6 seconds). Strict ordinary folder commands and actual writer/parser/native import independently reproduce the missing gate. Corrected mute/solo/both, nested gate decoding, audio-free scoped warning, valid canonical bus authority, unchanged source and existing exchange/strip/folder support GREEN 56/56. A nested empty-track adapter investigation is excluded as public evidence: its top-folder control passed 3.8 seconds but nested Open stopped at the import-success observer in 30.1 seconds without a captured canonical refusal; temporary investigation tests and outputs were removed and no mixer adapter was changed. Stronger unchanged guarded `bf42180222a87f589dd41ce62b6fb8b8dba90bd7` actual-save proof independently finds duplicate leaf gating: the healthy own archive/Open passes 3.7 seconds, while a muted folder writes its otherwise unmuted descendant as mute=true (causal RED 3.2 seconds). Actual native save-service archive RED agrees. Corrected writer/reader/save custody and authored muted-leaf controls plus original native service, empty-folder and exchange support GREEN 81/81; final public now also requires Unmute folder to restore an unmuted track and audible decoded WAV. Its unchanged guarded130 unmuted complete archive/Open/WAV control passes 6.7 seconds; an initial wrong normalization-field observer is excluded and corrected to the existing accessible Loudness normalization control without changing production. Targeted type-aware lint, canonical lint:changed and diff checks pass. Complete corrected Chromium public on authenticated guarded `85fca21e6bb56256161a966f864bf8bbd611486a` passes the unmuted archive/Open/decoded-WAV control in 4.5 seconds and authored folder Mute/archive leaf=false/Open/actual Unmute/decoded-WAV control in 4.2 seconds (2/2 in 10.4 seconds). These check the actual independent archive flags, reopened folder and leaf controls and audible native decoded PCM. Actual downloads were deleted immediately in finally and all completed owned baseline and final diagnostics/logs were read and removed immediately. |

| R7-IO-038 | Soundscaper import an ordinary WAV → Record options → Timed recording → choose a future start → Schedule recording; focus the timeline Playhead slider and press End. | The directly published seek action bypasses the capture guard already used by scrubbing and other transport navigation. It moves the armed programme clock after the recorder has captured its fixed placement and schedule, so its eventual playback starts elsewhere. Retain the actual engine position during starting, timer preparation, scheduled and owned capture; restore ordinary seeking after release. Default/routed, active/paused and timer variants share this one direct-seek owner. | Actual unchanged authenticated guarded `85fca21e6bb56256161a966f864bf8bbd611486a` public baseline: normal idle End/Home, Schedule/Cancel and subsequent native Record/Stop/durable PCM healthy GREEN 5.0 seconds. The same positive idle and Schedule controls pass, then the actual focusable Playhead slider's ordinary End changes its armed zero to 1440000 (causal RED 7.5 seconds; 1 PASS/1 RED in 14.4 seconds). The test finally cancels the actual scheduled recorder. Initial wrong helper export and retired Record accessible-name observers are excluded setup failures. Four strict actual public-controller default/routed ordinary/scheduled captures independently RED at 48000 versus the owned zero; corrected cases retain paused capture, subsequent Stop/seek, actual stored PCM and unchanged idle seeking. New and existing action facade, recording session, timer and transport support GREEN 62/62 in 2.47 seconds. Targeted three-file type-aware lint, canonical lint:changed and diff checks pass; Corrected unchanged authenticated guarded `2241ac091` whole keyboard workflows pass 2/2 in 12.4 seconds: ordinary healthy capture 5.5 seconds and keyboard seeking 5.2 seconds, each completing Cancel, a new actual recording, Stop and stored PCM. The strict source-envelope fixture now narrows the actual array and source id; four controls and type-aware fixture lint pass again. The same owner also guards the selection service's range carry and View Skip consumers. A stronger unchanged guarded `2241ac091` baseline observes actual subsequent recorded clip placement after Cancel: healthy unchanged capture above 1000000 frames passes 4.5 seconds; the normally enabled Region path saves the next take at zero (causal RED 4.6 seconds), and Skip saves it at 36307 (causal RED 4.8 seconds), with actual saved PCM in all three paths. Earlier armed/canceled slider-cache observers and an already-cleared Select none setup are excluded. Eight actual controller default/routed paused/scheduled selection/skip cases causally move 24000 to 1000/4096; the corrected narrow shared selection seek guard and existing controller, selection, clip-navigation, timer and transport support pass 85/85 in 2.18 seconds. Four-file type-aware target lint and own diff checks pass; complete corrected five-workflow Chromium public on authenticated guarded `b6a6cdaafd22485d331a77a2b08209a6d74d0be4` passes 5/5 in 27.0 seconds: healthy keyboard 5.3 seconds, blocked keyboard 4.9 seconds, unchanged selection 5.5 seconds, Region 4.8 seconds and Skip 4.6 seconds. All five complete actual Schedule/Cancel, subsequent native Record/Stop and durable PCM; selection controls also retain actual saved take placement above 1000000 frames. This is one capture-playhead admission root, with zero additional count for these consumers. Completed owned public diagnostics/log were read and immediately removed. |

| R7-IO-039 | Framescaper desktop File → Import or Project bin → Add media an ordinary WAV; after the native picker closes while filesystem registration is pending, choose New project and wait for the new project's enabled File Import. | The generic workspace file-choice owner starts controller import only after the selected file returns, without retaining the project that opened the chooser. Its completed media handoff imports into the replacement project. Capture that project identity before opening the chooser and retain publication only in that owner; still enter the existing scoped reader so selected capabilities are released. Project bin media uses the same chooser owner. Intentional File Open project activation remains unchanged. | Unchanged authenticated guarded `44d16c00d487f7543376664fd78ddf714f8fdb6c` public healthy two-import control passes in 3.3 seconds; actual New project, activation and enabled Import pass, then the old handoff plus a completed fresh positive WAV import leave two clips instead of one (causal RED 8.6 seconds). The actual Main chooser, ReadCapabilityStore filesystem open, selected-range protocol and normal menu path run through the existing native fixture. An earlier immediate-resolution observer passes while activation can still block import and is excluded; an exact accessible-name assertion omitting the shortcut is also excluded setup. The extracted unchanged owner gives two focused causal RED publications after a project switch at choice or read, while original-project and intentional multi-project Open controls pass. Corrected owner and existing native read, File Open, file routing and controller import support pass 30/30 in 0.34 seconds; focused strict TypeScript, four-file type-aware lint and own diff checks pass. Completed owning baseline diagnostics and focused verification files are removed immediately after this small receipt. The Bin consumer independently reproduces on the same unchanged capture: healthy two-item imports pass in 3.5 seconds, while the completed old handoff plus a fresh positive import into the activated new project leave two Bin cards instead of one (causal RED 8.6 seconds). An earlier hidden-file-input locator failure is excluded setup. The Bin caller now uses the same project owner; media-only callers do not need a project-opening callback. Shared strict lifetime, linked audio/video Bin UI and maintained native-read policy support pass 18/18 in 0.91 seconds; focused strict compilation and type-aware lint pass. These completed verification files are also removed immediately. All four unchanged complete corrected Chromium public workflows pass on authenticated guarded `c9198813d6f922140a4b482b6e194a1fa9cd57b0`: timeline original/new-project controls 4.0/3.4 seconds and Bin original/new-project controls 4.2/3.4 seconds (4/4 in 16.7 seconds). Each completes the fresh positive import, actual release acknowledgements and Undo; the replacement project contains only its own media. This qualifies one root for the shared chooser and both consumers. Completed owned output and log are read and immediately removed. |

| R7-IO-040 | Soundscaper import an ordinary WAV, set its selection as the loop, Select none → Record options → Record loop into takes; while capturing, focus the enabled Record level slider and press Home. | The dedicated take-cycle recorder exposes no live input control methods, so app state changes while the actual microphone recorder retains its initial gain and monitoring. Forward live controls to the active owned device recorders, preserve display capture policy and retire the old wrapper at Stop before any new session. Extract a strict private controls facade so the frozen routed service remains exactly 577 lines. Gain and monitor manifestations share this one returned-recorder owner. | Actual unchanged authenticated guarded `c9198813d6f922140a4b482b6e194a1fa9cd57b0` healthy ordinary recording applies Home and stores new PCM in 4.9 seconds. Take-cycle recording passes positive native microphone PCM, enabled Home=-60, Stop, saved take group and source greater than 4096 frames, but subsequent captured PCM peak remains 0.1199995 instead of zero (causal RED 4.7 seconds). An initial healthy control incorrectly expected an additional clip instead of the ordinary replacement and is excluded observer setup. The strict actual app/production recorder independently fails with no underlying gain call instead of [0]; the existing before-start input control is healthy. Corrected live gain/monitor, retired wrapper versus a subsequent session, device/display policy, invalid-gain refusal and existing routed cycle/listening support pass 23/23 in 1.32 seconds. Completed owned baseline diagnostics and focused logs are read and immediately removed. Focused strict TypeScript, all eight source/test/spec files' type-aware target lint, canonical lint:changed and own diff checks pass. Both unchanged complete corrected Chromium workflows pass on authenticated guarded `bd5ac4718cfcf9d53a5502cd232f135fa2639581`: ordinary capture 4.5 seconds and take-cycle capture 4.7 seconds (2/2 in 10.7 seconds). Each observes actual positive native PCM before Home, actual zero PCM afterward, ordinary Stop and saved recording sources; the cycle also requires its durable editable take group. This qualifies one live take-recorder control root. Completed own public output and log are read and immediately removed. |

| R7-IO-041 | Soundscaper Window → Freesound → connected account → Upload to Freesound → Choose audio files; choose an ordinary BWF MetaEdit production recording named .bwf on a system without an audio MIME association. | The independent upload queue and picker omit supported BWF/AIFF-C suffixes, so the valid production recording is rejected before its existing WAV conversion. Add both suffixes to these admission lists; retain the authenticated proxy’s direct-format limits and decoder refusal for unsupported bytes. Suffix variants count once. | Guarded `bd5ac4718` unchanged .wav bytes upload through the actual chooser in 1.9 seconds; the same .bwf production bytes fail in 6.7 seconds with the visible “production-take.bwf is not a supported audio file.” alert and no ready row. Strict ordinary WAV control passes; BWF/AIFF-C queue regressions causally fail at the same whitelist. Corrected queue admission and existing queue, panel and conversion regressions pass 22/22 in 0.7 seconds; narrow strict compilation, targeted type-aware lint, canonical changed-file lint and diff checks pass. A first temporary compiler config outside the repository could not resolve node/vite ambient types and is excluded; the faithful in-worktree config passes and was immediately removed. The public witness additionally verifies the uploaded WAV’s mono one-second PCM geometry and the corrected picker filter. An initial guarded bc991d5fe postfix completes both actual uploads but its new five-microsecond duration observer excludes normal native resampling: BWF converts to 44099 frames at 44100 Hz, within one output sample of the authored second. That observer failure is excluded; retain actual PCM facts and use a one-sample extent bound. Its exact context/PNG were read and its completed results/log were removed immediately. Corrected guarded `bc991d5fe` complete actual chooser → uploaded RIFF/mono PCM → Ready to publish workflows pass .wav 2.3 seconds and .bwf 2.0 seconds (2/2 in 6.1 seconds), retaining the one-output-sample extent bound and corrected picker suffix. Completed public and focused outputs are removed immediately after this receipt. |
| R7-IO-042 | Soundscaper Window → Freesound → connected account → Upload to Freesound → Choose audio files; upload an ordinary 96 kHz BWF with its existing audio/wav MIME association. | The independently owned conversion decoder adopts the device playback clock, silently resampling a native high-resolution recording while merely converting it to 24-bit WAV. Pin its context to the maintained decoded-rate authority; preserve unknown/AAC container fallback, byte-limit admission, cancellation and owned decoder closure. Preexisting MIME admission makes this independent of IO041 suffix support; all rate/container variants count once. | Guarded `bc991d5fe` actual chooser/upload/Ready healthy 44.1 kHz control passes 2.3 seconds. The maintained BWF writer produces ordinary 96 kHz/24000-frame source bytes; actual upload completes, then causally fails in 1.8 seconds with 44.1 kHz/11024 delivered frames. Its 3 kHz programme amplitude remains 0.200019, while its authored 26 kHz band falls from 0.15 to 0.001333. The actual request bytes, Ready row and original source clocks are checked; no native decoder or state is replaced. Strict default-device model independently fails 44100 versus 96000, while same-rate and conservative AAC fallback controls pass. Read baseline PNG/context and bounded logs are removed immediately. Corrected clock, same-rate, AAC fallback and existing metadata, queue, suffix and conversion support pass 39/39 in 0.96 seconds. Narrow strict compilation, target type-aware lint and canonical changed-file lint pass. The first implementation reused the output bytes binding for its input and failed transformation/strict compilation; it is corrected to a distinct input binding before the successful gates and adds no count. Focused outputs and temporary compiler config are removed immediately. Complete unchanged native Chromium uploads pass on guarded authenticated `2e3ad747b`: 44.1 kHz healthy 2.0 seconds and 96 kHz corrected 1.9 seconds, retaining original sample clocks, quarter-second extents, actual 24-bit PCM and programme/upper-band energy. The full five-case I/O/capture/library batch passes in 22.3 seconds. Completed owned output and log are read and removed immediately. |
| Take-cycle signed offset (excluded; zero count) | Preferences → Audio settings → Recording offset -500 ms, then normal Record loop into takes. | Dedicated cycle PCM deliberately omits external latency calibration in its maintained production contract; no published take-cycle offset promise was found. The enabled global preference alone does not establish supported cycle calibration. No source correction or root count. | Guarded `bd5ac4718` ordinary negative-offset recording passes 7.7 seconds and zero-offset cycle capture passes 7.4 seconds; the offset cycle records positive PCM and saves a take at zero instead of 21907 frames (7.4 seconds). This difference is excluded under the existing explicit profile boundary. An initial ordinary observer read source inventory before Saved and is also excluded. All completed diagnostic files and the provisional browser spec were removed immediately. |
| R7-IO-043 | Soundscaper Audio setup → Speakers → choose an available output; Window → Freesound → Search → Play preview. | The independently implemented HTMLAudioElement preview never inherits the chosen browser speaker device, even when the real editor context has successfully routed there. Route new, live and paused previews through the chosen device and wait for native routing before playback; retain listening gain and preview lifetime. Device variants count once, separately from IO014 scalar gain. | Guarded `2e3ad747b` default output healthy native preview passes 2.9 seconds. Chromium's built-in hardware fixture exposes genuine enumerated output devices; both native AudioContext.setSinkId and HTMLAudioElement.setSinkId accept the selected device. The ordinary Speakers control routes the actual editor graph there, then the real advancing Freesound preview causally fails in 2.5 seconds with an empty/default sinkId instead of the chosen device. No device enumeration or routing API is replaced. Read baseline PNG/context and bounded outputs are removed immediately. Strict mounted regressions causally fail both initial selected output and live device changes; the corrected new/default/live/paused/delayed-routing cases and existing gain, search, pause and account lifetime support pass 16/16 in 1.1 seconds. Native output updates are serialized, initial/resumed play waits for routing, and retired preview requests remain fenced. Target type-aware lint and diff checks pass. Completed focused logs are removed immediately. Complete unchanged native Chromium workflows pass on authenticated guarded `0f0d9ba2f`: default output 2.8 seconds and selected/live/paused output 2.7 seconds (2/2 in 7.3 seconds). Actual graph/media routing to both genuinely enumerated speaker devices and back to System default, advancing real media and same-player paused resume all pass. Completed owned outputs/log are read and removed immediately; this root is qualified once. |
| R7-IO-044 | Soundscaper import an ordinary WAV → Audio setup → Speakers → choose an available output; Clip properties → Play source, or Move to Project bin → Play card. | The shared independently implemented audition-engine factory forwards listening gain but never the main engine's chosen speaker device, leaving its owned AudioContexts on the system default. Bind initial and live browser output choices across its Bin/source/take consumers, retaining gain, offline render separation and disposal. All factory consumers count once; Freesound IO043 owns a separate native media-element path. | Authenticated guarded `0f0d9ba2f` unchanged default Bin/source controls pass 2.5/2.6 seconds. Both chosen-output cases reach native audible PCM (>0.05 peak), but causally fail in 2.8/2.6 seconds with an empty preview AudioContext sinkId after the actual main graph successfully routes the genuinely enumerated device through ordinary Speakers. The graph/analyser observer remains passive; no device API or application state is replaced. Exact PNG/context and bounded baseline output are read and removed immediately. Actual controller-resource default control passes and selected-output inheritance causally fails. Corrected real-resource inheritance, delayed/latest-device playback, live updates/disposal and existing gain, source audition and action/take facade controls pass 29/29 in 1.7 seconds. Initial source correction is observed before its asynchronous routing queue settles; the faithful resource test yields through the actual queue, while separate controlled native-allocation tests require that no PCM plays before the latest device completes. Target type-aware lint and diff checks pass. Completed focused output is removed immediately. Canonical changed-file lint also passes. The public controls now additionally require live native device change, paused System default and resumed positive native PCM. Four unchanged complete native Chromium workflows pass on authenticated guarded `2541ed646`: Bin default/selected 3.5/4.2 seconds and source default/selected 3.7/4.0 seconds (4/4 in 17.3 seconds). Both chosen-output workflows retain live actual speaker changes, paused System default and resumed fresh audible PCM. This qualifies one shared audition factory root. Completed owned output and bounded log are read and immediately removed. |
| R7-IO-045 | Soundscaper import an ordinary WAV → Mixer → two group buses → track Output Group bus1 → Routing graph → route Group bus1 through lower-fader Group bus2 → Export DAWproject → Open the unchanged download → Export audio. | The reader routes every bus directly to Master because it visits only audio tracks, bypassing the authored downstream processing. Decode bus-origin destinations and sends separately, preserve their channel widths/pre-fader position, then promote that owning context through the existing native graph adapter. All bus-origin routes share one reader owner; R3IO018 repaired the independent writer and R3IO021 promoted already decoded track routes. | Guarded2541 healthy direct-Master round trip PASS6.0 seconds; downstream round trip causally RED7.3 seconds after actual quieter source PCM and exact archive destination PASS. Reopened decoded WAV is2.703958207times louder. Strict own command/writer/reader/product witnesses independently pass two direct-Master controls and fail both group/send downstream assignments. Corrected group/send destinations, bus-origin pre-fader sends, input immutability and existing importer/product/folder/mono/master width controls PASS51/51in2.7 seconds; targeted type-aware lint passes. Both unchanged complete workflows pass authenticated guarded5dd339942: healthy direct master5.7 seconds and restored audible downstream group7.1 seconds (2/2in14.5 seconds). Actual archive/WAV download files are deleted immediately after reading, and completed diagnostics/focused logs are consumed and removed immediately. |

IO-031 checkpoint follow-through places the exact native capture listening helper
with its eagerly composed recording-factory adapter in editor-controller-core.
The existing generic static-import guard caused the helper-105 RED; its precise
optional-capture basename exclusion restores that semantic owner without changing
runtime behavior, priorities or budgets. Ownership and native monitor controls
pass 32/32; targeted lint and diff checks pass. This adds no bug count and no
generated assistance runtime bytes.

Checkpoint follow-through retains the multicamera source-retention helper in the
existing private Framescaper project-command chunk owner. The generic eager
import ownership guard covers this edge without changing source semantics or
weakening build budgets. Public exact-byte .opus and .ogg overwrite controls both
pass on guarded capture `58264ec46` in 1.7 and 1.5 seconds respectively; Freesound's
current, live and paused listening-gain workflow passes in 2.1 seconds on the same
capture.

The retimed bin preview private helper is explicitly reviewed in the runtime
timing-reader inventory: it consumes authored sequence/source frame ordinals
through the authenticated frame binding after the registered preview boundary.
The unchanged exact inventory guard causally detected its missing row; this
verification follow-through adds no bug count and changes no source semantics.
The complete runtime consumer audit and strict retime preview controls pass 20/20;
targeted type-aware lint and diff checks pass.


The Freesound account-lifetime owner also covers the original-download wrapper.
A pending Add to project request captured no account identity before interpreting
its response, so a late 401 from the disconnected account expired the newly
connected account. This is zero-count follow-through of IO-022. Actual public
baseline on guarded `b04e692b7`: original-account expiry control passes in 5.4
seconds; normal Add to project, Disconnect and replacement OAuth connection pass,
then the completed old response publishes its canonical unauthorized toast and
clears the replacement account in 10.9 seconds. The first browser attempts used
a retired button label and omitted the normal `(401)` error suffix; these observer
failures are excluded. Capture the immutable request auth identity before awaiting
the transport and expire only its still-current owner. Mounted original-expiry and
replacement controls now pass, with the existing account-restoration and preview
lifetime cases (13/13). Owned browser diagnostics were read and removed immediately.
Guarded wave 82 public GREEN: original expiry 2.3 seconds and replacement account retained 2.8 seconds; unchanged original restoration controls pass in 2.6 and 2.7 seconds.


The finishing dialog's IO-018 lifetime fence also covers its native cube LUT
producer (zero new count). Normal Solid authoring and Selected Visual Inspector
Opacity 0.5 create a real target; Grading & Finishing Presets → Choose .cube LUT
then completes a slow ordinary native read. On unchanged `b04e692b7`, the open
healthy target passes in 13.1 seconds, but Close still publishes the LUT into that
same target in 12.7 seconds. The released native lease encloses the complete LUT
consumer and history commit before the reopened canonical document is inspected.
An initial observer opened the other product's database and is excluded; the
correct public document observer preserves the positive original presentation.
Mounted choice, selected read and asset lookup controls independently give three
healthy passes and three causal commits after Close. Abort the owned LUT lifetime
on Close, unmount or project/surface change and pass that signal through the
selected read and existing guarded LUT publisher, retaining lease cleanup and
healthy publication. Corrected mounted lifetime, existing caption lifetime, LUT
publication/rollback and finishing document controls pass 34/34; targeted type-aware
lint and own diff checks pass. Guarded wave 82 public GREEN: healthy open-target publication 11.9 seconds and Close cancellation 7.8 seconds, retaining the complete consumer lease and canonical document checks.
Owned diagnostics and temporary native sidecar directories were removed immediately.

The checkpoint at fifty fixes remains a failed full browser gate: 6077 passes,
87 failures, 244 skips and six cases not run. Its file/format/capture triage does
not replace that receipt with the focused replays. On unchanged guarded capture
24cbd04c0, Firefox File Open/Export, CUE and DAWproject controls pass 12/12:
AUP3 export 6.4 seconds, imports 4.0/4.2 seconds; AUP4 5.7/6.3/5.1 seconds;
CUE 2.8/4.4 seconds; DAWproject automation, bus, imported routing and loops
9.5/4.3/8.3/2.9 seconds. Those original failures stopped during bootstrap except
the automation case's decoding deadline. The original Chromium FCPXML pair
failed only the missing external reference provision; with the pinned reader
already available, the unchanged sequential/overlap controls pass in 1.9/1.7
seconds. All sixteen Chromium capture/FCPXML controls pass, including ordinary
record/pause/reopen 8.2 seconds, Inputs setup 8.3 seconds and actual Web VCR
record/import/reopen 10.5 seconds. The two unchanged Firefox dialog-coverage
import/control cases pass in 8.3/10.7 seconds. These are zero-count verification
receipts. The initial Firefox WavPack replay's Pause observer failed after reload;
additional ready-state and activation-fence hypotheses also failed and their
temporary edits were reverted. Passive observation confirmed ready=true, no
activation pending and no dialog, alert or client error. The unchanged existing
CI Firefox audio-clock probe then proved the inherited WSLg Pulse socket unhealthy:
zero clock advance, a suspended context and four timed-out resume probes. The
initial long pristine BW64 replay reached its 175446 ms publication deadline;
the second case was interrupted after 16.5 seconds and is excluded. Restoring
the existing CI null sink with already extracted binaries gives the unchanged
probe 0.059 seconds of advance and a maximum restart of 38 ms. Against guarded
authenticated capture `678a672d0`, unchanged WavPack persistence/reload/play/edit
and legacy read now pass in 8.6 seconds; pristine BW64 passthrough and authored
BW64 stream/cancellation pass in 1.8 and 1.4 minutes, retaining every original
deadline, PCM, container and publication assertion. Four unchanged Firefox
capture/Inputs cases pass in 4.5/9.4/11.1/6.7 seconds. Nine unchanged WebKit
format/capture cases also pass: WAV/BWF/BW64/AIFF export round trips in
3.3/3.8/4.0/3.4 seconds; AIFF/M4A/OGA/AIF import, playback and reload in
4.5/4.1/4.5/4.3 seconds; capture/pause/resume/import/reopen in 11.7 seconds.
These replays change no source, test, deadline or bug count. All 27 reviewed owned original diagnostic directories and each completed
focused replay's diagnostics/log were removed immediately; the root retains the
small shared full-run log.



The checkpoint100 Firefox IO-016 take-retention failure and unchanged frozen
`ee53e1126` focused replay stop before editor boot: Playwright rejects the fixture's
`clipboard-read` permission (replay 0.814 seconds). This is a fixture failure and
adds no product bug count. Advance uses the already established spreadsheet
ClipboardEvent path in Firefox/WebKit and retains Chromium's native permission,
keyboard and clipboard path. All original actual recording, take placement,
confirmed bin removal and subsequent take audition assertions remain. The complete
Firefox workflow passes on unchanged guarded `56c2efd1a` in 10.5 seconds (12.8 seconds
including setup). Only that completed checkpoint diagnostic directory and the
owned replay/verification outputs were removed immediately; the full checkpoint
failure log and frozen tracked/build bytes remain untouched.

The existing R6-IO-003 sound-activation drain owner also covers Pause (zero new
count). Normal microphone recording → Pause → Stop on guarded `56c2efd1a`
retains all PCM without activation (4.9 seconds), but activation saves 28672 of
31982 actually captured frames (causal RED, 4.6 seconds). The native worklet
flushes partial PCM before its paused acknowledgment; the old wrapper paused its
gate before those serialized writes reached it. An optional recorder completion
hook now places the gate boundary inside that same PCM queue, while public Pause
and Resume remain synchronous. Early and repeated Resume requests retain the old
held PCM and reset source continuity only after its drain; cancellation retires
pending boundaries. Actual worklet focused RED loses audible and held quiet tails
and rejects a resumed source gap. The corrected eight strict cases plus existing
Stop, lifecycle, routing, gate, input and timed-pause controls pass 78/78; targeted
five-file type-aware lint and own diff checks pass. Corrected guarded `32eb4cebf`
public verifies ordinary Pause (5.9 seconds), activated Pause (5.6 seconds), and the
existing activated Stop final-chunk control (7.5 seconds): all three complete
actual captured-PCM/save assertions pass in 22.9 seconds. Owned public diagnostics
and completed focused logs were removed immediately; no archive or raw coverage
was generated. The complete compiler later found an excess-property error in
the test's inline recorder options: JavaScript inference lists only defaulted
fields. Name the faithful actual options object before passing it to the existing
factory; no source API changes. All eight actual PCM/acknowledgment controls and
targeted fixture lint pass again. Their bounded logs were removed immediately.

The frozen checkpoint100 WebKit FLAC and Ogg Vorbis import-format failures
both complete ordinary import, stereo PCM and peak assertions, then visibly
refuse Play with `The streamed and buffered sources missed their shared playback
start.` The original failure remains part of the full-suite receipt. Unchanged
isolated replay on the exact frozen `ee53e112619b862826b7466dc422b3c6760bba27`
checkout and prepared products, using its existing qualified Pulse sink and one
worker, completes both original import/Play/Stop/save/reload flows: FLAC 17.4
seconds and Ogg Vorbis 15.4 seconds, 2/2 in 39.4 seconds. No source, observer,
assertion, deadline or frozen byte changes were made, and no fresh bug is counted.
Both exact reviewed full-run diagnostic directories and the completed owned
replay log/results were removed immediately; the shared full-suite log remains.

Frozen checkpoint100 WebKit original-file-overwrite case 28 remains unresolved.
The full-run snapshot has an imported clip while Import, Export and the generic
Overwrite action are disabled during import. Exact unchanged isolated replay on
`ee53e112619b862826b7466dc422b3c6760bba27` with qualified Pulse and one worker
fails earlier in 14.1 seconds: its five-second clip-count assertion sees zero
clips while the ordinary import is visibly at 61 percent. No completed decode,
codec refusal or original-settings regression is proved by this replay. The
original failure is retained, no assertions or deadlines are changed and no new
root is counted; completed exact original and owned replay diagnostics/log were
read and removed immediately. A later unchanged replay after full-suite resource
pressure ends remains pending.


Frozen checkpoint100 WebKit multicamera-attribution case 35 passes actual switched
source attribution and the downloaded CSV assertions, then reaches the original
30-second whole-test deadline during reload readiness. The original log and
reviewed context/PNG show the restored project with two clips and five tracks
while activation is pending; they do not establish an attribution failure.
No source, deadline or test changes are made and no new root is counted. Its
exact completed original diagnostic directory was removed immediately after
this receipt; unchanged low-load frozen replay remains pending until the full
suite finishes. The shared full-run log remains with the root.

The final frozen checkpoint100 WebKit I/O failures 41–44 are read before their
unchanged isolated replays. Case 41 stops before editor boot at the unsupported
`clipboard-write` permission; the existing advance ClipboardEvent fixture
correction already covers that setup owner. Case 42 reaches the shorter-file
replacement choice after its five-second visibility assertion expires: its
failure screenshot contains the actual choice, while the earlier context lacks
it; no curve-loss assertion is reached. Case 43 preserves the authored 999 BPM
in Musical timeline but sees every File mutation disabled before DAWproject
export; its screenshot contains an empty-looking timeline and the generic
unavailable-state explanation, so no completed archive regression is proved.
Case 44 reaches the healthy LUT consumer and receives the canonical IndexedDB
error `Error preparing Blob/File data to be stored in object store`; the Close
control passed in the full run. These full-suite failures remain failures.
Reviewed exact contexts/PNGs are removed immediately; no source, deadline,
assertion or fresh bug count changes are inferred from them. Exact frozen
low-load replays of 28, 35 and 42–44 remain pending; the small shared full-run log
remains with the root.

After the full run ends, exact unchanged frozen `ee53e1126` WebKit/Pulse
one-worker replay completes 7/8 original whole workflows in 1.7 minutes:
AAC overwrite availability 5.3 seconds; multicamera attribution/CSV/reload
18.9 seconds; continuous/frozen replacement 14.8/16.6 seconds; authored
999/1000 BPM archive/Open 5.9/5.2 seconds; LUT Close cancellation 12.2 seconds.
The healthy LUT consumer still fails in 17.4 seconds with the same canonical
IndexedDB Blob/File preparation refusal. Its exact context/PNG is reviewed;
this is an unresolved actual storage refusal, not a passing lifetime consumer.
No assertion, deadline, source, frozen tracked/build byte or count is changed.
The complete original full-run failures remain in their shared receipt. All
completed owned replay outputs and log are removed immediately; the root keeps
the small shared full-suite log.

The LUT fixture now probes the established IndexedDB Blob prerequisite only
for its healthy storage consumer; Close still exercises its complete native
lease and canceled canonical publication on that host. The same self-contained
probe used by prior Freeze witnesses concretely refuses the current WebKit
substrate. On unchanged guarded `b6a6cdaaf`, corrected WebKit actual take
retention passes 8.1 seconds with the existing faithful ClipboardEvent path,
and LUT Close cancellation passes 11.4 seconds; healthy LUT reports one explicit
capability skip, not a pass (2 PASS/1 SKIP in 23.9 seconds). All original capture,
PCM, take placement/removal/audition, cancellation and document assertions remain.
This fixture-only follow-through changes no production source or bug count.
Owned completed WebKit output and log are immediately removed.
Unchanged Chromium healthy/Close consumers pass 7.2/5.3 seconds and Firefox
healthy/Close pass 10.4/6.8 seconds (4/4 in 32.3 seconds) on the same guarded
source capture; no successful engine is narrowed and every healthy target still
requires its actual native lease, digest publication and canonical document.
Targeted fixture ESLint and own diff checks pass. All completed portable replay
outputs/log are immediately removed. This changes no assistance runtime closure.

Checkpoint150 static follow-through (zero count): the complete repository lint,
source/product/test/tooling compilers and dependency cruiser passed, then the
controller-domain guard refused a stale `import -> export` runtime permission.
IO037 commit `65fd115b1` intentionally retired that last edge when DAWproject
save stopped applying render-only folder gates. Remove only the retired
permission; preserve every public-module declaration and remaining dependency
ceiling. The exact current controller guard passes with 229 public modules,
45 runtime pairs and 25 type-only pairs; its twelve existing policy regressions
pass in 1.1 seconds. The immutable checkpoint remains unchanged.

Checkpoint150 Chromium original overwrite retains Dialogue.wav delivery facts
failed at its unchanged 30-second File menu deadline. The read PNG and context
show the imported clip and Saved, but generic Overwrite, Import, Export, New and
Save are all disabled in the open menu; no named original action appears. The
exact unchanged isolated workflow on frozen `bd5ac4718`, qualified Pulse and
one worker passes in 2.0 seconds, including actual delivered BEXT, 24-bit PCM,
48 kHz and 2400-frame assertions. Preserve the full-run failure; no production
root or deadline correction is established. Its reviewed original failure
folder, isolated results and bounded replay logs were removed immediately.

Checkpoint150 Node scoped-reader follow-through (zero count):
`audio-editor-app-modules.test.js` still required `fileService.withReadDescriptors`
inside both JSX callers after IO039 moved their complete chooser/read lifetime
into `desktop-workspace-file-choice.ts`. The frozen full-run assertion is RED;
the helper preserves the actual scoped descriptor owner. Update the static
witness to require both callers’ exact helper import and invocation plus the
helper’s `withReadDescriptors` consumer; retain the project-specific reader and
forbid unscoped `openReadDescriptor` in all four owners. Existing app-module,
strict pending-project lifetime and actual file-service capability regressions
pass 29/29 in 0.3 seconds, with targeted ESLint and diff checks passing. The
immutable checkpoint remains unchanged; bounded focused logs are removed
immediately. No source semantics, capability ceiling or count changes.

Checkpoint150 scheduled recording keyboard healthy control (zero count): the
Chromium seek=false case passes arming, original playhead, ordinary cancellation
and restored keyboard navigation, then fails only the post-cancel actual recording
clip-count assertion (one instead of two). Its read PNG/context show Saved/Done
and the original clip; no canonical refusal is visible. The exact unchanged
five complete cases on frozen `bd5ac4718`, qualified Pulse and one worker pass
5.6/5.4 seconds (keyboard controls) and 4.6/4.8/4.9 seconds (unchanged/region/skip
selection controls), 5/5 in 27.1 seconds. Preserve the original full-run failure;
no source cause or deadline correction is established. The reviewed failure
folder and completed isolated output/log are removed immediately.

Checkpoint150 three desktop-library/capture observations (zero count; replay
pending): the Soundscaper desktop project-library whole create/edit/reopen/
duplicate/delete case and Framescaper capture's origin-delete refusal and
other-project-delete workflows each fail solely because the confirmed
Delete this project? modal remains visible (unchanged 5/5/30-second deadlines).
All three exact contexts and PNGs were read; their screenshots retain the
confirmed modal and underlying active project/capture. No new I/O source cause
is established; the previously repaired D036 dialog handoff is a candidate
shared owner. Preserve these original full-run failures and replay all three
whole unchanged workflows after the next guarded capture. Reviewed original
failure directories are removed immediately after this receipt.
The three whole unchanged Chromium workflows pass on guarded `2e3ad747b`: desktop
library 5.5 seconds, capture-origin delete/refusal/Stop/import 7.3 seconds and
other-project deletion while origin capture continues 3.9 seconds. D036 already
contains the corrected project-handoff owner. Preserve their original full-run
failures; this follow-through adds no source change or count. The shared owned
five-case output and bounded log are read and immediately removed.

Full150 Firefox also fails recording-notes.spec.js:98 at its unchanged five-second
Local projects disappearance check: the dialog remains after opening Field
session, while the exact context/PNG show Field session already active with its
saved original notes under that modal. This matches the previously repaired
D036 project-handoff family, without establishing a fresh I/O root. Preserve
the full-run failure; its exact reviewed completed diagnostic directory is
removed immediately, and the whole unchanged workflow awaits guarded replay.

All five unchanged whole Firefox follow-through workflows pass on authenticated
`0f0d9ba2f` with the qualified Pulse sink and one worker: tail-metadata AAC
6.9 seconds, duplicate/delete/source-media retention 13.4 seconds, project
interchange menus 3.4 seconds, inactive tab/audio reopen 6.7 seconds and
immediate recording-notes project switch/reload 7.0 seconds (5/5 in 39.8 seconds).
The original full150 failures remain: AAC stopped at imported clip count with
Importing67%; the other four retained a project-handoff modal. D036 is already
corrected in this guard. No source, fixture, deadline or count changes are added
by these replays. Completed owned output and bounded log are removed immediately.

Full200 completed Firefox AAC observation (zero count): the ordinary
tail-metadata original-overwrite case fails in9.148 seconds at its first clip
count, zero versus one within5000 ms. The actual snapshot still publishes
data-edit-block-reason=importing; its PNG shows Importing4% and no committed clip,
before the overwrite menu assertion is reached. Its exact completed JSON,
context and PNG were read and the owned diagnostic directory immediately
removed. The original full-suite failure remains recorded. This is the same
unsettled import setup observation seen in full150, whose unchanged complete
replay passed; no product cause, deadline change or new count is inferred.
The whole unchanged Firefox workflow passes on authenticated a3a36854d in8.6
seconds (one case,11.6 seconds total) with the qualified Pulse sink and one
worker: original one-clip admission and enabled named Overwrite Programme.m4a
both pass. Source, fixture, assertions and deadlines remain unchanged. This
does not establish a product defect or add a count; the original full-run
failure remains recorded. Completed owned output/log are read and immediately
removed, and all replay readers close.

Full200 completed Firefox sequence-visual observation (zero count): the ordinary
title rate workflow times out at its unchanged30000 ms case deadline
(31.711 seconds). Its marker provides only the case timeout, without a failed
duration assertion. The actual context contains the authored Title and selected
25 fps metadata; its PNG shows Clip properties with its panel menu open.
The exact completed JSON/context/PNG were read and the owned diagnostic
directory immediately removed. No duration-conformance defect, observer cause
or new count is inferred. Both whole unchanged Firefox workflows pass on
authenticated a3a36854d with the qualified Pulse sink and one worker: title26.7
seconds and image12.6 seconds (2/2 in42.2 seconds), including exact five-second
wall-clock duration at30 and25 fps and full Undo/Redo. Source, fixture, all
assertions and the30000 ms case deadlines remain unchanged. The original
full-run timeout is preserved. Completed owned output/log are read and removed
immediately, and all replay readers close; the frozen full-suite source and
assets remain immutable.


Full200 completed Firefox camera-clock observations (zero count): both ordinary
48 kHz PCM camera cases fail before application import. The 3000 Hz case takes
2.425 seconds and the 23000 Hz case takes3.914 seconds; both exact JSON stacks
point to the test's direct OfflineAudioContext.decodeAudioData source witness
with “unknown content type.” Their contexts and PNGs show a ready empty editor,
without an imported clip. The application importer and delivered-band assertions
are not reached, so these failures do not establish a native-clock product
regression. Both exact completed JSON/context/PNG sets were read and their owned
diagnostic directories immediately removed. The original full-suite failures
remain recorded; unchanged whole focused replay and decoder capability review
are pending without source, deadline or count changes.
The unchanged whole Firefox replay repeats both pre-import native decode failures
in4.5 and4.4 seconds. Product decodeImportedVideoAudio explicitly continues from
native decode refusal to container decoding and then FFmpeg; this witness is
specifically for its native decoder's sample clock. The repeat log and exact
completed contexts were read; their owned diagnostic output was immediately
removed. No app
source defect is inferred from unavailable native decoding.
The faithful native capability preflight now skips only when this ordinary source
is refused by its native OfflineAudioContext with DOMException EncodingError.
Every other source error and every delivered decode error still fails. The
ordinary app import, two committed clips, real WAV download,48 kHz clocks and
source/delivered physical band thresholds remain unchanged on native-capable
engines. The complete two-case matrix on authenticated a3a36854d passes4 cases
in43.1 seconds: Chromium4.8/4.8 seconds and WebKit10.6/9.2 seconds. Firefox
reports2 exact native-capability skips, rather than product passes. No product
source, deadline or count changes; the original full200 failures remain recorded.
The completed owned browser output/log are read and removed immediately, with
all native replay readers closed. Existing strict native-clock and video decode
fallback controls pass9/9 in1.566 seconds. Target type-aware lint, canonical
changed-file lint and whitespace checks pass; their completed bounded logs are
consumed and immediately removed. This test-only capability correction requires
no manual Update AI assets run.


Full200 FX035 Firefox export-witness observation (verification only, zero count):
the one-bar warp workflow times out at its unchanged30000 ms deadline
(35.874 seconds). The exact marker stack points to exportedDrum's page.evaluate
for the second real downloaded WAV, after the normal musical warp controls and
first healthy delivered PCM check have completed. The actual PNG/context show
Export audio with a completed WAV download link and the authored five-second
recording placed at four seconds. No failed marker, frame, peak or peak-position
assertion establishes a DSP regression. The completed JSON/context/PNG were
read and the exact owned diagnostic directory immediately removed. The original
full-suite timeout remains recorded; unchanged whole Firefox replay is pending.
The complete unchanged Firefox replay repeats the same second exportedDrum
page.evaluate timeout in37.9 seconds at the original30-second deadline. Its
actual repeat context again shows a completed real WAV download; its PNG
is an empty image. The numeric array transport serializes every downloaded byte across the Playwright boundary;
only that verification transport will be replaced with byte-preserving Node
Buffer base64 and browser atob/Uint8Array, retaining the native WAV decoder and
all fresh-delivery, frame, peak, peak-position, marker, Undo and client-error
assertions. The repeat log/context/PNG were read and the exact owned replay
output/log immediately removed. No product or helper edit or new count is added.
The complete byte-preserving workflow on authenticated a3a36854d passes all3
engines within the unchanged30-second case deadline: Chromium11.1 seconds,
Firefox18.3 seconds and WebKit18.4 seconds (3/3 in53.0 seconds). Both actual
fresh WAV deliveries, exact432000 frames, healthy/drum peak and peak-position
bounds, the musical marker, Undo, empty alerts and client errors all remain
asserted. Target type-aware lint, canonical changed-file lint and whitespace
checks pass. Completed owned replay output and bounded logs are consumed and
immediately removed; all native readers close. The original full200 timeout
remains recorded. Only this browser spec's transport and the I/O verification
receipt change; no manual Update AI assets run is required.


Full200 completed WebKit MP3 observation (verification follow-through, zero
count): the ordinary stereo import/play/reload case fails in10.709 seconds
because Pause is absent within the original5000 ms assertion. The imported
recording and its positive stereo PCM checks complete first. The actual PNG and
context publish the canonical refusal: “The streamed and buffered sources missed
their shared playback start.” This is the same start-admission observation
previously recorded for full100 FLAC, Ogg and Play-at-Speed; those unchanged
focused workflows passed without source correction. The completed MP3
JSON/context/PNG were read and the exact owned diagnostic directory immediately
removed. Preserve the original full200 failure. No codec, deadline or product
cause is inferred; unchanged whole WebKit replay awaits the coordinated native
slot, retaining all import/stereo/play/save/reload checks.
The complete unchanged WebKit MP3 workflow passes on authenticated a3a36854d
in6.9 seconds (one case,8.9 seconds total), with the qualified Pulse sink,
one worker and the coordinated exclusive4–7 CPU slot. Exact stereo positive/
negative PCM checks, Play→Pause within5000 ms, Stop, durable save, reload,
restored clip/identical source peaks and empty client errors all pass. No source,
fixture, assertion, deadline or count changes are needed; the original full200
shared-start refusal remains recorded. Completed owned replay output/log are
read and removed immediately, and its native readers and CPU slot close.


Full200 completed WebKit retained-video-span observation (verification only,
zero count): the ordinary frame12 Trim left→Move to Project bin→Play workflow
fails in15.948 seconds because its first-playing-time poll returns0 rather than
at least0.39 seconds within the original5000 ms assertion. This value reads a
playing-event observation attribute through Number; an absent attribute also
becomes0, so the failure does not itself prove native currentTime was reset.
The actual context/PNG show the imported trimmed WEBM bin card,0.5-second
retained span and black preview with Play still available. Exact completed
JSON/context/PNG were read and its owned diagnostic directory immediately
removed. Preserve the original full-suite failure; unchanged whole WebKit
replay and the native metadata/play readiness review are pending without
source, fixture, deadline or count changes.
The whole unchanged WebKit frame12 workflow passes on authenticated a3a36854d
in11.3 seconds (one case,13.5 seconds total), with the qualified Pulse sink,
one worker and coordinated exclusive4–7 CPU slot. Ordinary import, authored
frame12 trim, Move to Project bin, native Play and first-playing source-time
at least0.39 seconds all pass within the original5000 ms predicate. Source,
fixture, assertions and deadlines remain unchanged; no product cause or added
count is established. Completed owned replay output/log are read and immediately
removed, with all native readers and the CPU slot released to the dialogs lane.
The original full200 failure remains recorded.


Full200 completed WebKit multicamera-attribution observation (verification
follow-through, zero count): the ordinary two-camera workflow reaches initial
camera-a attribution and successful Create group/Switch camera, then its
unchanged30000 ms case deadline expires at the final pre-attribution saved-state
assertion (30.696 seconds). The exact marker records “saving” rather than
“saved”; the5000 ms expectation is interrupted by the global case deadline.
The actual context publishes Saving project and the PNG retains the authored
camera-a output clip. The switched-source attribution, CSV and reload checks
have not yet run; no incorrect attribution or storage cause is demonstrated.
The completed JSON/context/PNG were read and the exact owned diagnostic
directory immediately removed. Preserve the original full200 timeout;
unchanged whole WebKit replay is pending, without source, fixture, deadline or
count changes.
The complete unchanged attribution WebKit replay also expires at the original
30-second whole-case deadline (30.2 seconds), but proceeds further: saving,
actual switched camera-b attribution and actual CSV source assertions all pass,
then reload is interrupted with Loading editor files at0% and no editor node.
The repeat JSON-equivalent focused log/context/PNG were read and immediately
removed with the owned replay output. This remains an unresolved full-workflow
timeout, not a passing replay or proof of an attribution/storage cause. No
source, fixture, individual assertion or deadline changes are made.

Full200 completed WebKit switched-camera OTIO observation (verification only,
zero count): the original global30000 ms deadline expires at the saved-state
assertion (31.811 seconds), receiving saving rather than saved after ordinary
camera import, Create group and Switch success controls. The5000 ms expectation
is interrupted by that global deadline, before the native OTIO download and its
source ID, source URL and delivery-disclosure assertions are reached. Actual
context says Saving project; its PNG retains the authored camera-a output clip.
The exact completed marker/context/PNG were read and its owned original
diagnostic directory immediately removed. Preserve the full-suite timeout;
whole unchanged healthy/switched WebKit OTIO replays are pending, without
source, fixture, deadline or count changes.
Both entire unchanged WebKit OTIO workflows pass on authenticated a3a36854d
with the coordinated exclusive4–7 CPU slot, one worker and qualified Pulse:
healthy camera22.2 seconds and switched camera28.2 seconds (2/2 in53.5 seconds).
All original30-second case and5000 ms assertion limits remain. Actual durable
save, downloaded native OTIO output, exact sequence duration25 fps, actual
camera source identity/storage URL and grouped/ungrouped delivery disclosure
all pass. The original interrupted saved-state observation remains recorded;
these passes alone do not establish its environmental or product cause.
Completed owned replay output/log are read and immediately removed. The
attribution whole-case timeout remains unresolved; passive stage timing review
will compare the original unchanged workflows with existing camera budgets.

IO043 shared HTML speech-player follow-through (zero count, correction pending):
authenticated guarded `2541ed646` default Speakers completes ordinary Generate →
Text to Speech → native Play in 2.9 seconds. The chosen-speaker case routes the
actual main AudioContext to its genuinely enumerated native device, generates
authenticated playable speech and advances the actual native audio player, then
causally fails in 2.7 seconds with an empty player sinkId instead of that chosen
device. Both actual device APIs remain native. Exact PNG/context were read;
completed owning output and bounded log are immediately removed. TTS and Guided
review share the same HTML preview component; this is conservative IO043 device
routing closure and adds no new count.
The mounted strict witness first fails all three default/selected/native-device
controls with no actual media routing calls. Correct shared context propagation
and serialize native allocations on the owned audio element; native Play controls
wait for the latest chosen speaker, while existing gain, paused state, position
and player identity remain intact. Pending retired allocations cannot publish.
New initial/live/delayed/retired controls plus prior TTS/Guided gain controls pass
7/7. Target type-aware lint and canonical lint:changed pass, including the exact
final strict fixture. Complete corrected native-menu workflows await next guard.
No assistance runtime closure or generated assets change.
Both complete unchanged native Chromium workflows pass on authenticated guarded
cb40131e6: default speaker3.5 and selected speaker3.6 seconds (2/2in9.2 seconds),
retaining actual generated-media time advance and actual native HTML sink identity.
Completed own output/log are read and immediately removed. This closes shared
TTS/Guided output routing within IO043 and adds zero count.

Full150 Firefox follow-through observations (zero count, unchanged replay pending):
two native microphone-monitor cases fail before their listening-mute assertions
at the five-second graph observer, which reports [1, 1] instead of [1]. Positive
native capture frames and >0.05 recorded PCM already pass; the exact contexts
and PNGs show active Recording setup with Stop and import. Frozen full-run
markers preserve 11.813/11.740-second failures. The scheduled keyboard seek=false
case passes ordinary Schedule, fixed armed zero and Cancel, then post-cancel End
still observes zero instead of >30000 at its unchanged five-second deadline
(10.074 seconds). Its read PNG/context show the original imported clip and a
Scheduled status. No new production root is established by these observations;
all three exact completed original diagnostic directories were immediately
removed after this receipt. Whole unchanged Firefox replays on authenticated guarded `2541ed646` reproduce
all three observations: microphone graph cases 10.6/10.5 seconds retain [1, 1],
and post-Cancel keyboard recovery 10.2 seconds retains zero. Their exact reviewed
PNG/context show active native capture and Scheduled recording cancelled,
respectively. Preserve these unresolved full-run observations; no deadline or
source change is claimed. Completed replay output and bounded log are immediately
removed while the actual retired graph and keyboard owners are investigated.
The microphone discrepancy is the real Firefox channel-count probe, which creates
a monitor:false recorder, then disconnects its temporary node in finally. The
passive graph observer had retained that disconnected edge forever. Record exact
native connection triples without duplicates and retire successful native
disconnect overloads; keep every existing positive PCM, [1]/[0]/[1] live gain,
Stop/import and durable Bin assertion. Both complete unchanged-product Firefox
workflows then pass 7.9/7.3 seconds on guarded `2541ed646` (2/2 in 17.6 seconds).
This corrects verification only and adds no production source or count.
Owned completed isolated output and log are immediately removed.
All-engine observer controls on the same guard pass Chromium 5.3/5.7 seconds and
Firefox 8.8/8.9 seconds. WebKit stops both cases at the Camera checkbox before
Preview/capture in 30.2 seconds; its read PNG explicitly says Capture is unavailable
in this runtime. This unsupported prerequisite observation is retained, rather
than reporting an audio graph result. All six completed outputs and bounded log
are removed immediately after reading the exact failed PNG/context.


Full150 completed Firefox follow-through observations (zero count): both Web VCR
preview cases time out before the Web VCR menu item exists (30.130/30.238 seconds),
so no audio assertions run. Read PNG/context show ordinary Capture options with
Recording setup and inactive Start/Pause/Stop, without Web VCR. Existing packaged
Web VCR witnesses explicitly require Chromium MediaStreamTrackProcessor support;
this fixture omitted that existing prerequisite. The desktop project-library
whole workflow instead reaches deletion, then retains Delete this project? over
an already replaced Untitled project (16.023 seconds), matching the corrected
D036 handoff owner. Preserve all original full-run failures; exact reviewed PNGs,
contexts and all three completed diagnostic directories are removed immediately.
On guarded2541, all supported whole prerequisite controls pass: native monitor
Chromium5.1/5.4 and Firefox7.7/7.8 seconds, Web VCR Chromium3.0/3.1 seconds.
The Web VCR fixture now declares the existing packaged Chromium prerequisite,
retaining all audible PCM/local-mute/Playback-volume/release assertions. Native
WebKit exposes getDisplayMedia but still publishes Capture is unavailable; that
alone did not establish supported capture. Its exact read setup failures are
preserved. Restrict the skip to WebKit's actual canonical unavailable status;
a separate unchanged-product native WebKit replay verifies both unsupported
prerequisites as skips. No deadline or captured-media assertions change.
Target lint passes; all completed own proof logs/output are immediately removed.
The unchanged whole Firefox project-library workflow passes9.4 seconds on
authenticated guardedcb40131e6. Its original modal-handoff failure remains in
the full150 receipt; reviewed completed replay output/log are immediately removed.

IO045 independently qualified bus-origin parser: normal two-group
bus authoring through Mixer, Routing graph and Connection inspector produces an
audibly quieter Group1→Group2 programme, and its actual own DAWproject archive
correctly names the downstream channel. Reopen that unchanged archive: the
Group1 route instead returns to Master and decoded exported WAV becomes
2.703958207 times louder. Guarded2541 healthy direct-Master control passes in
6.0 seconds, downstream case causally fails in 7.3 seconds (2 cases15.1 seconds).
Read actual PNG/context and immediately remove bounded log/output; each actual
archive/WAV download is deleted immediately after reading its bytes. Strict own
normal command/writer/reader/product witnesses likewise pass the direct-Master
control and fail the downstream bus, with unchanged input. The strict matrix retains two independently failing group/send origins and their
healthy direct-Master controls. Corrected focused import, native promotion, bus
sends and earlier folder/strip/master-width controls pass51/51in2.7 seconds. One
initial support invocation used Node strip-only against an existing archive class
with a TypeScript parameter property, and is excluded as runner setup; the normal
--import tsx runner passes all51. Target type-aware lint and canonical lint:changed pass. The shared
routing-context type requires the coordinated full repository lint. This independent
parser owner skipped every bus-origin route; writer-only R3IO018 and
validated-decoder product promotion R3IO021 remain different repaired owners.
Both unchanged complete public workflows pass on authenticated guarded5dd339942:
healthy direct master5.7 seconds and restored downstream group7.1 seconds
(2/2in14.5 seconds), with the actual decoded delivered PCM comparison intact.
All completed own output/log are consumed and immediately removed.

Full150 completed Firefox Framescaper capture follow-through (zero count):
recording-origin protection completes actual capture/Stop before confirmed
Delete remains visible on the replaced project (17.312 seconds). Deleting an
unrelated project during ongoing capture likewise leaves the confirmation over
the new project (41.053 seconds, existing30-second assertion). Both exact read
PNG/context show that modal over the resulting project and match correctedD036;
no new capture root is inferred. Reviewed completed original directories are
removed immediately. Both complete unchanged Firefox workflows pass on guarded
cb40131e6: protected recording origin10.6 seconds, other-project deletion7.2
seconds; together with desktop library all3PASSin29.9 seconds. This closes the
original D036 follow-through without any fixture/deadline/count changes. Reviewed
completed own replay output/log are immediately removed.

IO046 causal ordinary-camera baseline (not counted; baseline source unchanged): authored
ordinary QuickTime48kHz LPCM output preserves the maintained H264 video packets,
with unmodified MediaBunny PCM encoding. Real native48kHz decoding verifies both
3kHz and23kHz source bands above0.19 before importing through the ordinary picker.
On authenticated guardedcb40131e6, normal FileImport publishes two clips and
actual WAV export retains the3kHz control (PASS3.0 seconds). The same normal
48kHz project/output loses the23kHz recording band (amplitude0.00000158355694,
expected>0.13, causalRED2.8 seconds; pair7.6 seconds). Read exact PNG/context show
successful ordinary camera video/audio delivery; no native decoder, context,
application state or device API is replaced. Source-import supplies no target
sampleRate to native decoding and thus passes through the default44.1kHz context
before converting again to48kHz. This independent caller clock differs from
R5IO008 picture-relative audio timestamps and IO042 Freesound conversion. Media
is generated in memory, actual WAV download is deleted immediately after reading,
and all completed baseline output/log are consumed and removed immediately.
IO046 correction: pin the video's native
decode to the current project's sample rate through the already supported
engine option. The private import port now faithfully names that optional
option. Existing unpinned callers and browsers unable to decode offline retain
their native fallback. Strict normal importer witnesses use the actual engine:
the differing44.1kHz device causally emits/materializes44100 instead of48000,
while a matching device and unavailable-offline fallback both pass. Corrected
native decode/import/timing/publication controls pass48/48in1.2 seconds.
Target type-aware lint, canonical lint:changed and diff checks pass. Bounded completed focused logs are
read and removed immediately; no media fixtures are retained.
Both unchanged complete native source/import/actual exported WAV band controls
pass on authenticated guardedfee8bdbd4a656b99d63fe5a7a0856e6df190ec0b:
3kHz healthy3.6 seconds and23kHz preserved3.0 seconds (2/2in9.2 seconds).
Actual original and delivered48kHz clocks and programme amplitude assertions
remain unchanged. This qualifies one independent video-import clock root;
completed own diagnostics/output/log are consumed and immediately removed.

IO047 ordinary shortcut baseline (not counted; before correction): public
Preferences→Keyboard shortcuts→Play at speed→AssignCtrl+Alt+P exposes the
maintained local command directly. Authenticated guarded5dd339942 ordinary
1.25× toolbar start retires an actual audible Bin recording and supports replay
(healthyPASS3.7 seconds). The configured normal shortcut starts actual audible
timeline PCM while the independently advancing Bin output remains audible at
peak0.247486174 instead of<0.001 (causalRED8.4 seconds; pair13.8 seconds).
Actual main Pause-at-speed and positive independent main PCM pass before that
failure; PNG/context show both active transports. The fixed menu has no direct
Play-at-speed item, so its internal workspace action alone is excluded as a
user path. The configured shortcut is authored entirely through the ordinary
Preferences UI; native audio nodes/context/device APIs are unchanged apart
from a passive forwarding analyser. Every completed own diagnostic and bounded
log is read and removed immediately.

IO047 correction: the direct Play-at-speed
transport now awaits the same owned Bin retirement as ordinary Play, and checks
its request generation after that asynchronous handoff. Stop during retirement
cannot start the old timeline request. The actual transport service has two
causal focused failures before correction: Bin retirement is omitted, and Stop
still permits one timeline start. The corrected witnesses and existing
transport, Bin ownership, Bin service and document controls pass39/39 in1.644
seconds. Target type-aware lint and canonical lint:changed pass. These small
verification logs are consumed and immediately removed. Both unchanged complete
native public workflows pass on authenticated guarded capture
ac91f0f78bbc577265eff4ceba323a8a78bb74b7: toolbar3.9 seconds and configured
shortcut3.8 seconds, pair2/2 in9.4 seconds. Independent timeline PCM stays
audible, the actual Bin output retires to silence, its Play control returns,
and Stop followed by Bin replay restores its audible output. The completed own
output directory and log are read and immediately removed. This qualifies one
independent direct transport handoff root.

IO048 first Take/Bin proof attempt is excluded as setup: both normal recorded
Take cases stop during the second File Import, before any audition handoff.
Actual status remains Recording instead of import success (healthy26.5 seconds;
Bin also fails setup). Both completed native screenshots/context and bounded log
were read and immediately removed. No source fix or additional root is claimed.

IO048 corrected ordinary baseline (not counted; before correction): stage an
ordinary8-second recording in Bin, import a2-second loop, Record loop into
takes, Stop, and positively observe Saved and inactive capture. Open the
recorded track's Take lanes and comps and Audition. On authenticated ac91,
ordinary timeline playback retires to silence, followed by Close and Bin
replay controls (healthy6.7 seconds). Starting from Bin instead starts positive
independent Take PCM but leaves the Bin output audible at0.247486174 instead
of<0.001 (causal11.7 seconds; pair20.2 seconds). Actual native screenshot/context
show the recorded take and concurrent Bin owner. All completed own baseline
output and bounded log are read and immediately removed. The independently
implemented Take owner stops only the main engine; this is separate from the
direct Play-at-speed owner IO047.

IO048 correction (qualification held for complete corrected public): hand the
existing owned Bin retirement into the Take composition and await it before
allocating or starting the isolated preview. Validate the owning request and
project after retirement, preserving synchronous healthy callers. Three actual
preview witnesses with ordinary durably produced take groups causally start
PCM before asynchronous retirement; the synchronous control passes. Corrected
retirement, cancellation, failure, exact source isolation and existing
Take/comp/Bin ownership controls pass40/40in2.993 seconds. The initial
cancellation assertion used lowercase text against the actual AbortError and
is corrected to the exact error identity, with no production change. Target
type-aware lint and canonical lint:changed pass. Both complete native public workflows retain prior
PCM assertions and now also verify positive recovered Bin PCM and final silence.
No new helper/source module is added. All completed focused proof logs are
consumed and immediately removed.

Full150 completed WebKit follow-through review (zero count; replays pending):
R6 multicamera attribution times out30.612 seconds while native project
activation publishes ready=false; it never reaches attribution. Its actual
screenshot is an ordinary loaded camera timeline with an empty preview. Native
plug-in restored controls fails11.955 seconds at Store default state counter2
versus10; actual screenshot reports The active project changed during the
native plug-in operation, shows Gain0 and disables Restore stored state. This
is before the restoration assertion, and is not classified as a new source
root. Both actual PNG/context and completed full150 JSON observations are read
and immediately removed from their exact failed directories. The shared full
failure log remains owned by root.

IO048 complete corrected native workflows pass on authenticated guarded
8d4cef165: timeline7.0 seconds and Bin7.0 seconds (2/2in15.7 seconds). Actual
Take PCM starts only after the previous output is silent; Close stops it, Bin
replay produces positive native PCM, and its Pause restores complete silence.
These ordinary routes and all original deadlines remain unchanged. One
independent Take transport handoff root is qualified; completed own browser
output and bounded log are consumed and immediately removed.

The exact unchanged multicamera-attribution and installed plug-in restored
controls workflows both pass WebKit against authenticated guarded8d4cef165
(17.3/4.8 seconds;2/2in24.1 seconds), including actual selected-camera credit,
stored host Gain0, visible restored Gain0 and subsequent host edit. No
assertions, deadlines or fixture/source bytes change for these replays. Their
original full150 failures remain recorded above; this isolated zero-count
follow-through is not an aggregate full-suite pass. Completed own replay
output and bounded log are read and immediately removed.

Full150 seven further completed WebKit failures reviewed (zero count; unchanged
whole replay pending): two archive cancellation cases fail7.676/7.500 seconds
before Export because the native storage observer is undefined; their actual
Export dialogs are idle. Frozen Bin replacement fails22.177 seconds at its
private data locator, while the actual screenshot positively shows Replacement
file is shorter and both ordinary spacing choices. Multicamera retention
times out31.119 seconds while opening Tracks, before Remove; its screenshot
shows the ordinary first camera timeline. DAWproject999 BPM fails11.918 seconds
before download at disabled Export DAWproject, with all File actions disabled
and an empty timeline. Both Freesound uploads fail6.417/7.446 seconds reading
subarray from the passive request observer's null body; the actual screenshots
show Ready to publish rows for the ordinary ungrouped and folder-owned clips.
These are preserved full-run observations without inferred source causes or
new counts. All seven actual PNG/context and completed JSON markers are read;
their exact directories are immediately removed.

Exact unchanged WebKit replay on authenticated8d4cef165 completes9 workflows:
multicamera retained angle15.1 seconds, continuous/frozen replacement13.1/15.7
seconds, and DAWproject999/1000 BPM4.9/4.6 seconds all pass. Archive write/close
3.6/3.9 seconds still stop at undefined native observer before Export, and
Freesound ungrouped/folder3.1/3.6 seconds still stop at null passive request
body after actual Ready to publish. The latter four completed replay PNG/context
were read and show the same native idle/Ready controls, without a source root.
All own replay output and bounded log are immediately removed. Original full150
failures remain recorded; capability/physical-request witness follow-through is
zero count and must retain every actual media/control assertion.

Full150 six further completed WebKit observations consumed (zero count):
scheduled keyboard seek=false/true11.420/11.697 seconds reach the final
post-cancel capture and observe one clip instead of two; the actual PNG shows
Done and the ordinary recorded Audio clip on the original imported track,
consistent with the already reviewed destructive-recording fixture. Both
microphone listening cases30.172/30.247 seconds stop at a missing Camera
checkbox, and Web VCR30.238/30.260 seconds stops at its absent menu. All four
actual screenshots and contexts explicitly publish Capture is unavailable in
this runtime; the existing actual-capability prerequisite witness applies.
Every completed JSON marker, PNG and context was read and these exact six
failed directories were removed immediately. Their original full-suite
failures remain recorded; current faithful follow-through is pending.

A provisional zero-count Freesound request-receiver verification attempt fails
before navigation because it calls an unavailable Playwright cleanup API
(testInfo.onTestFinished); both blank-page PNG/context and bounded log were
read. This excluded fixture setup establishes no product behavior. Cleanup is
being changed to ordinary awaited finally ownership. The two native ZIP cases
truthfully skip when writable-stream capabilities are absent. Completed own
attempt artifacts and log are immediately removed.

The next provisional native loopback-receiver attempt is also excluded:
Both WebKit uploads reach Upload failed with Load failed after the
service-origin rewrite, whereas the unchanged service fixture had reached
Ready to publish. Both actual PNG/context are read. The fixture will passively
copy the actual File body at the native fetch boundary and forward the unchanged
request, retaining exact RIFF/size and all original media/control assertions.
Own completed diagnostics and bounded log are immediately removed.

Faithful WebKit whole follow-through on authenticated8d4cef165 passes the
actual File/native-fetch upload witnesses (ungrouped3.1/folder3.8 seconds),
both scheduled/cancel keyboard cases7.3/6.9 seconds, and all three programme
selection/navigation cases6.8/7.1/7.3 seconds. Every original media/control
assertion and deadline remains. Six cases truthfully skip absent native
capabilities (ZIP writable streams2, Recording setup capture2, Web VCR2).
The complete13-case run is7PASS/6SKIP in54.9 seconds; the original full150
failures remain preserved. Completed own output and bounded log are read and
removed immediately. Chromium/Firefox actual ZIP write/close and upload byte controls subsequently
pass8/8 in27.8 seconds on the same guard: Chromium3.0/3.0/2.1/2.4 seconds
and Firefox4.5/3.7/2.9/3.4 seconds. Actual cancellation cleanup, complete
unchanged native fetch File bodies, Ready to publish and retained clip/folder
state all pass. Target lint passes; owned output/log are read and removed
immediately. These two witness corrections add zero product roots.

Full150 final completed WebKit capture observations consumed (zero count):
the origin-deletion case20.061 seconds and other-project deletion40.397 seconds
both complete the actual recording workflow and leave Delete this project?
visible after its successful project handoff. Both exact JSON errors, contexts
and PNGs were read; the screenshots show the replacement project underneath the
old confirmation. This matches the already repaired D036 handoff lifetime,
whose whole unchanged current replays passed in Chromium and Firefox. Original
full-suite failures remain recorded. Both unchanged whole WebKit workflows pass
on authenticated dd877d8a8 (origin9.0/other-project5.3 seconds,2/2 in16.0
seconds), retaining actual capture, refusal, deletion and media assertions.
Only these exact completed failure directories were removed immediately. No
other completed import/export/capture diagnostic remains unconsumed by this lane.

The strict Node witnesses use ordinary media generated in memory and ordinary
authored project data. They call the normal product commands, import recorder,
native File Open service or mounted controls; they do not introduce a private
application action or adversarial media.
IO044 strict-fixture follow-through (zero count): the complete tests/tooling
compiler found only the optional cache cleanup invocation in its actual
controller resource witness. Assert the real cache cleanup capability before
calling it, preserving the owned disposal rather than widening a production
type. The bounded compiler error log was read and removed immediately.
IO049 independently implemented MixerFader completion (qualified):
Soundscaper imports an ordinary WAV and opens Window → Mixer. A healthy Master
Volume drag, Undo, Redo and retained recording pass. Repeat the drag, hold middle
and release primary; the passive actual native pointermove confirms button0 and
buttons4. Keyboard Undo before middle release removes the imported recording
(zero clips instead of one), leaving Master at−10 dB and Undo disabled. The
complete unchanged causal Chromium baseline is6.8 seconds on authenticated
2b94fdc97. Its exact PNG/context and bounded native log were read and removed
immediately. Strict actual mounted middle/right-held completion cases causally
fail2/7 while foreign, touch, pen, auxiliary-release and intentional owning
cancellation controls pass5/7. This terminal completion owner is separate from
D058's rejection of foreign pointer termination, the generic Knob and Slider
completion owners and the application parameter transaction binding. All fader
consumers/button variants remain one root.
The correction recognizes only that owning mouse primary-release transition and
completes the existing final-coordinate callbacks once after retiring its capture.
Later auxiliary motion/release cannot recommit; foreign admission, touch/pen and
intentional cancellation retain their prior behavior. All23 completion, final
coordinates, subsequent gesture, foreign ownership, keyboard and parameter
transaction/automation controls pass in0.592 seconds. Narrow strict compilation,
target type-aware lint, canonical changed-file lint and owned whitespace checks
pass. The source remains268 lines. Completed focused logs and the temporary
compiler configuration are consumed and immediately removed. The unchanged
complete native workflow passes Chromium on authenticated coherent a3a36854d
in2.1 seconds (one case,3.6 seconds total). Healthy Master Volume completion,
Undo/Redo, actual primary-release button0/buttons4, keyboard Undo before middle
release, later auxiliary motion/release, Redo and retained imported recording
all pass. Completed owned output/log are read and immediately removed. This
qualifies one independently implemented MixerFader terminal owner, bringing the
I/O count to48.
Forty-eight qualifying I/O roots are fixed; the excluded int32 candidate adds no count.
No large verification files or runtime archives were generated. These changes do
not require a manual **Update AI assets** run.

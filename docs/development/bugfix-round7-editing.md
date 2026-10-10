# Round seven editing audit

Only distinct causal roots on existing ordinary user paths count. Setup errors,
unreachable internal APIs, intentionally unsupported formats, and sibling
symptoms are excluded. Temporary verification output is removed after recording
the result here; permanent regression tests remain.

| ID | Ordinary user path | Root and correction | Focused evidence |
| --- | --- | --- | --- |
| R7-EDIT-001 | Import two recordings, draw an off-grid time range, enable Snap, focus the first track row and Shift+Down. Alternatively select a recording's header before extending its track scope. | The track-scope adapter rebuilds a range from collapsed stored clip coordinates and reapplies the snap grid; selection becomes zero. Resolve the effective selection, adjust only track scope with snapping disabled, and retain the independent playhead. Both symptoms count once. | Two actual-controller causal RED cases: 0 vs 9,600 start and 0 vs 38,400 end. Corrected new and existing focused Node checks: 6/6 PASS. Public Chromium causal RED: both workflows reset to zero; corrected complete workflows plus the existing keyboard track regression: 3/3 PASS, 11.4 s. Verified. |
| R7-EDIT-002 | Preferences: assign Ctrl+Alt+Up to New label track. Create sibling folders, focus the later folder and press the assigned chord. | The folder tree treats modified arrows as its own navigation/movement before the workspace dispatcher. Release Ctrl/Meta and already handled keys while retaining plain tree navigation and ordinary Alt movement. | Three mounted production-handler causal RED modifier cases consume the event; corrected mounted and folder-model checks: 9/9 PASS. Public Chromium causal RED: zero label tracks. Corrected plain navigation, configured command and Undo/Redo workflow PASS. |
| R7-EDIT-003 | Move a track into a folder, F2 to rename it, type a draft and right-click the text field to use its native text menu. | The row's context-menu handler captures events from its rename input and opens folder actions, interfering with text editing. Release editable descendants to their native context menu while retaining folder actions on the row. | Mounted production-handler causal RED: prevention count 1 vs 0. Corrected mounted/name-composition/rename checks: 5/5 PASS. Public Chromium causal RED: folder menu opens while editing. Corrected text-menu, unchanged draft, rename and Undo workflow PASS. |
| R7-EDIT-004 | Import an ordinary recording, select its header, Ctrl+B to add a label, finish the title, F2 to edit it and right-click the draft. | The independently implemented native label marker captures its title input's context menu, opens label actions and selects the label. Release editable descendants while retaining the marker's own context menu. | Mounted production-handler causal RED: prevention count 1 vs 0; corrected title/context and existing composition/lock checks pass 6/6. Public Chromium causal RED: label actions appear instead of retaining text editing. Corrected native text editing, rename, Undo and ordinary marker context menu PASS on immutable 220719574. |
| R7-EDIT-005 | Import a recording, select its header, enable Snap and focus Playhead. Press Ctrl+Right to move the selected clip through global command dispatch. Alternatively drag a recording off the grid, enable Snap and use Ctrl+Up from Playhead to move it to the previous track. | This independent global item-placement adapter requests a small sample delta that snaps back to the same grid cell; its vertical branch also resnaps an unchanged horizontal position. Share the existing directional grid step with the header owner and explicitly preserve time during vertical moves. Both adapter branches count once, independently from R3-EDIT-024's header callback. | Two actual-controller causal RED cases: zero instead of 48,000 for horizontal movement and zero instead of 12,000 for vertical placement. New and existing item/grid/native geometry regressions pass 16/16. Public Chromium horizontal causal RED: unchanged 12-pixel placement; vertical causal RED also reproduced. Corrected public workflows pending. |
| R7-EDIT-006 | Import an ordinary one-minute recording, switch to Music workspace, set 6/8, choose Beats & measures on the ruler and use View → Zoom → Zoom out. | The map-aware ruler marks every bar as labelled regardless of available pixels, unlike the ordinary fixed-meter ruler. At the lowest ordinary zoom, actual glyphs overlap. Choose globally aligned power-of-two bar intervals for readable labels and visible ticks, retaining exact native bar/pulse frames and shared grid projection. | Three owning viewport-model causal RED cases show labels 9, 22.5 and 45 pixels apart while the zoomed-in control passes. Public Chromium first confirms readable 6/8 labels, then actual canvas text overlaps: next label starts at 21.6 while its predecessor ends at 22.116. Corrected new/owning/map/grid/canvas checks pass 20/20. Old dense-count performance fixtures now assert visible density and the unchanged timing bound. Corrected public workflow pending. |

The potential stale session-folder creation candidate is excluded: the only
published New folder entry supplies an explicit surviving parent. The suspect
default-parent internal call is unreachable through that menu.

Native image boundary resizing in `applyAudacityItemNavigationAction` is also
excluded: published Extend/Contract commands call the selection controller
directly, and only item movement reaches this helper. Its failing internal
image trim tests and browser verification files were removed without a source
change or count.

The unchanged EDIT005 horizontal and vertical placement/history workflows pass
on prepared Chromium capture `5c9787bec` (2.4 seconds each); EDIT006's complete
compound-meter control and readable zoomed-out labels pass in 3.6 seconds. The
whole accompanying corrected batch passes 21/21.

| ID | Ordinary user path | Root and correction | Focused evidence |
| --- | --- | --- | --- |
| R7-EDIT-007 | Add a Send track, assign Ctrl+Alt+Tab to New label track in Preferences, focus the output header and use the assigned command after ordinary Tab traversal. | The independent output-header capture handler consumes every Tab before the workspace dispatcher, even when modified or already handled. Release claimed and modified keys before its existing local traversal. This is distinct from R5-EDIT-025's output-lane handler. | Four actual mounted capture cases causally RED with prevention/traversal instead of no consumption; ordinary Tab/Shift+Tab control passes. Corrected output-header/lane/name/composition regressions pass 16/16. Public Chromium first completes plain Tab traversal, then causally RED at zero label tracks after the assigned command. Corrected public workflow pending. |
| R7-EDIT-008 | Import an ordinary two-minute recording, choose Beats & measures in its source ruler, then author 960 BPM followed by 30 BPM at beat 40 through Musical timeline. | The independent source ruler chooses label stride from average bar count and viewport width. A tempo change clusters those chosen bars in sample space. Admit labels by their actual projected distance while preserving exact native frames and musical origins. | Constant-tempo control passes, but the owning model causally RED shows labels only 3.75 pixels apart. The public healthy source ruler passes before authoring the tempo change, then actual SVG labels overlap: next starts at 872.375 while its predecessor ends at 873. Corrected new and existing source-origin/signature regressions pass 7/7. Corrected public workflow pending. |
| R7-EDIT-009 | Import an ordinary stereo WAV, enable Spectrogram, choose Select → Spectral → Spectral brush and click the same frequency position halfway down each channel. | The spectral authoring surface treats both channels as one frequency axis. Forward actual display channel count/ratio, resolve the stroke in its originating channel and present the resulting band at the matching position in both channels. Keep one set of editing handles and existing mono/keyboard/pointer ownership. | Two actual mounted stereo cases causally RED at 18,000/20,400 Hz instead of the displayed 12,000 Hz; mono control passes. Public Chromium ordinary upper/lower clicks select centers 7,231.44 Hz apart. Corrected mounted/model/channel/cancellation/touch support passes 35/35. Corrected public workflow pending. |

Prepared Chromium capture `fef78921b` passes EDIT008's complete tempo-change
workflow in 4.7 seconds and EDIT009's upper/lower channel authoring and displayed
selection placement in 2.5 seconds.

EDIT007's first header correction exposed the same modified-Tab consumption
in its nested design-system panel under the published grouped navigation
profile. The complete public workflow remained RED at zero label tracks.
Four mounted panel-handler cases with that profile also causally RED at one
prevented event instead of zero. Release handled events and modified Tab in
that nested owner as well; panel/header/lane/name/composition and existing
vendor checks now pass 23/23. This follow-through adds no count. The shared
vendor file retains its previous line count. Corrected public proof is pending.

No assistance runtime closure or target inventory changes. No manual **Update
AI assets** run is required.

| ID | Ordinary user path | Root and correction | Focused evidence |
| --- | --- | --- | --- |
| R7-EDIT-010 | Framescaper: Generate → Add video still twice to create two picture tracks. Select the first image, focus Playhead and press Ctrl+Down, then Ctrl+Up. Generated Titles use the same published command. | The global vertical item dispatcher compares native image/still/generator clip kinds with track types. No track has those kinds, so it silently skips compatible picture destinations. Classify those visual leaves as video before finding the destination; retain the existing exact time-preserving move command. This destination search is independent from R3-EDIT-021's context menu and R4-EDIT-010's horizontal clock conversion. | Actual canonical image history and the published Title action/controller both causally RED at unchanged track ownership. The public horizontal move/Undo control passes, then Ctrl+Down causally RED at the original track instead of the next picture track on fef78921b (8.8 seconds). Corrected native clock, source identity, bidirectional movement, Undo/Redo and existing horizontal/grid/generator support pass 11/11; target lint passes. Initial Title test setup used the wrong runtime return field and is excluded. Corrected complete public proof pending. |

Complete repository lint passed all eight bounded shards during this wave.
Size checks pass for 11,078 maintained files. Later source additions receive
their own focused lint and will be included again in the checkpoint gates.

Prepared Chromium capture `e2a38ecb5` completes EDIT007's plain Tab, configured
shortcut and Undo/Redo workflow in 2.9 seconds, and EDIT010's horizontal
dispatch control, both picture-track directions and Undo/Redo in 4.7 seconds.
Both complete public regressions pass. The native Title regression's track
inventory uses the same validated-array narrowing as its existing controller
tests; focused checks and type-aware lint pass after that typing correction.

| ID | Ordinary user path | Root and correction | Focused evidence |
| --- | --- | --- | --- |
| R7-EDIT-011 | Framescaper: Generate → Add video still twice, place the image with the earlier source ID later with Ctrl+Right, and select the other image. In Preferences assign Next item and Previous item, then use those chords from Playhead. Normal generated Titles use the same published command. | Adjacent-item navigation sorts raw sample coordinates absent from native picture items, so it orders them by identity and can stay on the first chronological item. Project each authored clock to samples before the existing chronological/identity comparison. Retain ordinary edge clamping and selection ownership. | The actual Title-authoring controller causally RED returns the first item instead of the middle one despite native placements 0/30/60. Public e2a38ecb5 passes ordinary placement and assignment, then causally RED at unchanged earlier selection (8.9 seconds). Corrected new and existing item/selection/runtime support pass 20/20. Changed-file lint passes. The initial drag did not produce the required placement, and an initial search probe did not expose the command; both are excluded setup failures. Complete public retry pending. |
| R7-EDIT-012 | Import three ordinary recordings, assign Item below/above in Preferences, and complete their ordinary navigation. Move the middle track into a folder and collapse it; repeat the same commands from Playhead. | This independent global dispatcher selects raw project indices even when the folder projection suppresses their rows. Filter only rows hidden by a collapsed ancestor before global vertical, first/last and extending navigation. Ordinary expanded navigation remains unchanged. | Actual controller causal RED selects the suppressed middle track instead of the last. Public e2a38ecb5 completes healthy assigned navigation and folder suppression, then causally RED with the visible last row still unselected (8.2 seconds). Corrected actual controller and existing hierarchy/router/track-selection/runtime support pass 14/14. Initial assertions on the outer row instead of its selected lane are excluded setup errors. Complete public retry pending. |
| R7-EDIT-013 | Select an ordinary recording's header and assign Replace track selection through Preferences. Use the assigned chord from Playhead. Global range, toggle and extending commands have the same time-scope ownership. | The global track-scope adapter reads collapsed stored bounds and clears clip selection, or reapplies Snap to an existing off-grid range. Resolve the effective time span before changing only track IDs through the existing non-snapping adjustment. Retain the playhead and selection anchor. This owner is separate from the Select all tracks service and media-row callbacks. | Actual ordinary controller causally RED at 0 versus 9,600 start and at 0 versus 38,400 end. Public e2a38ecb5 completes the Select all tracks extent control, reselection and shortcut assignment, then causally RED at 0.000 instead of 0.800 seconds (7.4 seconds). Corrected clip/off-grid, replacement, toggle, range, extension and existing track/runtime support pass 12/12; target lint passes. Initial display assertions expected materialized bounds before a clip-derived range was materialized and are excluded; distinct memory database names prevent fixture state reuse. Complete public retry pending. |

The checkpoint build rejected the new navigation helpers with a bootstrap
import cycle. Load authored-clock ordering through the same deferred boundary
as existing item commands; its regression awaits the published handler.
Chunk diagnostics showed the two eager scope helpers were absorbed by the
selected product bootstrap rather than their importing domain. Place them
beside the existing domain adapters so the unchanged semantic ownership rule
claims them. These build corrections add no count and preserve the chunk
ownership rules and unchanged graph ceilings.

Prepared capture `58264ec46` completes EDIT011's assigned native item order
in 4.1 seconds, EDIT012's expanded/collapsed/restored track navigation in
3.4 seconds and EDIT013's effective recording extent in 2.4 seconds. All three
public regressions pass; the complete last-wave Chromium batch passes 9/9.

| ID | Ordinary user path | Root and correction | Focused evidence |
| --- | --- | --- | --- |
| R7-EDIT-014 | Framescaper: add two ordinary PNG pictures, move the second later with Ctrl+Right, and assign Next item in Preferences. Complete navigation from the selected first picture, choose Select → Select none, then use the assigned chord from Playhead. Soundscaper's assigned Item below reproduces the same family after Select → Select none and Select → Tracks → No tracks with two ordinary WAV recordings; entry includes the initial Timeline track. | The adjacent-item owner clamps a missing anchor to index zero before advancing, so entry after deselection skips the first picture or Timeline track. Enter the first ordered item when there is no anchor; retain ordinary adjacent navigation, explicit Last track and edge clamping. Track entry is follow-through within the same missing-anchor family and adds no count. This arithmetic is independent of EDIT011's authored-clock ordering. | The real Title-authoring controller passes selected-anchor navigation, then causally RED returns the second Title after deselection. Baseline prepared `48b7bf244` passes placement, shortcut assignment and selected-anchor controls, then causally RED skips the first picture (10.5 seconds) and Timeline track (8.6 seconds). Both actual-controller regressions and existing navigation, scope and module-ownership checks pass 36/36 after correction; `npm run lint:changed` passes. An initial Node fixture did not explicitly place its first Title and failed its healthy control; that setup failure is excluded. Corrected picture entry and complete Timeline → first recording entry pass on prepared `8ce3e9f98` in 6.4 and 3.5 seconds. Initial browser observers conflated the first recording with the preceding Timeline track and are excluded. |
| R7-EDIT-015 | Import an ordinary drum recording, choose Audio Warp and transients, set Grid interval to 12,000 samples and Quantize before creating an identity map. Close the dialog and Undo once. | First quantization commits its preparatory identity map separately from the resulting map, so one user action requires two Undos. Prepare and validate the initial map without publishing it, then commit only the final canonical map. Existing-map quantization retains its original command and history path. | The actual native project/history healthy existing-map control passes; first-map quantization causally RED leaves an identity map after one Undo. Public prepared `8ce3e9f98` completes manual identity-map Undo and ordinary quantization, then causally RED with Create identity map still disabled after one Undo (11.0 seconds). Corrected new and existing warp authoring, composition and chunk ownership checks pass 52/52, including atomic Undo/Redo and refused ordinary groove values without a preparatory map. Changed-file lint passes. The unchanged complete public Quantize/Undo/Redo workflow passes on prepared ee9b3f13c in 6.8 seconds; full source/test TypeScript and both guarded builds pass. |
| R7-EDIT-016 | Import an ordinary recording with an internal pause and an SRT sidecar whose two labels touch in that pause. Select all, then Edit → Labeled audio → Detach at silences. | Each label independently plans splits on the original clip. The later removal leaves the preceding label's split at the surviving clip's exact edge, so the whole action fails. Coalesce touching scan windows through the existing editing-range union before planning silence removal; authored labels retain their separate identities and gaps remain outside the scan. | Native project/history causal RED: A split must be inside the clip; the one-label control passes. Public prepared `8ce3e9f98` passes ordinary one-caption Split/Undo/Redo in 3.2 seconds, then two touching captions causally fail at one clip instead of two with that exact visible split error. Corrected new and existing clipboard, grouped detachment, label-region, labeled edit and warp-silence checks pass 43/43. An initial after-test hook used a nonexistent disposal method; that setup failure is excluded and the corrected healthy control passed before the source edit. Both unchanged public one-label and touching-label Split/Undo/Redo workflows pass on prepared ee9b3f13c in 2.8 and 2.9 seconds; full source/test TypeScript and both guarded builds pass. |

| R7-EDIT-017 | Import three ordinary recordings. Move the middle track into a folder and collapse it, select the first recording and press Ctrl+Down from Playhead. | The contextual item placement adapter searches raw project tracks and moves the recording into the hidden middle destination. Reuse the displayed hierarchy when finding compatible destinations, retaining exact time and the existing canonical move command. This placement owner is independent of EDIT012's track-selection navigation. | The actual controller and published action pass ordinary expanded movement and Undo, then causally RED place the recording in the hidden middle track instead of the visible last one. Public prepared ee9b3f13c completes those healthy controls and folder collapse, then causally RED loses the first recording from the displayed timeline (21.9 seconds). Corrected actual controller, existing directional, label, native picture, grid and folder support pass 13/13; the focused ownership group passes 36/36. Changed-file lint passes after an initial concurrent removal of an excluded temporary test interrupted its file inventory. Corrected complete public proof passes on prepared73b99f5b8 in 5.3 seconds, including displayed destinations and history. |
| R7-EDIT-018 | Import an ordinary six-channel recording with programme in channels 3–6 and silent channels 1–2. Draw a time range, enter sample boundaries 10007–30007, then Select → At zero crossings. The identical mono programme is the healthy control. | The mono selection aligns to 9990–29970, but the surround selection remains at 10007–30007 despite reporting success. The selection owner renders into the stereo programme output and drops the occupied channels before its linked-channel detector. Widen only the private capture when needed and use the existing isolated native track graph, retaining track processing and detector inputs while keeping programme metadata and output untouched. | Public frozen `ee9b3f13c` completes ordinary imports, both exact native time edits and the mono control, then causally RED at the unchanged surround edges in 5.5 seconds. A first attempt used disabled clip-selection time fields and is excluded; the corrected ordinary drawn-selection path completes. Actual native Tone/controller preparation independently passes mono/stereo and causally REDs at two output channels instead of six/32. A first Node fixture named a nonexistent action and is excluded; the actual timeline zeroCross action establishes the causal pair. Corrected native allocations, unchanged authored sources/output, selection/spectral/lifetime controls and existing isolated folder/sidechain support pass 37/37. Corrected public workflow awaits the next prepared build. |

Prepared73b99f5b8 passes EDIT017 in5.3 seconds and EDIT019's full Chromium
keyboard, Store state, endpoint and Restore state workflow in4.4 seconds.
The existing native state-barrier workflow also passes Firefox in9.3 seconds
after the fine keyboard correction. Its new Firefox keyboard workflow reaches
the corrected0.26 and0.25 host values, then exposes a brittle absolute
persistence count (9 versus2); the complete retry snapshots its actual prior
count while retaining exact restored parameter state. EDIT018 remains
unqualified: its corrected browser still returns10007–30007 instead of
9990–29970 in7.1 seconds despite the widened native allocation. Investigation
continues through the actual graph output; no second count is added.

EDIT018's passive native render diagnostic confirms the private capture
actually returns six channels: the first two silent, the remaining four at
0.3499755859375 peak. The prior browser assertion read the mono operation's
retained success message before the surround result was published. Awaiting
the original exact selection assertion preserves a genuine causal RED on
frozen48b7bf244 (10007–30007 versus9990–29970 after the unchanged five-second
poll,22.6seconds total), then passes on prepared73b99f5b8 in16.9seconds.
Its temporary copied baseline spec deletes itself immediately on completion;
the passive diagnostic code is removed. This is one fully qualified root.
EDIT019's next Firefox retry fails before any parameter editing at initial
host persistence0 versus1; it is another excluded setup failure. Its native
fine values and existing state-barrier public workflow remain positive.

The provisional EDIT019 is excluded after platform tracing: its fine-arrow
failure requires the desktop-host fixture in Firefox. Actual shipped native
plug-ins run in Electron Chromium, where the same ordinary keyboard control
already passes. Remove its production handler and both unqualified regression
files. The generic state-barrier fixture now accepts the browser's healthy
native arrow value and still verifies actual state capture, delayed final drag,
reset and restored position. No user bug count was ever assigned to019.

## R7-EDIT-020 — Skip reads unresolved selected visual geometry

Framescaper: Generate → Video Generators → Add Title/Text, select its header,
Select → Region → Track start to end, then View → Skip to → Selection end.
This healthy control reaches00:00:05:00. Select none, return Playhead to Home,
select the same Title header and use Selection end again. The enabled action
stays at00:00:00:00 because its independent Skip owner reads raw sample fields
absent from the saved native Title. R4-EDIT-008 repaired the separately owned
track-content range producer; that healthy producer already passes here.

Resolve exact selected identities through existing editing authority, then
reuse the existing native/musical content-range reader for their edges.
Keep drawn ranges authoritative, expand existing groups and A/V relationships,
retain disjoint selected spans, and preserve project/selection/history state.
Frozen guarded wave82 reaches the causal public failure in13.8 seconds after
the healthy range, Home and selected-header assertions. Its actual generated
Title controller likewise reaches null instead of48000 after the healthy
drawn-range control. Corrected native NTSC, musical and existing selection
support passes33/33. An initial generic runtime-project projection cannot
admit native generator records; it is discarded after its focused refusal,
before any corrected build. Corrected complete public proof is pending.
Reviewed causal diagnostics and logs are removed immediately. No manual
**Update AI assets** run is required.

Guarded capture24cbd04c0 passes EDIT020's unchanged complete public Title
workflow in6.7 seconds. The complete strict compiler identifies two narrow
new typing errors: the unresolved clip interface is broader than selection
identity authority, and the existing controller's static clip union omits
native generators. Pass only validated string relationship identities into
the existing identity authority and use its established native record view
in the fixture. Focused behavior remains33/33, ownership/navigation audits
pass45/45, targeted and changed lint pass, and the complete test/tooling strict
compiler then passes. The original byte-for-byte document, selection and
history assertions remain. EDIT020 is fully qualified;019 stays excluded.

## R7-EDIT-021 — Picture track sorting invokes disabled folder commands

Framescaper: Generate → Add Video Still for ordinary Zulu.png and Alpha.png,
select each header and rename its Images track to Zulu and Alpha, then Tracks
→ Sort tracks → Sort by name. Both renamed tracks remain in their original
order. The same menu sorts ordinary audio tracks and Undo/Redo restores them.
The unchanged public picture workflow fails after the sort in10.9 seconds;
the audio control passes in3.2 seconds. Actual generated Titles, separated by
the existing Move to new track action, reach the independent controller
failure: Framescaper does not support trackFolders. The planner generates
track-node/move even though this product deliberately disables folders.

Use the existing track/reorder command for this authenticated product, with
global track positions belonging to each sequence. Keep the current hierarchy
commands for Soundscaper folders, linked lanes, stable ties and lock admission.
Sort by name and time share this command owner and count as one root. The
initial two-Title fixture placed both on one track; that setup failure is
excluded, as are earlier public setup failures before valid renamed tracks.
Actual generated Title sorting by name and time, Undo/Redo, unchanged media,
folder/lane hierarchy and capability support passes31/31 focused tests.
Targeted lint and size/diff checks pass; corrected public verification is
pending. Reviewed causal logs,
screenshots and diagnostic contexts are deleted immediately. No manual
**Update AI assets** run is required.

Guarded exact678a672d0 completes EDIT021's original audio control in2.1 seconds
and native PNG sort/Undo/Redo workflow in5.4 seconds. EDIT020's unchanged
selected Title Skip likewise passes in4.5 seconds. Complete source and
test/tooling strict compilation pass after narrowing the test track's actual
clip-ID array. EDIT021 is fully qualified; both sorting criteria remain one
command-dispatch root. Reviewed verification logs and output are deleted.

## R7-EDIT-022 — Shared range reader drops native selected content

Framescaper: Generate → Video Generators → Add Title/Text. Select its header,
Select → Region → Track start to end, then Contract selection from right.
That healthy range is contracted. Select none, Home, select the same header
and invoke the same contraction. No time overlay is produced because the
shared range reader requires sample fields absent from native Title leaves.
The unchanged actual public control passes before causal failure at the
missing overlay in9.9 seconds on guarded678a672d0. The actual public-controller
Title fixture independently fails at0..0 instead of48000..287600; the All
tracks consumer likewise fails0..0 instead of48000..288000. All native-kind
consumers of this shared producer count once. EDIT020 repaired its independent
Skip consumer; R3-EDIT-006 repaired audio track-scope publication and
R4-EDIT-008 repaired the separate track-content producer. The initial public
All tracks spelling names no menu item and is excluded before its action.
Corrected menu spelling is replayed before source changes. A drawn region
has all-track scope; a selected clip retains its actual owner scope, so the
strict contraction oracle compares identical bounds and independently checks
the proper owner instead of requiring the healthy control's different scope.
Causal and setup diagnostics are read and deleted immediately. Correction
and completed public verification remain pending.

The corrected public All tracks menu spelling likewise passes the healthy
drawn-range control and causally loses all overlays in9.5 seconds. Reuse
the exact existing native/musical clip-content reader, extracted into its
common owning module, to provide selected clip geometry before shared editing
range resolution. Explicit drawn ranges stay authoritative, relationship
expansion and track ownership stay with existing authority, and raw media
records are not changed. Corrected focused verification is next.

Corrected actual native Title commands and existing range, boundary, linked
identity, navigation and track-scope support pass52/52 focused tests. Full
source strict compilation and targeted type-aware lint pass. The extracted
reader preserves its existing sequence-boundary and musical-clock logic;
selected persisted media/history stay byte-for-byte unchanged. Corrected
complete public proof remains pending and no count is assigned yet. No manual
**Update AI assets** run is required.

Authenticated guardeddb368adda completes the unchanged ordinary Title range
workflows: All tracks6.4 seconds and Contract selection5.9 seconds. EDIT022
is fully qualified. The subsequent helper-triggered full Node run detects
stale shield-register paths after the reader extraction; move the exact
owned boundary and native/musical exclusion to its common module and register
the range resolver's type-only importer. No audit rule or projection guard
is relaxed. This metadata follow-through adds no user-bug count. A separate
audio navigation candidate stops at incorrect Split tool casing before its
healthy action and is excluded; its corrected ordinary fixture is replayed.

The exact moved shield registrations and actual range/Skip support pass19/19
focused tests. The register follows the existing reader's ownership and
retains its precise native-clock exclusion. Completed compiler, public and
focused audit logs are deleted after their receipts.

## R7-EDIT-023 — Audio clip navigation projects unrelated native visuals

Framescaper: import an ordinary WAV, split it with Split tool, select the left
header and Select → Audio clips → Next clip. Healthy navigation selects the
right clip. Generate → Video Generators → Add Title/Text, select the same
left audio header and invoke Next clip again. It retains the left clip. The
unchanged actual public menu control passes before causal failure at the
right clip's data-selected=false in10.1 seconds on guardeddb368adda. Its
independent audio candidate/adjacent-selection owner attempts whole-project
media projection, which includes raw native generator leaves unrelated to
audio navigation. Earlier incorrect tool casing and missing data-clip-kind
selector fail before healthy navigation and are excluded.

All four strict adjacent/boundary commands independently reproduce the
unrelated native Title's clip.timelineStartFrame refusal while each same
audio-only control passes. Resolve the effective selected range through the
shared exact geometry reader, restrict the audio candidate projection to its
audio leaves and omit unrelated bin leaves, then resolve only the selected
related peers' exact content boundaries. Native A/V relationship expansion,
owner tracks, musical clocks and stable document order remain authoritative.
Move the exact shield evidence to these named boundaries without changing its
rules. The corrected navigation, selected content, shield audit and ownership
group passes59/59; native visual selected range and Skip controls pass5/5.
The extracted reader's exact shield inventories and fixture expectations
follow the same named owner without weakening the audit. Complete public
correction awaits the next guarded capture; EDIT023 is not yet counted.

The full50 spectral handle replay is traced with passive DOM pointer events:
first native contact captures its spectral handle, but the second contact
lands on an ordinary clip body, starts the main timeline capture, clears the
spectral band and disconnects the owning handle. R6-EDIT-054's main timeline
foreign-pointer admission omitted a fresh secondary touch when its local
session is empty because another independently owned handle is active. This
is conservative zero-count follow-through of that existing ownership root.
Refuse only a secondary touch the main owner has no first contact for. The
strict mounted causal case and five existing primary/ownership/pinch controls
pass6/6, also included in the59-test group. Preserve deliberate main-timeline
two-touch pinch when it already owns the first contact. The one-use passive
trace spec and read diagnostics are deleted immediately after the cause
receipt. The original unchanged public spectral workflow awaits this capture.

Authenticated04e87c277 completes both unchanged public cases,2/2 in6.9
seconds: native Title keeps ordinary audio Next clip navigation, and the
original spectral handle first-contact workflow survives the secondary touch
and final release. EDIT023 is fully qualified; the spectral repair adds no
count. All reproducible full50 browser failures now have focused resolution;
this does not relabel that failed complete run as a pass. Both public logs and
output directories are read and removed immediately after the receipt.

## R7-EDIT-024 — Named region creation drops a header-selected recording

Soundscaper: import an ordinary WAV, Window → Markers. Select → Select all,
then Add region from selection works; Undo, Select none, select the recording's
header and use the same action. The selected recording is visibly active but
the button is disabled. This independent annotation creation consumer reads
only collapsed stored time bounds. The actual public healthy range and Undo
pass before causal disabled admission on guarded04e87c277. An initial All/None
menu-name setup failure is excluded and its diagnostics immediately removed.
Both actual controller cases independently pass drawn-range creation and Undo,
then refuse the selected recording at0 or4800 with the positive-selection
error. Initial nonexistent history fixture ports are excluded before these
causal runs.

Resolve the selected clip or explicit time interval at this existing creation
owner, keeping requested bounds authoritative. The existing panel, annotation
lane and creation keyboard routes use the same effective range. Extract its
range and unchanged nonnegative frame validator into a focused strict module;
the growth-frozen controller shrinks11 lines. Register the exact helper's
delegation to the shared selection boundary. The existing audit scopes and
rules stay unchanged. Corrected actual controller, media immutability,
one-step Undo/Redo, annotation command/model and shield supports pass44/44;
targeted type-aware lint passes. Corrected complete public proof is pending;
EDIT024 is not yet counted.

Authenticated guarded8fba4b346 completes EDIT024's unchanged public healthy
range, Undo, selected-header admission, named region kind and identical end
sample in4.3 seconds. EDIT024 is fully qualified. Full source and test/tooling
strict compilation pass; both production builds preserve the500000-byte
chunk limit and existing startup maxima. The annotation controller's recovered
11 lines are claimed by the maintainability register. Reviewed build,
compiler and public logs and output are removed immediately. No manual
**Update AI assets** run is required.

## R7-EDIT-025 — Clip export reads absent native visual sample fields

Framescaper: import an ordinary WAV, right-click its header → Export clip,
choose Current selection and export. The healthy actual WAV delivers38400
samples without an error. Generate → Video Generators → Add Title/Text,
right-click its header and invoke the same Export clip. It opens delivery
with a visible “Selection frames must be finite numbers” error; its separate
clip-export consumer reads sample aliases absent from the saved native Title.
Both original and strengthened healthy-PCM public workflows causally RED on
guarded8fba4b346. The manifest's independently published clip-export adapter
also causally refuses both actual controller-authored Titles at0 and48000,
after the existing Track start to end range control passes.

Both entry paths resolve this exact clip's content boundaries through the
existing authored native/musical reader before selecting it. Preserve ordinary
sample clips, selected clip identity, project media and history, and keep the
existing delivery dialog and explicit Output choice. This entry-point family
counts once and has no quota until complete public correction. Corrected
actual controller, native range/Skip, manifest and all unchanged shield audit
checks pass24/24; type-aware targeted lint, size and diff checks pass. Reviewed
causal diagnostics, logs and focused verification output are removed
immediately. No manual **Update AI assets** run is required.

EDIT025's exact-extent follow-through adds a native Title at4800 with Snap
enabled: the corrected native reader reaches valid geometry but its existing
pointer selection API still rounds the start to0. This is the same export
consumer, with zero additional count. Use the existing exact selection API
at both clip-export entry paths; the three actual Title placements, original
native range/Skip, manifest and all shield support now pass25/25. Targeted
lint passes and reviewed follow-through output is immediately removed.

## R7-EDIT-026 — Manage labels Time selection quantizes authored regions

Soundscaper: import an ordinary0.8-second WAV, select its header, Edit → Add
label and finish its name. Edit → Manage labels, Select none, then its row's
Time selection restores0..0.8 seconds. Enable Snap, Select none and use the
same Time selection again: Selection end becomes1 second while the saved
label still ends0.8 seconds. The unchanged guarded8fba4b346 public healthy
control passes before this causal1.000-versus0.800 failure. This panel's
independent selection callback still calls the pointer-grid API; R3-EDIT-009
repaired the separately implemented timeline marker click/focus/context owner.
An initial New label setup intentionally creates a point, a guessed Select
button name, and a duplicate panel/toolbar End locator are excluded setup
failures. All reviewed diagnostics are immediately removed.

Call the existing exact range API at this panel owner and update its precise
local controller port and two faithful existing panel fixtures. Two actual
mounted row/controller cases with ordinary authored point and region labels
pass unsnapped controls, then causally RED at0 instead of9600 with Snap.
Corrected native media/label/history preservation, panel reload and deletion,
composition, timeline exact-label selection and label creation support pass
13/13; targeted type-aware lint passes. Complete public correction is pending;
EDIT026 has no count yet. No manual **Update AI assets** run is required.

EDIT026 completes the unchanged full public workflow on authenticated dc8bba540: unsnapped label selection stays0..0.8 seconds, and Snap retains that exact authored extent. Its production panel, original label and native selection assertions pass. This independent panel owner is fully qualified. Complete test/tooling strict compilation and all8 repository lint shards pass; reviewed build, compiler and lint outputs are removed immediately.

EDIT025 final public delivery exposed the source working-set estimator treating an ordinary native Title as PCM: its screenshot shows “Source channel count must be a non-negative safe integer” and no new download. Three actual controller-authored Titles through the production playback and detached export projections independently causally RED at that same error. Exclude known native visual source kinds from PCM estimation, retaining legacy and native audio accounting and all memory ceilings. Corrected final planning plus existing export working-set, clip and offline-admission controls pass41/41; targeted type-aware lint and diff checks pass. Earlier direct canonical export-plan probes bypassed the normal product projection and are excluded setup errors. This necessary delivery completion adds no count to the held clip-export family. Reviewed diagnostics and all focused output are immediately removed.

EDIT025 completes the unchanged entire public workflow on authenticated4fc2a8437 in12.9 seconds: the ordinary recording exports38400 samples, then the native Title exports exactly240000 samples through its context menu and Current selection. No selection error occurs, each actual download is newly published and decodes, and both original clips remain. This complete consumer family is now fully qualified, including native geometry, exact Snap retention and known-visual PCM-estimation follow-through, with one count.

The provisional EDIT027 Select all fallback is excluded. Its standalone compatibility action internally quantizes programme bounds with Snap, but normal Select all and Ctrl+A dispatch the existing production menu owner, which selects exact bounds. The complete healthy menu, Snap/menu, Snap/keyboard and twice-decoded57600-sample delivery workflow passes unchanged on authenticated4fc2a8437 in8.5 seconds. Internal-only failures are irrelevant under this task; no production change or count is made. Both provisional regression files and their completed Node/public output are immediately removed.

EDIT028 provisional global structural-menu lock admission: authenticated56c2efd1a ordinary Zulu/Alpha WAV Sort/Undo and Align-start-to-zero/Undo controls pass. Lock track demonstrably disables its native loop handle. Both still-offered global commands then raise the actual browser Structural operation refused for locked track error without changing order/position, and both reopened commands remain aria-disabled=false (complete causal RED2/2). No count until strict and unchanged complete corrected public GREEN. Earlier wrong Align label and assumed workspace-alert presentation are excluded setup observations. Read baseline output and both exact failed contexts are immediately removed.

EDIT028 strict model causal RED5 with2 unlocked/unrelated-folder controls; narrow production project/selected-track admission now passes15/15 including all existing structural planner/service controls. Alignment includes explicit targets, linked partner and entire canonical root-folder timing block; global Sort respects track locks while mute controls remain available. Targeted type-aware ESLint and diff pass. No new module, dependency or feature surface; complete corrected public proof remains pending. Reviewed strict and lint logs are immediately removed.

EDIT028 completes both unchanged entire public workflows on authenticated32eb4cebf: Sort and Align unlocked action/Undo, actual Lock track, correctly suspended global action, Unlock and successful action all pass2/2. No uncaught browser error occurs. This shared global structural-menu owner now qualifies once; editing26 total. Completed public output is reviewed and immediately removed. No manual **Update AI assets** run is required.

Global Remove tracks lock-admission follow-through (zero additional count): the ordinary Protected recording WAV removes and undoes successfully, then the real Lock track menu makes clip geometry read-only. The global Tracks command remained enabled and opened the actual workspace locked-track error while retaining the clip; its complete pre-fix public witness fails on aria-disabled=false on authenticated32eb4cebf. A strict actual application-menu test also fails the locked selection before the fix. The existing selected removal planner now supplies complete selected/linked-lane lock admission to that global menu, preserving unlocked unrelated tracks. Corrected whole public proof is pending the next guarded build. Initial private helper-import failure was test setup only and adds no count. Reviewed failed diagnostics and logs are immediately removed.

The global removal strict application-menu and existing plural removal controls pass9/9; targeted type-aware lint and diff checks pass. The new pure admission reader mirrors the existing protected lane-group command closure. No count is added.

## R7-EDIT-029 — Chronological navigation selects a collapsed folder item

Import three ordinary WAV recordings and move the second and third later through Ctrl+Right. Assign Next item and Previous item in Preferences, complete their expanded chronological controls, then move the middle recording into a folder and collapse it. Next item from the visible first recording selects the undisplayed middle item instead of the next visible recording. This chronological adjacent-item owner is independent of EDIT012's track navigation and EDIT017's contextual placement. Its authored-clock ordering remains unchanged.

The unchanged complete public witness on authenticated32eb4cebf completes healthy bidirectional navigation, actual folder authoring and collapse, then fails because the visible last clip remains unselected. The actual Soundscaper native Tone/controller and published navigation action also causally fail, returning the hidden clip's identity after the healthy controls. Filter the existing chronological candidate list through the displayed track hierarchy while preserving exact ordering, missing-anchor entry and edge clamping. Strict corrected and complete public proofs are pending. Reviewed failed public context and both logs are removed immediately. No manual Update AI assets run is required.

EDIT029 actual native chronological/entry/track-folder controls pass5/5, and existing item action/clip-navigation parity controls pass8/8. The strict canonical source and actual browser causal witnesses preceded the hierarchy correction; no geometry, time-selection or documented hidden/mute policies change. Targeted type-aware lint passes; file-size and diff guards pass. Complete corrected public proof remains pending.

Provisional Take comp trailing-gap public witness on unchanged32eb completes actual oscillator cycle recording, full-group Flatten/Undo, native Apply end19200 within the38400-frame group and persistence. The second Flatten shows the real workspace refusal: Flatten renderer returned an inexact take group extent; its group remains. The first attempt read Saved before take publication and is excluded setup; the corrected witness awaits the actual durable group. Its latest overall30-second failure also contains the exact causal renderer alert, which is recorded separately from the elapsed budget. The next unchanged probe observes native completion or error directly before the same complete assertions. No source correction or count yet. Reviewed exact contexts and logs are removed immediately.

## R7-EDIT-030 — Flatten truncates an authored comp's silent end

Record ordinary microphone loop takes, flatten the unchanged full comp and Undo, then shorten its first region through the Take lanes and comps table's Apply end. Flatten comp is offered but fails with the actual inexact take group extent error. The comp renderer's private model ends at its final active segment; its range clamps the requested whole-group end to that earlier clip end. This exact extent owner is independent of R6-EDIT053's channel allocation.

The corrected observer's unchanged32eb whole public witness reaches the actual workspace renderer alert and fails at1 error versus0, after complete recording/healthy Flatten/Undo and persisted native boundary controls. Strict canonical native command/history plus the real production engine and existing gain-rendering context likewise causally REDs the shortened comp while the full-group control passes. Request the exact validated group output frame count, keeping the captured active source window and allowing native rendering to retain silence through the group end. Corrected strict/native PCM and complete public proofs remain pending; no count yet. Reviewed exact failed diagnostics and logs are immediately removed. No manual Update AI assets run is required.

Corrected exact native PCM and existing mono/stereo/surround extent controls pass6/6. Existing native take commands, stale publication, immutable history and rendered-audio controls pass9/9. The shortened group delivers exactly400 frames, with200 active frames followed by200 silent frames; the full-group control stays intact. Targeted type-aware lint and diff checks pass. Complete corrected public proof remains pending the next authenticated build; no count yet. Reviewed strict/support/lint output is immediately removed.

Authenticated3b510658d completes the unchanged complete global Remove tracks Lock/Unlock recovery and ordinary recorded take-comp shortened-end Flatten/Undo/Redo workflows2/2 in18.4 seconds. Remove tracks is zero-count admission follow-through. EDIT030 now qualifies once, retaining the actual38400-frame flattened source and exact native shortened take group through Undo/Redo. The unchanged complete EDIT029 expanded/chronological/folder-collapse/bidirectional shortcut workflow also passes1/1 in10.4 seconds on the same authenticated build. EDIT029 independently qualifies once; editing28 total. One initial batch filename did not match the navigation spec; its separate actual run supplies the proof. Reviewed complete public logs/results are immediately removed. Both guarded product builds pass, with largest chunk487712 bytes under the unchanged500000 ceiling. No manual Update AI assets run is required.

The provisional native clip-gain duration-alias lead is excluded. The ordinary timeline resolves the persisted project through the runtime projection before indexing clips, so the envelope adapter already receives valid geometry. Its first Framescaper attempt clicks the clipped second audio row below the default720px viewport; this is setup only. The same complete normal import, real gain-point insertion, native persisted envelope and Undo/Redo controls pass unchanged in both products on authenticated3b510658d with the standard1440x1000 viewport. No production edit or count. The provisional verification file, reviewed exact screenshot/context and both completed logs/results are removed immediately.

## R7-EDIT-031 — Clip gain publishes a deleted recording's draft

Import an ordinary recording, insert a Clip gain point, complete a normal drag and Undo. Begin another drag and press Delete while holding the pointer, then release it. The clip disappears correctly, but the release publishes the retired gain draft and opens the real workspace error: The action failed: Unknown clip. The ordinary track row survives clip deletion; its independently owned preview cache survives with it. This lifetime root differs from the vendor primary-button admission and existing Escape/native-event completion owners.

The complete unchanged public witness on authenticated3b510658d completes native insertion, healthy drag/Undo and actual clip deletion before causally failing at1 workspace alert versus0. The strict mounted production hook, actual Soundscaper native history and runtime projection likewise pass unchanged/renamed owner controls before the deleted-owner case fails with the identical Unknown clip refusal. Retire previews when their clip leaves the current runtime index, and check the current owner again at deferred release publication. Corrected focused and complete public proof remain pending; no count yet. Reviewed failed public screenshot/context and both logs are immediately removed. No manual Update AI assets run is required.

Corrected deleted-owner retirement, unchanged/renamed live owner publication and Delete/Undo-before-release retain native history without resurrecting the draft. Those controls, vendor button admission, Escape/native-listener completion and take extent/width controls pass18/18. Targeted type-aware lint and diff checks pass. The previous complete compiler's native comp fixture returned the renderer's wider AudioBuffer/raw-channel union; its test-only boundary now asserts the actual native AudioBuffer before returning it, without widening the production port. Complete corrected public proof and the refreshed complete compiler remain pending. All reviewed focused and lint outputs are immediately removed.

EDIT031 completes the unchanged entire native import, healthy gain drag/Undo, held-pointer Delete/release and final Undo workflow on authenticated bf42180222a87f589dd41ce62b6fb8b8dba90bd7, 1/1 in6.1 seconds. No workspace alert or uncaught browser error occurs; the original gain point survives Undo without publishing the retired draft. This independent lifetime owner now qualifies once; editing29 total. Reviewed complete public output is immediately removed. No manual Update AI assets run is required.

## R7-EDIT-032 — Sample pencil submits a removed recording's held stroke

Import an ordinary96-sample WAV, select it, View → Zoom → Zoom to selection, complete a normal sample stroke and Undo. Hold another stroke, press Delete and release. The actual recording disappears, then release opens the native workspace refusal: The audio clip could not be found. The independently owned timeline pointer completion sends its cached sample points to a deleted clip; the gain-envelope cache correction in EDIT031 does not affect this path. All stale/deleted sample-stroke manifestations count once.

The complete public witness causally fails on authenticated bf42180222a87f589dd41ce62b6fb8b8dba90bd7, after healthy sample publication, Undo and actual native deletion. The strict mounted production pointer owner and real native history pass unchanged/renamed controls before Delete and Delete/Undo-before-release causally fail at one pencil publication instead of none. Retire the sample pointer session when its clip leaves the current project, and verify the live clip again at final publication. Corrected focused and complete public proof remain pending; no count yet. Reviewed exact browser screenshot/context and strict/public RED logs/results are immediately removed. No manual Update AI assets run is required.

Corrected deleted/still-live/renamed/Delete-Undo sample-stroke controls, existing pointer identity/cancellation, crossfade atomic publication and Split-tool completion pass17/17 through the canonical style-asset loader. Targeted type-aware lint and owned diff checks pass. An earlier support batch without that existing loader reports one CSS-import setup failure while the new4/4 and other7/7 cases pass; this is excluded and not described as a green batch. Complete corrected public proof remains pending the next guarded build; no count yet. Reviewed both completed focused outputs and lint output are immediately removed.

The next complete compiler passes all source/runtime/four-product boundaries and both prior Blender/envelope fixture corrections, then reports only the new pencil fixture's omitted optional runtime callback port and closure-local callback narrowing. Its test-only mounted boundary now explicitly supplies the existing no-op reveal callback and carries the actual hook completion through a typed ref; original4/4 native lifetime cases and targeted type-aware lint pass. No production API or assertion changes; this adds no count. Reviewed compiler/focused/lint outputs are immediately removed.

A provisional contextual audio-clip folder navigation witness fails its healthy Previous clip control before folder creation. The actual screenshot shows only the previous-boundary extension: the broad shared test menu helper matches Previous clip boundary to cursor first. Its maintained witness now names the actual published Previous clip terminal exactly, retaining all selection assertions. A separate actual native controller probe verifies the expected healthy Next/Previous selection geometry unchanged. Both are setup-only observations, adding no bug count or production edit; reviewed diagnostics, probe file and completed logs/results are immediately removed before the corrected public witness.

EDIT032 completes the unchanged whole normal sample publication/Undo, held stroke/Delete/release and final Undo workflow on authenticated85fca21e6bb56256161a966f864bf8bbd611486a in the14.6-second two-case batch. No actual workspace alert or page error occurs. Its complete standalone case passes; the other batch case is the separately held contextual-navigation causal witness. This independent sample pointer lifetime owner now qualifies once; editing30 total. Reviewed complete output and results are immediately removed. No manual Update AI assets run is required.

## R7-EDIT-033 — Contextual audio navigation selects collapsed recordings

Import three ordinary recordings and move the later two through the existing Ctrl+Right command. Select → Tracks → No tracks permits contextual Select → Audio clips → Next clip/Previous clip to search the visible programme; both expanded controls pass. Put the middle recording into a normal folder and collapse it. Next clip now selects the undisplayed middle recording instead of the next visible one. Its private candidate projection independently omits folder visibility even after EDIT029 repairs the separate global chronological dispatcher. One visibility root includes all adjacent and boundary contextual audio navigation.

The exact published terminal witness on authenticated85fca21e6 completes both healthy contextual controls and actual folder authoring/collapse, then causally fails the visible last recording's data-selected=false. Its screenshot shows the hidden recording's exact0.083..0.283 range selected without a visible selected clip. Strict native controller proof and correction are pending; no count yet. Reviewed public screenshot/context and completed batch output are immediately removed. No manual Update AI assets run is required.

The actual native controller/contextual menu port completes both expanded healthy controls before causally returning the collapsed recording's identity. Filter this owner's projected audio candidates through the existing document folder snapshot and visible-track reader, preserving selected visible track scope, authored-clock ordering and all geometry. Corrected native folder navigation, original clip/boundary/selection controller and published global chronological controls pass21/21; targeted type-aware lint and diff checks pass. Complete corrected public proof remains pending a guarded build; no count yet. Reviewed RED/GREEN and lint logs are immediately removed.


## R7-EDIT-034 — Range-derived tracks lose their adjacent insertion positions

Import ordinary Alpha and Bravo recordings, select Alpha through Select → Region → Track start to end, then Edit → Audio clips → Split into new track. The real native timeline appends Alpha 2 after Bravo. The exact whole public witness on authenticated85fca21e6 passes the initial visible track ordering and reaches native Split before causally failing the new order. Native controller proof independently reproduces that root placement, and its ordinary foldered counterpart passes the healthy single lift before a two-track lift misplaces Bravo 2 before Bravo. Both insertion-position manifestations are conservatively held as one new range-derived placement owner; the earlier round2 folder-containment omission remains its separate prior root. A first strict folder fixture reused a memory database and is excluded as setup; unique real per-case databases reproduce both actual ordering failures. No count yet; complete corrected public proof is pending. Reviewed public screenshot/context and both RED logs/results are immediately removed. No manual Update AI assets run is required.

The first optional public folder counterpart attempt imports its existing track-menu helper from the broad module instead of the owning helper, so no browser case is scheduled; this is excluded setup. The maintained test now imports the actual owning helper. All completed setup-only output is immediately removed.

The corrected public folder counterpart on the same unchanged85fca21e6 finishes actual Select all/folder authoring, healthy single-track lift and Undo, then causally places Bravo recording 2 before Bravo recording during the ordinary two-track lift. Its actual rendered order and native screenshot match the strict failure. Preserve the existing legacy flat insertion index for active zero-folder documents, and insert later siblings first so every captured parent-relative position still names its source; retain first-source selection and all processors, routes and automation. Corrected native root/folder ordering and full history, existing flat picture capability admission, derived processor/routing/containment, selection geometry and replacement controls pass25/25. Targeted type-aware lint and the corrected published helper import lint pass. Complete corrected public proof remains pending a guarded capture; no count yet. Reviewed failed screenshot/context and all completed focused/lint/public outputs are immediately removed.

EDIT033 and EDIT034 complete every unchanged whole published workflow on authenticated2241ac091538323b604c61357885b98ba8d76c27:3/3PASS in18.5seconds. Contextual Next/Previous excludes actual collapsed recordings and retains expanded selection controls. Both native zero-folder and authored-folder single/multiple range lifts retain direct source adjacency, correct physical clip count and full Undo/Redo without native alerts. The conservative derived-position family counts once, and contextual candidate visibility counts once. Editing32 total; no assistance runtime closure changes or manual Update AI assets run required. Reviewed completed public output/results are immediately removed.

A provisional held track-resize/Undo witness completes healthy resize/Undo, then fails before its intended deletion: Ctrl+Z leaves the new second track present. Its screenshot shows a last-row lower edge outside the workspace, with no proven owning preview/key dispatch. This setup-only observation causes no source edit/count. The maintained provisional witness now scrolls the actual row into view, focuses its visible Track menu button through the ordinary keyboard surface and verifies the exact live24pixel preview before Undo. Reviewed failed screenshot/context and completed setup output/results are immediately removed.


## R7-EDIT-035 — Track height release submits an undone track

View → Zoom → Increase all track heights, complete a healthy native height resize and Undo. Tracks → Add new track → Audio track, scroll its ordinary track controls into view and focus Track menu, then hold its lower-edge resize. After the exact24pixel live preview, Ctrl+Z removes the newly added track. Releasing the mouse raises The track could not be found. The independent track-height completion branch verifies only that some project remains; unlike clip-bound gestures it does not verify its captured track owner. Its fitted-height draft also survives Undo/Redo before release and can wrongly alter the restored track. All track-height ownership-retirement manifestations count once.

The complete normal browser witness on authenticated2241ac091 reaches healthy publication/Undo, proves the exact preview and actual native track removal, then causally fails with one native alert. The actual mounted pointer completion/native Soundscaper history independently passes unchanged/renamed height controls before reproducing Unknown track on Undo and stale publication on Undo/Redo. Corrected focused and whole public proof remain pending; no count yet. Reviewed failed native screenshot/context, strict RED log and completed public output/results are immediately removed. No manual Update AI assets run is required.

Corrected held height lifetime and native unchanged/renamed/Undo/Undo-Redo history controls, existing touch/mouse/pinch movement, generic pointer identity, sample lifetime and view-state height publication pass26/26. Before publication, check the current native track and retire its entire fitted-height draft as soon as that track disappears, so Redo cannot resurrect the old gesture. Targeted type-aware lint passes. Corrected complete public proof is pending the next guarded capture; no count yet. Reviewed completed focused/lint output is immediately removed.

## R7-EDIT-036 — Auxiliary release prematurely completes Clip gain

Import an ordinary recording, choose Clip gain through the existing menu, insert a real point and complete a healthy primary drag and Undo. Hold another primary drag, release the middle mouse button while the primary button remains held, continue moving and release the primary button. The point stops at the auxiliary release: its native rendered position is553 instead of the healthy571. The complete unchanged normal witness on authenticated2241ac091 passes the healthy controls before this causal failure. The vendor drag owner and the application's deferred publication listener both treat every mouse release as completion; these manifestations count as one primary-release ownership root.

Actual mounted vendor point/segment controls and real native Soundscaper history/publication controls causally fail6/6 at one premature publication versus none. Both listeners now require primary release, preserving the held draft and publishing once at final completion. Corrected primary ownership, native history, deleted-owner retirement and existing point insertion/removal admission pass16/16. The frozen vendor component remains728lines, with no growth. Complete corrected public proof and targeted lint remain pending; no count yet. Reviewed failed native screenshot/context, both RED logs/results and completed focused output are immediately removed. No manual Update AI assets run is required.

Targeted type-aware lint and the canonical changed-file lint complete PASS for this source-ready correction; diff checks pass. The existing deletion fixture now supplies a faithful primary mouse-release button, with no history assertion change. Reviewed completed lint output is immediately removed. The exact consumed public failure directory contained84692bytes; its PNG/context and logs are removed. Whole corrected public proof remains pending.

EDIT035 and EDIT036 complete both unchanged entire native workflows on authenticated b6a6cdaafd22485d331a77a2b08209a6d74d0be4,2/2PASS in7.0seconds. Healthy height publication/Undo and held new-track Undo/release complete without an alert. Healthy Clip gain/Undo, auxiliary release while primary remains held, final publication, single Undo and Redo retain the exact full point displacement. Each independent owner now qualifies once; editing34 total. Reviewed complete public output/results are immediately removed. No manual Update AI assets run is required.

## R7-EDIT-037 — Auxiliary release ends a held label move

Import an ordinary recording, add a normal timeline label, complete a healthy primary40pixel move and Undo. Hold the next label move, release the middle button with primary still held, continue to40pixels and release primary. The visible native label stops at24pixels instead of52pixels from the render origin. This exact unchanged whole witness causally fails on authenticated b6a6cdaafd after its healthy controls. The label vendor state, native label draft publication and Escape lease each relinquish primary ownership on any mouse release; all label move/edge counterparts count as one independent label gesture family.

Actual mounted application label box/left/right edge and native Soundscaper project/history controls causally fail6/6 at one early publication instead of zero. Primary-release guards keep all three owners active through auxiliary release. Corrected focused and complete public proofs remain pending; no count yet. Reviewed failed exact screenshot/context, both public/strict RED logs and completed native results are immediately removed. No manual Update AI assets run is required.

Corrected six native label moves/edges, existing primary/nonprimary start admission and Escape cancellation pass16/16. The first corrected run passes all10 old controls and the new release guards, then honestly reports six fixture errors at the added history observer: the native history exposes undoStack, not past. The fixture now names that actual port, retaining the causal no-publication and single native-history-entry assertions. Targeted type-aware lint and diff checks pass; complete corrected public proof remains pending the next guarded capture. Reviewed completed focused and target-lint output is immediately removed.

Canonical changed-file lint also completes PASS on the maintained label correction inventory. Existing primary-release support fixtures now provide the native button0, preserving all original admission/cancellation assertions. Reviewed completed changed-lint output is immediately removed. The complete refreshed test/tooling compiler is active; no new count from verification.

The refreshed complete test/tooling compiler completes PASS with the real undoStack observer and current output-strip fixture. Reviewed completed compiler output is immediately removed. Whole native label release proof remains pending.

The first corrected complete native label workflow honestly still fails on authenticated44d16c00d: auxiliary default focus replaces the held move's baseline with its12pixel preview, producing64pixels instead of52. The actual mounted focus transition independently reproduces36960frames versus31200 while all four edge controls pass. Preserve the original baseline while the same primary gesture remains active; ordinary focus selection remains available. Corrected focus, release, history, primary/nonprimary starts and Escape controls pass16/16, with targeted type-aware lint and diff checks PASS. This is follow-through of the same label-release root, adding no count; complete corrected public proof remains pending. Reviewed exact screenshot/context and completed RED/GREEN/public/target-lint output are immediately removed.

Canonical changed-file lint completes PASS for the source-ready focus closure; its reviewed output is immediately removed. No callback or history assertion is relaxed. A further guarded capture is required before complete native label qualification.

## R7-EDIT-038 — Clip movement waits for the last held mouse button

Import an ordinary recording, move its native header24pixels and Undo. Repeat that movement, press middle while primary remains held, release primary, move24morepixels with middle held, then release middle. The native saved recording moves19200frames instead of the healthy9600frames. The complete normal public witness on authenticated b6a6cdaafd passes healthy native move/Undo before this causal failure. Pointer events report primary release as pointermove while another button remains held; the timeline completion owner waits for pointerup and accepts motion after its owning button has released. All generic timeline drag counterparts count once under this separate completion authority.

The actual mounted production completion hook and native Soundscaper project/history reproduce both middle/right-held primary releases:2causalRED and6 unchanged mouse/pen/touch/foreign-pointer controls PASS. Observe the real primary-button release transition through the existing global pointer lifecycle, flush the accepted latest movement and finish the current pointer owner once. Corrected native history, pointer identity, deleted-track height retirement, crossfade atomic completion, Split tool and frame-coalescing controls pass26/26. Targeted type-aware lint and diff checks pass. Complete corrected public proof remains pending; no count yet. Reviewed failed exact native screenshot/context, strict/public RED logs/results and completed focused/target-lint output are immediately removed. No manual Update AI assets run is required.

Canonical changed-file lint completes PASS. The exact consumed causal browser directory contained84565bytes and is removed with the completed lint output. This correction retains ordinary auxiliary presses, unrelated pointer movement, pen and touch ownership; final pointerup cannot publish the completed draft twice. Whole corrected public proof remains pending.

EDIT038 completes its unchanged entire native clip move/Undo, held-middle primary release, extra motion, final release and Undo/Redo workflow on authenticated44d16c00d487f7543376664fd78ddf714f8fdb6c. It is the passing complete case in the honest15.4second two-case batch; the label counterpart remains failed and unqualified. The actual saved clip retains9600frames, with exactly one Undo to0 and Redo back to9600. This independent generic pointer completion authority now qualifies once; editing35 total. Reviewed complete batch output and the label's failed diagnostics are immediately removed. No manual Update AI assets run is required.


## R7-EDIT-039 — Automation continues after its primary button releases

Import an ordinary recording, add an automation lane through Track menu, insert a point, complete a healthy12pixel drag and Undo. Repeat that primary drag, press middle, release primary, continue12morepixels with middle held and release middle. Its actual visible point saves83.8706062964 instead of the healthy72.114378513. The unchanged complete native public witness on authenticated44d16c00d passes healthy publication/Undo before this causal failure. The private SVG automation lifecycle independently waits for pointerup while primary release with another button held arrives as pointermove. Point and Bézier counterparts count as one automation owner, separate from the generic timeline session which this SVG never starts.

Actual mounted point/Bézier controls reproduce4/4 causal failures at0commands instead of1 on primary release. Observe that same mouse button-state transition in this owner, flush the accepted draft and complete once with the original expected lane. Corrected primary-release, auxiliary/foreign-pointer, pen/touch, original hybrid pointer ownership, keyboard edits, Escape/cancellation and stale-draft controls pass37/37. Targeted type-aware lint passes. Complete corrected public proof remains pending; no count yet. Reviewed native screenshot/context and all completed public/strict/focused/target-lint output are immediately removed. No manual Update AI assets run is required.

A fresh ordinary playhead healthy mouse scrub/Home and held-middle primary-release counterpart completes unchanged on authenticated44d16c00d,1/1PASS in3.7seconds. The proposed continuing-scrub root is excluded: no causal defect, production edit or count. The provisional public file and its reviewed completed log/results are immediately removed.

Canonical changed-file lint completes PASS for the maintained automation correction inventory. Its reviewed completed output is immediately removed. Whole corrected proof remains pending the next guarded build.

A provisional maximum-frequency primary-release observation passes but its healthy outward movement may reach Nyquist, so it does not establish causal continuation or absence of a defect. It is excluded, with no source edit or count. A separate time-edge counterpart now avoids frequency clamping. The reviewed completed provisional output/results are immediately removed.

The separate ordinary spectral time-edge healthy preview/Escape restore and held-middle primary release also complete unchanged on authenticated44d16c00d,1/1PASS in3.7seconds. No causal defect is established, so this candidate is excluded with no source edit/count. Its provisional public file and reviewed completed output/results are immediately removed.

EDIT037 and EDIT039 complete both unchanged entire native workflows on authenticatedc9198813d6f922140a4b482b6e194a1fa9cd57b0,2/2PASS in6.6seconds. The label retains its original healthy40pixel final displacement through auxiliary release/focus and exactly one native Undo/Redo. The independent SVG automation owner stops at primary release, retains the healthy12pixel displacement despite later auxiliary motion and exactly one Undo/Redo. Each separately repaired owner now qualifies once; editing37 total. Reviewed completed batch output/results are immediately removed. No manual Update AI assets run is required.

A fresh Source waveform primary-release candidate completes healthy mouse selection/clear and proves the new live20percent preview, then fails because the final selection element is gone after primary release with middle held. The screenshot/context and complete7.6second failed-case output are consumed; this is a pending selection-loss observation rather than a claimed continued-motion root. A passive native event observer will resolve focus/capture timing before any source edit or qualification. Completed diagnostics/results/log are immediately removed.


## R7-EDIT-040 — Source selection is discarded after primary release with another button held

Import an ordinary long recording, open Clip properties through its existing menu, complete a healthy source waveform20percent selection and clear it. Repeat that same preview, press middle, release primary, move farther and release middle. The actual healthy146pixel selection disappears entirely. A passive native observer confirms primary release is pointermove(button0,buttons4), followed by lostpointercapture(button−1,buttons4) on the next motion, causing this private owner to cancel an already released primary gesture. The complete8.0second causal witness on authenticatedc9198813d passes healthy controls and exact live geometry before selection loss; no internal action, altered recording or adversarial file is used. Selection/trim/fade/marker counterparts share this one private completion owner.

Actual mounted Source editor and real source preview service reproduce2causal failures at null instead of the accepted200..400 sample selection, while8 foreign/auxiliary/pen/touch controls remain healthy. Complete the current mouse owner at the native primary button-state transition before accepting further motion or capture-loss cancellation. Corrected focused source-selection, hybrid-pointer ownership, Escape/pointercancel, exact source mapping and retained content controls pass25/25 in1.38seconds. Complete corrected public proof and targeted lint remain pending, so no count yet. The passive event observer is removed from the maintained public witness. Reviewed exact screenshots/context and completed causal/strict output/results are immediately removed. No manual Update AI assets run is required.

Targeted type-aware lint completes PASS for the Source completion correction and strict/public regressions; the existing maintained Source editor remains298lines. Reviewed completed target-lint output is immediately removed. Canonical changed-file lint and a further guarded whole public proof remain required before qualification.

Canonical changed-file lint completes PASS for the Source correction inventory. Its reviewed completed output is immediately removed. All25 focused tests retain the actual accepted source target and previously committed range after subsequent capture cancellation and auxiliary release; complete native qualification remains pending a further guarded build.

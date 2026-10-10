# Round seven ordinary user-path bug audit

Target: 200 additional distinct bugs reached through existing user paths.
The worktree is `/home/splowatt/git/Soundscaper-user-path-bugs-200`, branch
`fix/user-path-bugs-200-oct9`, based on `47b61f6e7`.

## First checkpoint: 50 fixes

| Area | Qualified IDs | Count | Causal and focused evidence |
| --- | --- | --- | --- |
| Editing and navigation | R7-EDIT-001–013 | 13 | [Editing register](bugfix-round7-editing.md) |
| Dialogs and controls | R7-DIALOG-001–006, 008–016 | 15 | [Dialogs register](bugfix-round7-dialogs.md) |
| Effects and analysis | R7-EFFECT-001–009 | 9 | [Effects register](bugfix-round7-effects-analysis.md) |
| Import, export and media | R7-IO-001–003, 005–014 | 13 | [IO register](bugfix-round7-io.md) |
| Total | | 50 | All focused tests and complete qualified public paths pass. |

The unchanged complete last-wave workflows pass 9/9 in Chromium against
prepared capture `58264ec46`. Earlier focused public batches and their exact
receipts are recorded in the area registers. The first complete repository and
browser-suite gates are running against this checkpoint. The browser suite
contains 6,414 cases across Chromium, Firefox and WebKit. Its source checkout
stays frozen while the next fixes use the independent
`Soundscaper-user-path-bugs-200-advance` worktree. Full lint and source/test
typechecking passed; the controller guard then identified D012's private helper
outside its internal directory. Moving the unchanged helper into that directory
and updating its sole owning import passes the guard and all five default-view
regressions. This architecture follow-through adds no count; the canonical gate
is rerun with the correction. The corrected canonical static gate subsequently
passes in full. Its Node phase then catches four legitimately emitted helper
files missing from the desktop test inventory. Adding those exact inventory
rows passes the actual desktop compilation/import test and two existing
inventory checks (3/3), without changing assistance runtime assets. The complete
Node suite is restarted with `npm test` at `4d0462305`; the unchanged full browser
suite remains running against its prepared checkpoint site.

## Next qualified batch: 60 fixes

The independent advance worktree has ten further distinct qualified roots:

| Area | Added IDs | Added count |
| --- | --- | --- |
| Editing and navigation | R7-EDIT-014 | 1 |
| Dialogs and controls | R7-DIALOG-017–019 | 3 |
| Effects and analysis | R7-EFFECT-010–012 | 3 |
| Import, export and media | R7-IO-015–017 | 3 |
| Total added | | 10 |

Both guarded product builds, full source/test typechecking and focused
regressions pass. The prepared source at `8ce3e9f98` completes all ten ordinary
browser witnesses in Chromium, including the original Guided editorial
workflow's readiness follow-through. The editorial change remains within
D010 and adds no count. Missing-anchor track entry likewise completes EDIT014
without a separate count. WebM replacement uses a normal clip shorter than the
replacement recording; frozen-video audition checks the encoded source's
actual third-packet timestamp, rather than its sequence clock. Those completed
observer corrections preserve their original admission/freeze causal REDs.
Details and exact controls are recorded in the area registers. The qualified
total at that capture is 60; unqualified new candidates do not count toward it.

The browser run first reports failures in normalization, folder creation,
still-image import and the Guided editorial prerequisite. Replaying the first
three unchanged against prepared `48b7bf244` passes in 3.7, 4.2 and 6.1 seconds.
The editorial workflow reproduces its concrete D010 prerequisite dead end:
the disabled-by-default stage selector hides an installed model's enable
checkbox. Advance commit `2ac90c1cb` makes readiness inspect the available graph
while execution still requires explicit enablement; its 37 focused checks pass.
This is zero-count D010 follow-through. The complete checkpoint run continues;
the corrected editorial public retry uses the next prepared capture.

Later Firefox failures in the AUP3 File Open and copy/paste loop workflows both
occur before import or editing: the editor remains in its initial Loading
project state, with no project identity and `data-editor-ready=false`. A focused
unchanged replay against prepared `48b7bf244`, using one Firefox worker on an
independent loopback port, passes the ordinary AUP3 menu import in 4.6 seconds
and copy/paste loop repetitions in 2.7 seconds. The setup failure does not
reproduce, and no production behavior, assertion or deadline is changed. Its
45-byte replay result is removed immediately after this receipt.

Setup failures, unsupported int32 delivery, unpublished image-boundary commands,
and the surround-Reverb hypothesis do not count. Repeated manifestations and
follow-through corrections share their original root count. The build's module
ownership guards caught missing owners before the checkpoint; corrections
preserve their semantic groups and all existing size/graph ceilings.

Verification diagnostics are removed after their result is recorded. Permanent
regression tests remain. Desktop assistance engine sources, recipes and runtime
closures are unchanged; no manual **Update AI assets** run is required.

The canonical checkpoint's static gate passes, including all eight lint shards,
source and test typechecking, architecture, dependency audit, documentation
and production build. Its first Node attempt stopped at the isolated desktop
runtime fixture inventory; that named inventory was corrected before restarting
the complete suite. The restarted run completes 25,132 tests in 987.4 seconds:
25,052 pass, 47 fail and 33 skip. This is a completed failing run, followed by
focused resolution, rather than a claimed full-suite pass.

Thirty-four reference-reader cases failed because this new worktree lacked the
repository's pinned interchange tools. After provisioning those exact tools,
all 34 pass unchanged. The remaining 13 failures were two missing chapter
boundary registrations, three obsolete mix/render or analysis expectations,
one incomplete picture-selection controller stub, two old filter-tail length
expectations, three omitted nightly fixture dependencies, the audit document
index and the effect-tail helper's version registry row. Exact focused replay
groups pass 19, 27, 5, 31 and 17 tests respectively, retaining physical output,
history and ownership assertions. These corrections add no bug counts. The
complete browser run continues against the frozen prepared checkpoint while
later changes proceed in the advance worktree. Completed documentation build
output and reviewed diagnostics are removed immediately after their receipts.

## Qualified total: 68 fixes

Prepared source `ee9b3f13c` completes the next eight distinct roots in Chromium:
EDIT015–016 (atomic first Quantize and touching-label silence detachment),
DIALOG020–022 (one-frame dissolve, real picture adjacency and workspace name
publication), EFFECT013 (Audacity filter release), and IO018–019 (caption read
lifetime and native FCPXML source format). Their healthy controls and complete
public Undo/Redo or delivery witnesses pass; the combined batch passes 15/15
in 50.6 seconds. It also completes D016's original Audacity-onboarding meter
path after its zero-count latest-intent follow-through.

Both guarded product builds and complete source/test TypeScript checks pass.
The largest emitted chunk is 487,635 bytes, below the unchanged 500,000-byte
ceiling. The startup graph tightening command reports no room to tighten;
no graph maxima or semantic ownership guards were increased. Detailed causal
RED, focused GREEN and excluded setup receipts remain in the four area registers.
The complete checkpoint-50 browser run remains active; the next complete gates
are due at 100 qualified fixes.

The later packaged-test closure replay caught two new browser helper imports
(speech preview and warp drums), and its synthetic staging fixture lacked the
three newly required codec helpers. Stage those five exact files and copy their
actual bytes into the fixture; all 15 staging, closure and refusal checks pass,
alongside four native zero-crossing checks (19/19 total). This verification
follow-through adds no user bug count. Source typechecking, targeted lint and
size/diff checks pass; the full Node suite is rerun after this helper change.

The Firefox checkpoint also reports a native plug-in healthy keyboard control
at 1 instead of 0.26 and an old-floor sample in the Noise gate observer window.
An unchanged isolated native replay reaches no editing actions: one editor
readiness failure and three initial host-state persistence timeouts. These
results remain unresolved checkpoint failures and add no count. The reviewed
replay diagnostics are removed immediately; subsequent investigation retains
the original production behavior and meaningful positive controls.

## Qualified total:76 fixes

Prepared73b99f5b8 completes13 of14 corrected Chromium workflows in1.1 minutes.
Eight further distinct roots have complete public GREEN: EDIT017, DIALOG023–024,
EFFECT014–015 and IO020–022. Their healthy controls and exact causal failures
remain in the area registers. EDIT018 still fails its original native range
assertion and does not count. EDIT019 completes Chromium and its exact fine
Firefox keyboard values, but its complete Firefox state-history retry remains
pending after correcting an observer's absolute persistence count; it likewise
awaits that complete receipt. Both guarded builds and full tests/tooling
TypeScript pass; the largest chunk remains487,635 bytes and the startup graph
has no smaller byte ceiling to claim. The full post-fixture Node run and the
frozen fix50 browser run continue. Reviewed public diagnostics are removed
immediately after recording this result.

## Qualified total:77 fixes

EDIT018 now completes its unchanged exact multichannel alignment after
waiting for the current operation's result. The same final observer remains
causally RED on the frozen pre-fix site and GREEN on the corrected site.
Temporary baseline code and rendered-audio diagnostic output are removed
immediately. EDIT019 still awaits its complete Firefox retry; a subsequent
initial native host setup timeout adds no count.

Platform tracing excludes provisional EDIT019 completely: the failure exists
only in Firefox with a mocked desktop preload, whereas shipped native plug-ins
use Electron Chromium and their ordinary arrow control already passes. Remove
the unqualified production change and its new tests; preserve the state-barrier
fixture's real pending-write and saved-state checks while allowing browser
native keyboard differences. The qualified total stays77, with next candidates
DIALOG025, EFFECT016 and IO023 awaiting their corrected public workflows.

The final excluded Firefox native-host diagnostic stopped during the initial
host handshake with zero persisted states, before any keyboard action. Its
log, screenshots and temporary results are deleted immediately after review.
The private retime replacement helper retains its owning semantic chunk;
52 ownership checks and the helper-register lint pass. Full tests TypeScript
passes after collecting all three next candidates.

## Qualified total: 80 fixes

Prepared `b04e692b7` passes all four corrected Chromium workflows in
24.2 seconds: DIALOG025 (4.4 seconds), EFFECT016 (8.2 seconds), IO023's
continuous replacement control (11.5 seconds) and frozen replacement
(13.9 seconds). Each new root retains its ordinary-menu baseline causal
failure and focused tests in its area register. Both guarded builds pass;
the largest JavaScript chunk remains 487,635 bytes. The source excludes
provisional EDIT019. Manual **Update AI assets** is not required.

The additional full Node suite required after fixture-helper edits finishes
25,229 tests in 1,539.1 seconds: 25,193 pass, 33 skip and three fail
(exit 1). Its only failures are the exact private timing-reader register,
the shared sample-frame conversion register and the six intentionally
corrected spectrum digests. Commits `ac8bf39f9` and `564b5e03b` already
resolve these with 20/20 and 57/57 focused checks; the other 160 frozen DSP
signatures remain unchanged. This records a failing full run followed by
focused resolution, not a full-suite pass. The reviewed full-run log is
deleted immediately. Startup-graph tightening finds no smaller byte ceiling.

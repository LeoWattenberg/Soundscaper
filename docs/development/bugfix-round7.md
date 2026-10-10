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
total is 60; unqualified new candidates do not count toward it.

The browser run first reports failures in normalization, folder creation,
still-image import and the Guided editorial prerequisite. Replaying the first
three unchanged against prepared `48b7bf244` passes in 3.7, 4.2 and 6.1 seconds.
The editorial workflow reproduces its concrete D010 prerequisite dead end:
the disabled-by-default stage selector hides an installed model's enable
checkbox. Advance commit `2ac90c1cb` makes readiness inspect the available graph
while execution still requires explicit enablement; its 37 focused checks pass.
This is zero-count D010 follow-through. The complete checkpoint run continues;
the corrected editorial public retry uses the next prepared capture.

Setup failures, unsupported int32 delivery, unpublished image-boundary commands,
and the surround-Reverb hypothesis do not count. Repeated manifestations and
follow-through corrections share their original root count. The build's module
ownership guards caught missing owners before the checkpoint; corrections
preserve their semantic groups and all existing size/graph ceilings.

Verification diagnostics are removed after their result is recorded. Permanent
regression tests remain. Desktop assistance engine sources, recipes and runtime
closures are unchanged; no manual **Update AI assets** run is required.

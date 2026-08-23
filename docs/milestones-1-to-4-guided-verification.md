# Milestones 1–4 guided local verification

This is the checked-in local sign-off record for the Milestones 1–4 activation.
It verifies product workflows after the automated gates pass; it is not evidence
for Windows, Safari, fixed-GPU, signing, or owner-host qualification.

Do not replace an observed failure with `not-applicable`. Fix the defect, link
the issue, rebuild, and repeat the affected check. A local sign-off is complete
only when every required row below records `pass` against one build and commit.

## Run identity

Fill this table before starting. Repeat the verification from the beginning if
the build or commit changes, except when a failed row explicitly identifies the
follow-up build that was retested.

| Field | Recorded value |
| --- | --- |
| Date and local time | pending |
| Verifier | pending |
| Commit SHA | pending |
| Browser build identifier | pending |
| Soundscaper Linux package identifier | pending |
| Framescaper Linux package identifier | pending |
| Distribution and version | pending |
| Architecture | pending |
| Desktop/session type | pending |
| Browser and version | pending |
| GPU and driver | pending |
| Audio input/output devices | pending |
| Display configuration | pending |

For every result row, replace `pending` with `pass` or `fail`, add concise
observations under Notes, and add an issue URL or repository issue number when
the result is `fail`. Use `not-applicable` only for explicitly optional hardware
in a row whose Notes explain why.

## Browser — Soundscaper

Open the maintained Soundscaper browser route in a fresh profile.

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| SB-01 | The product opens as Soundscaper, with no Framescaper-only menu or storage surface. | pending | pending | — |
| SB-02 | New, Open, Open Recent, Save, Save As, and import are reachable through existing menus and complete without an unexpected prompt. | pending | pending | — |
| SB-03 | Import representative WAV, MP3, FLAC, and supported video media; verify waveform, playback, seek, and Project Bin behavior. | pending | pending | — |
| SB-04 | Perform trim, split, move, copy/paste, effect, mixer, routing, automation, and track-freeze edits; verify one-step undo and redo. | pending | pending | — |
| SB-05 | Open the menu-owned production surface, edit automation and mixer state, close it, and confirm no new always-visible feature surface appeared. | pending | pending | — |
| SB-06 | Save, reload the page, reopen the project, and verify edits, automation, mixer, and freeze state survive exactly. | pending | pending | — |
| SB-07 | Export audio and `.scape`, reimport both where applicable, and verify duration, channels, audible result, and project metadata. | pending | pending | — |
| SB-08 | Navigate menus, dialogs, and the production surface with the keyboard; verify focus return, labels, status announcements, and 200% zoom. | pending | pending | — |
| SB-09 | Attempt Framescaper proxy, retime, visual-finishing, native-media, and OpenFX routes; Soundscaper must not expose or claim them. | pending | pending | — |

## Browser — Framescaper

Open the maintained Framescaper browser route in a separate fresh profile.

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| FB-01 | The product opens as Framescaper and uses a physically distinct project-library/storage scope from Soundscaper. | pending | pending | — |
| FB-02 | New, Open, Open Recent, Save, Save As, `.scape` import, and media import are reachable through existing menus. | pending | pending | — |
| FB-03 | Author constant, ramp, reverse, and freeze retime from the menu; reset each form and verify one-step undo/redo and unchanged linked-audio timing. | pending | pending | — |
| FB-04 | Seek CFR, NTSC, and VFR sources randomly in source and program views; verify reverse, freeze, ramp, nested-composition, and frame-boundary behavior. | pending | pending | — |
| FB-05 | Generate a proxy, cancel generation, regenerate, detach, relink, and choose Original, Proxy, and Auto; verify progress and adaptive preview selection. | pending | pending | — |
| FB-06 | With a retimed occurrence, verify the selected source-domain proxy frame precedes occurrence retime; preview remains aligned after random seeks. | pending | pending | — |
| FB-07 | Make the original unavailable; preview may use an attested proxy, editing remains possible, and delivery visibly refuses. Relink the exact original and deliver successfully. | pending | pending | — |
| FB-08 | Create and edit dissolve transitions from the menu; compare preview and browser export at start, midpoint, and end frames. | pending | pending | — |
| FB-09 | Through menu-opened workflows, create a still, title, text, shape, solid, adjustment layer, preset, mask/matte, and freeze frame; verify edit, placement, save/reopen, and undo/redo. | pending | pending | — |
| FB-10 | Inspect still and video source color assumptions, override them, apply an SDR Rec.709 grade, and verify deterministic sRGB/Rec.709 export and reimport. | pending | pending | — |
| FB-11 | Run tracking, similarity stabilization, and temporal denoise; verify progress/cancellation, deterministic replay, WebGL2/CPU parity, and that optical flow is never offered as retime interpolation. | pending | pending | — |
| FB-12 | Create caption tracks; import and export SRT, WebVTT, and the supported IMSC 1.1 subset; verify timing/style round trips and that burn-in/mux is not claimed. | pending | pending | — |
| FB-13 | Open Framescaper automation/mixer from the menu; edit lanes and the dialogue chain highpass → gate → EQ → compressor → limiter, with optional profiled noise reduction. | pending | pending | — |
| FB-14 | Export picture and audio, reimport the output, and confirm delivery read the original rather than the proxy and applied the existing loudness target. | pending | pending | — |
| FB-15 | Save, reload, reopen, and verify transitions, color/source interpretation, visual state, processor stacks, motion analyses, captions, automation, and mixer state. | pending | pending | — |
| FB-16 | Navigate all new menu entries and lazy dialogs by keyboard; verify focus return, accessible names, status/progress announcements, cancellation, and 200% zoom. | pending | pending | — |
| FB-17 | Open recognized V25 and V26 custody fixtures; they remain opaque and read-only. No native-media or OpenFX authoring action is reachable. | pending | pending | — |

## Linux desktop — Soundscaper

Install or unpack the current Linux Soundscaper artifact in a clean application
data directory.

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| SD-01 | The packaged runtime reports complete product, version, Electron/Chromium/Node, OS, architecture, package, GPU, and fixture identity. | pending | pending | — |
| SD-02 | Repeat SB-02 through SB-08 in the packaged application. | pending | pending | — |
| SD-03 | Close during a save, reopen, and verify the Soundscaper writer lease, journal recovery, and exact project state. | pending | pending | — |
| SD-04 | Start a second Soundscaper writer; verify admission fencing and exact release without affecting Framescaper. | pending | pending | — |
| SD-05 | Inspect the application data roots and verify no Framescaper catalog, database, media root, lease, or journal is present. | pending | pending | — |

## Linux desktop — Framescaper

Install or unpack the current Linux Framescaper artifact in a separate clean
application data directory.

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| FD-01 | The packaged runtime reports complete product, version, Electron/Chromium/Node, OS, architecture, package, GPU, and fixture identity. | pending | pending | — |
| FD-02 | Repeat FB-02 through FB-17 in the packaged application. | pending | pending | — |
| FD-03 | Seed a V12-only library and verify first open completes the immutable V12→V17 cascade before V18 copy-forward. Interrupt and reopen during each import phase, verify idempotent completion without mutating or deleting V12 or V17, then repeat from an already settled V17 library and confirm V18 does not reopen or rewrite its source lineage. | pending | pending | — |
| FD-04 | Close during a save/publication, reopen, and verify the V18 writer lease, persistent fencing, journal recovery, and exact project state. | pending | pending | — |
| FD-05 | Start a second Framescaper writer; verify admission fencing, draining, renewal, and exact release. | pending | pending | — |
| FD-06 | Inspect the application data roots and verify no Soundscaper catalog, database, media root, lease, or journal is present. | pending | pending | — |

## Paired product isolation

Run both Linux packages concurrently.

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| PI-01 | Create, edit, save, close, and reopen one project in each product while both writers are alive. | pending | pending | — |
| PI-02 | Verify distinct database files, `user_version` values, scopes, media roots, leases, fencing counters, and publication journals. | pending | pending | — |
| PI-03 | Crash one product during publication; the other continues saving and its lease/fence state does not change. | pending | pending | — |
| PI-04 | Open a cross-product `.scape`; supported content reimports explicitly, unsupported content is preserved or refused as documented, and no shared catalog is created. | pending | pending | — |

## Completion record

| Field | Recorded value |
| --- | --- |
| All required rows pass | pending |
| Automated gate log/artifact | pending |
| Browser evidence location | pending |
| Soundscaper Linux evidence location | pending |
| Framescaper Linux evidence location | pending |
| Paired-isolation evidence location | pending |
| Remaining external qualification items | Windows x64; Safari; fixed-GPU; signing; owner-host M3 long-form and M4B2 evidence |
| Verifier conclusion | pending |

Local activation may be declared only when the conclusion records `pass` and
all issue-linked failures have a passing retest. Formal milestone qualification
remains open for every external item named above.

# Soundscaper Stable 1 guided verification

This record admits Soundscaper only. It neither launches, builds, packages, nor
qualifies Framescaper. Foreign-family compatibility is exercised exclusively
with checked-in `.fscape` fixtures under opaque read-only custody and byte-exact
Save Copy. The retained dual-product Milestone 9 campaign remains independent.

Record `pass` or `fail` only with `run:<run-id>`. Use `not-applicable` only for an
approved scope decision cited as `decision:<reference>`. A changed baseline or
candidate starts a new campaign.

Bind the candidate to one immutable `Desktop preview and nightly` tag-push run.
Record that run's exact Git commit, positive GitHub Actions run ID, and the
lowercase SHA-256 of the `SHA256SUMS` bytes inside its `release-inventory`
artifact. Stable lifecycle rehearsal re-reads the admission JSON, verifies the
run's tag, commit, workflow, event, and successful completion, then authenticates
every downloaded target file against that exact inventory. Never substitute a
newer run for the recorded one.

## Run identity

| Field | Recorded value |
| --- | --- |
| Campaign identifier | pending |
| Campaign coordinator | pending |
| Product | soundscaper |
| Stable release | 1.0.0 |
| Release candidate | 1.0.0-rc.1 |
| Release candidate commit SHA | pending |
| Desktop preview workflow run ID | pending |
| Release candidate package inventory SHA-256 | pending |
| Baseline commit SHA | pending |
| Supported-matrix decision | pending |
| Automated gate artifact | pending |
| Evidence root | pending |

## Execution ledger

| Run ID | Date and local time | Verifier | Commit and package | Product and target | Environment/profile | Runtime and hardware | Evidence location |
| --- | --- | --- | --- | --- | --- | --- | --- |
| pending | pending | pending | pending | pending | pending | pending | pending |

## Browser — Soundscaper

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| SB-01 | Open the Soundscaper route and verify its identity, storage scope, menus, and version match the selected Soundscaper release line. | pending | pending | — |
| SB-02 | Exercise New, Open, Open Recent, Save, Save As, media import, and menu reachability without an unexpected prompt. | pending | pending | — |
| SB-03 | Import representative WAV, MP3, FLAC, and supported video media; verify waveform, playback, seek, and Project Bin behavior. | pending | pending | — |
| SB-04 | Exercise trim, split, move, copy/paste, effects, mixer, routing, automation, freeze, and one-step undo/redo. | pending | pending | — |
| SB-05 | Open and close every menu-owned production surface and confirm no feature adds an always-visible surface by default. | pending | pending | — |
| SB-06 | Save, reload, reopen, and verify edits, automation, mixer, routing, and freeze state survive exactly. | pending | pending | — |
| SB-07 | Export audio and `.scape`, reimport both where supported, and verify duration, channels, audible result, and metadata. | pending | pending | — |
| SB-08 | Complete critical workflows by keyboard and screen reader at 200% zoom, with correct focus restoration and announcements. | pending | pending | — |
| SB-09 | Verify proxy, retime, visual-finishing, native-media, OpenFX, capture, and MIDI capabilities are absent from Soundscaper. | pending | pending | — |

## Desktop — Soundscaper

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| SD-01 | On every declared desktop target, verify packaged identity, selected application version, Electron/Chromium/Node, OS, architecture, GPU, and fixture identity. | pending | pending | — |
| SD-02 | Repeat SB-02 through SB-08 in each packaged target and verify browser/desktop behavior parity. | pending | pending | — |
| SD-03 | Close during save, reopen, and verify writer fencing, journal recovery, exact project state, and no partial publication. | pending | pending | — |
| SD-04 | Start a second Soundscaper writer and verify admission fencing, strictly increasing tokens, draining, and exact release. | pending | pending | — |
| SD-05 | Inspect application-data roots and verify Soundscaper creates only its declared family-v1 catalog, database, media, lease, journal, delivery, and model roots. | pending | pending | — |

## Windows packaging — Soundscaper

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| SW-01 | Verify x64 and ARM64 packages report their exact target and selected Soundscaper version rather than a build-host fingerprint. | pending | pending | — |
| SW-02 | Exercise the assisted per-machine installer and no-install ZIP; verify `.aup4`, `.sscape`, and `.scape` association policy is exact. | pending | pending | — |
| SW-03 | Crash during save and verify SSCP application ID, library schema 1, SQLite `user_version` 1, fencing, recovery, and exact state. | pending | pending | — |
| SW-04 | Exercise concurrent Soundscaper writers, higher fencing tokens, exact release, and restart admission on x64 and ARM64. | pending | pending | — |
| SW-05 | Uninstall the per-machine package and verify the local project library, delivery records, models, and user settings survive. | pending | pending | — |

## Native professional tier — Soundscaper

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| SN-01 | For each of the five target rows, verify the promoted professional payload manifest, candidate build result, source pins, and package target agree exactly. | pending | pending | — |
| SN-02 | Verify `soundscaper_professional.node`, its isolated peer, launcher, and authenticated runtime closure stage outside the asar at the manifest-pinned paths. | pending | pending | — |
| SN-03 | Alter each staged professional payload class in turn and verify digest authentication refuses before any plug-in scan, load, or project mutation. | pending | pending | — |
| SN-04 | Run the packaged professional self-test and verify schema, protocol, target, formats, containment, OS-codec state, and payload digests match the promoted build result. | pending | pending | — |
| SN-05 | Confirm native audio, latency, device, scan, and plug-in management remain menu-owned and default-hidden, with typed unavailable reasons. | pending | pending | — |
| SN-06 | Scan platform-appropriate VST3, CLAP, AU, and LV2 fixtures with explicit consent and verify stable IDs, versions, digests, and format ownership. | pending | pending | — |
| SN-07 | Request unsupported format, mode, rate, period, and channel combinations and verify exact typed refusal without substitution. | pending | pending | — |
| SN-08 | Load authenticated test plug-ins, exercise isolation and broker policy, then tamper or quarantine them and verify execution is refused. | pending | pending | — |
| SN-09 | Exercise the authenticated OS audio codec build result on each applicable target and verify no neighbouring target payload is accepted. | pending | pending | — |
| SN-10 | Pull input and output devices during recording, playback, and monitoring; verify captured prefixes commit, loss is reported, and no silence is fabricated. | pending | pending | — |
| SN-11 | Kill the professional peer and isolation launcher during execution; verify project survival, bounded quarantine, exact cleanup, and Web Core fallback. | pending | pending | — |
| SN-12 | Verify source, license, notice, signing, containment, publisher, and five-target promotion evidence is complete before the professional tier is admitted. | pending | pending | — |

## Delivery and interchange — Soundscaper

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| SDL-01 | Deliver WAV, AIFF, BWF, FLAC, and one compressed target and verify sample format, dither, quantize, channel map, resample, and deterministic reports. | pending | pending | — |
| SDL-02 | Exercise EBU R 128, ATSC A/85, and streaming normalization; verify true-peak ceilings and truthful target-missed reporting. | pending | pending | — |
| SDL-03 | Deliver stems and BW64 passthrough; verify incompatible loudness controls are absent or disabled and passthrough bytes remain exact. | pending | pending | — |
| SDL-04 | Deliver authored ADM beds and objects at every supported layout and verify routing, gains, metadata, and conformance results. | pending | pending | — |
| SDL-05 | Deliver an authored programme through binaural rendering and verify two-channel output, declared head model, and limitations. | pending | pending | — |
| SDL-06 | Deliver mastering sequences with gaps and fades; verify exact bounds, missing-region refusal, and capacity preflight before bytes are written. | pending | pending | — |
| SDL-07 | Queue crossed targets and presets; exercise pause, cancel, retry, reorder, and batch reporting while destination grants remain durable. | pending | pending | — |
| SDL-08 | Restart the renderer and application mid-batch; verify durable jobs reconnect or recover exactly, stale claims are fenced, and no partial output is published. Do not claim execution while the application is closed. | pending | pending | — |
| SDL-09 | Reimport delivered WAV, BWF, and BW64 masters and verify duration, channels, sample rate/format, cues, metadata, staged digest, conformance, and atomic destination publication. | pending | pending | — |

## Local assistance — Soundscaper

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| LA-01 | Verify local-model management and assistance are menu-owned, absent in the browser route, and opening them starts no download. | pending | pending | — |
| LA-02 | Install, cancel, resume, and remove a model from the pinned mirror without falling back to an upstream network source. | pending | pending | — |
| LA-03 | Install from an offline folder, tamper one artifact, reconcile the store, and verify exact digest rejection and truthful counts. | pending | pending | — |
| LA-04 | Verify installed notices, provenance, licenses, relocation, missing-blob detection, and editor operation with every model removed. | pending | pending | — |
| LA-05 | Run transcription/captions with exact VAD and ASR choices, review output, and verify language/alignment claims before acceptance. | pending | pending | — |
| LA-06 | Run VAD and speaker diarization, review audible boundaries, accept owned label tracks, and verify one-step undo. | pending | pending | — |
| LA-07 | Review filler, repetition, and silence cleanup proposals; verify opt-in selection, audition without mutation, fenced acceptance, and undo. | pending | pending | — |
| LA-08 | Change project revision and selected media before acceptance; verify stale proposals, reject, and cancellation leave canonical state untouched. | pending | pending | — |
| LA-09 | Exercise guided and advanced workflows and verify one main-owned consent names the exact source, stages, models, and outputs. | pending | pending | — |
| LA-11 | Run dialogue enhancement and D/M/E separation with bounded spooling, exact models, capacity preflight, reviewed publication, and undo. | pending | pending | — |
| LA-12 | Run beat and tempo analysis with the exact admitted Beat-This artifact; verify deterministic points, reviewed labels and tempo choices, disposable custody, and no MIDI state. | pending | pending | — |
| LA-13 | Index a transcript for semantic search; verify bounded chunks, stale-query suppression, exact timeline jumps, digest fencing, disposable indexes, and no implicit model install. | pending | pending | — |
| LA-16 | Cancel or crash every long stage, exhaust storage, corrupt claims, and change fences; verify bounded quiescence, quarantine, cleanup, and no state loss. | pending | pending | — |
| LA-17 | Verify the Soundscaper 7A speech, diarization, enhancement, separation, transcript-search, and Beat-This artifacts, live parity, signed catalog rows, five-target runtimes, immutable publication, packaged canaries, and zero-network privacy evidence. | pending | pending | — |

## Release readiness — Soundscaper

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| REL-01 | Verify the frozen Soundscaper-v1 baseline and candidate match the compatibility register and product release line without changing either schema-family baseline. | pending | pending | — |
| REL-02 | Save and reopen Soundscaper family-v1 through browser, desktop, and Scape format 1. Open checked-in foreign `.fscape` fixtures only as opaque read-only custody, Save Copy, and compare every byte. Verify unsupported pre-release fixtures refuse before traversal or persistence. | pending | pending | — |
| REL-03 | Verify the release claims exactly Windows x64/ARM64, macOS ARM64, and Linux x64/ARM64 across capability, build, package, manifest, and assembler inventories. | pending | pending | — |
| REL-04 | On current and previous Safari on declared Apple hardware, run Soundscaper import, edit, save, reopen, delivery, accessibility, and documented fallback workflows. | pending | pending | — |
| REL-05 | Complete every Soundscaper critical workflow using only the platform screen reader and verify names, roles, focus, announcements, and error recovery. | pending | pending | — |
| REL-06 | Repeat critical workflows keyboard-only at 200% zoom, forced colors, and reduced motion with no clipping, invisibility, or horizontal page scroll. | pending | pending | — |
| REL-07 | Open every committed locale on Soundscaper standalone and embed routes and verify translated, complete, untruncated menus, dialogs, and status text. | pending | pending | — |
| REL-08 | Switch Soundscaper to Arabic and verify shell mirroring, left-to-right timeline time, keyboard navigation, selection edges, and drag directions. | pending | pending | — |
| REL-09 | Generate local diagnostics offline and verify selected version, capability/environment identity, typed errors, storage, delivery, and recovery state without media, transcript, or hidden paths. | pending | pending | — |
| REL-10 | Monitor the packaged application with update checks disabled, enabled offline, repeated manually, and restarted; verify exact network and throttle policy for the selected Soundscaper tag line. | pending | pending | — |
| REL-11 | Upgrade and downgrade Soundscaper candidate packages across the frozen family-v1 baseline; verify projects, stores, settings, models, delivery jobs, and pre-release bytes remain exact. | pending | pending | — |
| REL-12 | Follow the seven shipped Soundscaper documentation topics literally and verify every named menu, dialog, workflow, and path exists and behaves as written. | pending | pending | — |
| REL-13 | Triage Soundscaper campaign defects under the severity policy, require zero critical/high, validate waivers, and bind the release record to source, artifacts, environments, fixtures, and results. | pending | pending | — |
| REL-14 | Rehearse exactly nine Soundscaper packages and five Soundscaper runtime manifests, verify `SHA256SUMS`, install, upgrade, rollback, project survival, and admission closure. | pending | pending | — |

## Scope, security, licensing, and qualification gates

| ID | Check | Result | Notes | Issue |
| --- | --- | --- | --- | --- |
| GAT-01 | Confirm packaged Soundscaper exposes and persists no MIDI capability, project state, device route, import, or export while post-1.0 design remains deferred. | pending | pending | — |
| GAT-05 | Verify Soundscaper VST3, CLAP, AU, and LV2 surfaces are menu-owned and require exact payload/plug-in digests, target compatibility, containment, consent, and non-quarantined state. | pending | pending | — |
| GAT-06 | Verify owner legal approval, source obligations, notices, payload licensing, optional statement signatures, and separate per-target technical readiness are represented truthfully. | pending | pending | — |
| GAT-07 | Audit workload promotion: every accepted Soundscaper workload has a pinned fixture, eligible environment, complete finite metrics, budget evaluation, and retained no-retry raw cohort. | pending | pending | — |
| GAT-08 | Close each claimed fixed-hardware Soundscaper performance profile with complete GPU, driver, power, display, renderer, cadence, and memory evidence; reject software renderers. | pending | pending | — |
| GAT-09 | Verify the Soundscaper release matrix was provisioned before evidence collection, names only Soundscaper cells, and accepts no result from an unregistered environment. | pending | pending | — |
| GAT-10 | Review qualification status and reason against the exact accepted Soundscaper workload set and verify no source-level or pre-campaign evidence is misrepresented as release qualification. | pending | pending | — |

## Completion record

| Field | Recorded value |
| --- | --- |
| All in-scope rows pass | pending |
| Approved scope-reduction decisions | pending |
| Rows recorded blocked, with the blocker named | pending |
| Automated gate log/artifact | pending |
| Hosted qualification metrics artifact | pending |
| Browser evidence location | pending |
| Soundscaper desktop evidence location | pending |
| Soundscaper native evidence location | pending |
| Delivery and interchange evidence location | pending |
| Local assistance evidence location | pending |
| Accessibility evidence location | pending |
| Localization evidence location | pending |
| Compatibility and migration evidence location | pending |
| Security and licensing evidence location | pending |
| Recovery evidence location | pending |
| Release rehearsal evidence location | pending |
| Reviewed decisions recorded, with reviewer | pending |
| Soundscaper Stable 1 release conclusion | pending |

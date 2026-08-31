# Soundscaper release QA checklist

Product: {{PRODUCT}}
Started (UTC): {{UTC_TIMESTAMP}}

This is an owner-operated checklist, not an automated release gate. Only record
what you personally observed. Use `not-run`, `pass`, `fail`, or `n/a`; `n/a`
requires a reason in Notes. Notes should name the package, browser, operating
system, and hardware that were actually tried when those details matter.

Do not release with a known data-loss, security, or primary-workflow failure.
Everything else is an owner decision based on the release's intended audience.

## Core browser workflow

| ID | Check | Result | Notes |
| --- | --- | --- | --- |
| SQA-01 | Open Soundscaper and confirm the product name, version, storage scope, and menus are the intended release. | not-run | |
| SQA-02 | Create a project; exercise Open, Open Recent, Save, and Save As; then close and reopen it. | not-run | |
| SQA-03 | Import representative WAV, MP3, FLAC, and supported video media; inspect the Project Bin and waveform. | not-run | |
| SQA-04 | Play, pause, seek, select, trim, split, move, copy/paste, and confirm one-step undo and redo. | not-run | |
| SQA-05 | Change a representative effect, mixer, routing, automation, and freeze setting; save and verify each survives reopen. | not-run | |
| SQA-06 | Export WAV and a project copy, reimport the results, and check duration, channels, metadata, and audible content. | not-run | |
| SQA-07 | Interrupt or invalidate an operation and confirm the error is understandable, existing work survives, and retry is possible. | not-run | |
| SQA-08 | Complete the main edit/save/export path by keyboard at 200% zoom; spot-check names, focus, and announcements with a screen reader. | not-run | |
| SQA-09 | Open Local Diagnostics from its menu while offline and confirm it reports useful state without exposing media or private paths. | not-run | |

## Conditional packaged and professional workflows

Use `n/a` with a reason for capabilities that are not part of this release or
cannot be exercised on the available machine.

| ID | Check | Result | Notes |
| --- | --- | --- | --- |
| SQA-10 | Install or unpack the desktop build, launch it, confirm target/version identity, and repeat the core create-save-reopen path. | not-run | |
| SQA-11 | Close or crash the packaged app during a save, reopen it, and verify recovery preserves the last completed state without a partial publication. | not-run | |
| SQA-12 | Exercise install, upgrade, rollback, and uninstall as relevant; confirm projects, settings, models, and delivery records survive. | not-run | |
| SQA-13 | Open Native audio and latency from its menu; verify device selection, supported settings, recording/playback, and truthful unavailable errors. | not-run | |
| SQA-14 | Scan and load each supported plug-in format with explicit consent; verify stable identity, isolation, quarantine, and project survival after a plug-in failure. | not-run | |
| SQA-15 | Decode and encode representative OS/native codec media; confirm unsupported combinations are refused rather than silently substituted. | not-run | |
| SQA-16 | Deliver representative masters and stems; reimport them and inspect channel layout, sample format, loudness report, metadata, and atomic publication. | not-run | |
| SQA-17 | Queue, pause, cancel, retry, and resume a delivery across restart; confirm no output is claimed while processing is stopped. | not-run | |
| SQA-18 | From the model-management menu, install or locate a model, cancel/resume once, run one assistance workflow, review before accepting, and undo it. | not-run | |
| SQA-19 | Tamper with or remove a local model and confirm digest rejection, truthful inventory, and normal editor operation without the model. | not-run | |

## Compatibility and presentation

| ID | Check | Result | Notes |
| --- | --- | --- | --- |
| SQA-20 | Try the supported browsers, desktop targets, and locales available to you; record the exact environments and any intentional omissions in Notes. | not-run | |
| SQA-21 | Check forced colors, reduced motion, an RTL locale, and keyboard navigation for clipping, lost focus, or reversed timeline meaning. | not-run | |
| SQA-22 | Open a checked-in foreign `.fscape` fixture only through opaque read-only custody, Save Copy, and verify the copied bytes are unchanged. | not-run | |
| SQA-23 | Follow the shipped Soundscaper help topics literally and confirm every named menu, dialog, and workflow exists. | not-run | |

# Framescaper release QA checklist

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
| FQA-01 | Open Framescaper and confirm the product name, version, storage scope, and menus are the intended release. | not-run | |
| FQA-02 | Create a project; exercise Open, Open Recent, Save, and Save As; then close and reopen it. | not-run | |
| FQA-03 | Import representative image, audio, and video media; inspect the Project Bin, viewer, waveform, and thumbnails. | not-run | |
| FQA-04 | Play, pause, seek, select, trim, split, move, copy/paste, and confirm one-step undo and redo. | not-run | |
| FQA-05 | Change representative effects, transitions, compositing, audio, and timeline settings; save and verify each survives reopen. | not-run | |
| FQA-06 | Export a representative video and project copy, reopen or reimport them, and check duration, streams, metadata, and visible/audible content. | not-run | |
| FQA-07 | Interrupt or invalidate an operation and confirm the error is understandable, existing work survives, and retry is possible. | not-run | |
| FQA-08 | Complete the main edit/save/export path by keyboard at 200% zoom; spot-check names, focus, and announcements with a screen reader. | not-run | |
| FQA-09 | Open Local Diagnostics from its menu while offline and confirm it reports useful state without exposing media or private paths. | not-run | |

## Conditional packaged and finishing workflows

Use `n/a` with a reason for capabilities that are not part of this release or
cannot be exercised on the available machine.

| ID | Check | Result | Notes |
| --- | --- | --- | --- |
| FQA-10 | Install or unpack the desktop build, launch it, confirm target/version identity, and repeat the core create-save-reopen path. | not-run | |
| FQA-11 | Close or crash the packaged app during a save, reopen it, and verify recovery preserves the last completed state without a partial publication. | not-run | |
| FQA-12 | Exercise install, upgrade, rollback, and uninstall as relevant; confirm projects, settings, proxies, and delivery records survive. | not-run | |
| FQA-13 | Create and relink proxies, change speed and retime controls, and confirm visible frame choice and audio behavior survive reopen. | not-run | |
| FQA-14 | Decode representative native media and exercise the native viewer/output path; confirm unsupported media gets a truthful error. | not-run | |
| FQA-15 | Apply an OpenFX effect and GPU-backed operation, then simulate a host failure and confirm isolation, quarantine, fallback, and project survival. | not-run | |
| FQA-16 | Capture from an available source, interrupt once, and confirm the captured prefix, synchronization report, recovery, and cleanup are truthful. | not-run | |
| FQA-17 | Open Web VCR from its menu, capture supported web media with explicit consent, and verify cancellation, provenance, and private-data handling. | not-run | |
| FQA-18 | Deliver representative review and master outputs; reimport them and inspect streams, color, channel layout, metadata, and atomic publication. | not-run | |
| FQA-19 | Queue, pause, cancel, retry, and resume a delivery across restart; confirm no output is claimed while processing is stopped. | not-run | |

## Compatibility and presentation

| ID | Check | Result | Notes |
| --- | --- | --- | --- |
| FQA-20 | Try the supported browsers, desktop targets, and locales available to you; record the exact environments and any intentional omissions in Notes. | not-run | |
| FQA-21 | Check forced colors, reduced motion, an RTL locale, and keyboard navigation for clipping, lost focus, or reversed timeline meaning. | not-run | |
| FQA-22 | Open a checked-in foreign `.sscape` fixture only through opaque read-only custody, Save Copy, and verify the copied bytes are unchanged. | not-run | |
| FQA-23 | Follow the shipped Framescaper help topics literally and confirm every named menu, dialog, and workflow exists. | not-run | |

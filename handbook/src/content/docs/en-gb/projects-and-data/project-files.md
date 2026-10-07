---
title: "Project files"
description: "Choose between the local library, Scape project files, Audacity interchange, SESX import, and rendered backups."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"en-GB"} -->

## Local project library

The editor saves working projects into its local library. In a browser this is
origin-private storage; in the desktop edition it is application data. This is
the convenient working copy, not the only copy you should keep.

## Scape project files

Use **File → Export project file** to save the editing project. Each
product writes its own suffix: Soundscaper saves `.sscape` and Framescaper
saves `.fscape`, and the menu entry names whichever one applies. The format
behind both is the same, so it is the appropriate choice when you need to
preserve mixed-media editing state.

On desktop, imported audio and video remain references to their original files
by default. Keep those files at their original locations when reopening the
project. The local library also keeps editing caches. Recordings and generated
or processed media are bundled because they have no unchanged external original.

Choose **File → Project management → Consolidate media** to bundle referenced
media into the project file. Consolidation saves the project immediately; choose
a destination in the save dialog. Once saved, the consolidated copy can be moved
or shared without its original media files. If any media cannot be consolidated
or the save fails, the editor reports the problem.

Browser exports bundle their media automatically. Before opening a desktop
project with external references in a browser, consolidate it on desktop.

Either product opens either suffix. `.sscape`, `.fscape`, the reserved
`.liscape`, and the older `.scape` files exported before products had their own
suffixes all open everywhere, and saving one from a different product simply
renames it — for example a `Mix.sscape` saved from Framescaper becomes
`Mix.fscape`. Nothing about the project changes with the name.

Importing or opening a Scape copy can encounter an existing project with the
same ID. Use the offered copy workflow when both versions must remain in the
local library.

## Audacity AUP3 and AUP4

Audacity project export is available from **File → Export other**. Choose
**Export AUP3** to target the Audacity 3.7.9 project profile, or **Export AUP4**
for the current Audacity interchange profile. Each export produces a
compatibility report describing conversions, unavailable effects, and omitted
Soundscaper-only state.

Both formats are audio-only. Video is omitted, and browser preferences, undo
history, mixer routing, and the browser's project library are not transferred.
Do not use either as the sole backup of a Soundscaper or Framescaper project.

## Adobe Audition SESX

In the desktop edition, use **File → Open** to import an Adobe Audition `.sesx`
session. Keep its referenced audio files in their relative folder structure
under the session folder, or choose a media folder when prompted. The import
creates a new local project with the supported
audio tracks, clips, placement, trims, simple fades, and static mixer settings.

SESX import is one-way. Audition effects, automation, routing, video, markers,
loops, stretching, linked crossfades, and exact fade curves do not transfer.
Open **File → Delivery Report** after import to review missing media and other
omitted content. Keep the original SESX file and media for future work in Audition.

## Rendered backup

For important work, keep both:

1. A Scape project copy (`.sscape` or `.fscape`) for future editing.
2. A rendered audio or video file that can be played without the editor.

Store those files outside the browser or application data directory.

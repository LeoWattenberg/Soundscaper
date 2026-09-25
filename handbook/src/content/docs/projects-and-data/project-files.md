---
title: Project files
description: Choose between the local library, Scape project files, AUP4, SESX import, and rendered backups.
sidebar:
  order: 2
---

## Local project library

The editor saves working projects into its local library. In a browser this is
origin-private storage; in the desktop edition it is application data. This is
the convenient working copy, not the only copy you should keep.

## Scape project files

Use **File → Export project file** for a lossless portable project. Each
product writes its own suffix: Soundscaper saves `.sscape` and Framescaper
saves `.fscape`, and the menu entry names whichever one applies. The format
behind both is the same, so it is the appropriate choice when you need to
preserve mixed-media editing state.

Either product opens either suffix. `.sscape`, `.fscape`, the reserved
`.liscape`, and the older `.scape` files exported before products had their own
suffixes all open everywhere, and saving one from a different product simply
renames it — for example a `Mix.sscape` saved from Framescaper becomes
`Mix.fscape`. Nothing about the project changes with the name.

Importing or opening a Scape copy can encounter an existing project with the
same ID. Use the offered copy workflow when both versions must remain in the
local library.

## AUP4

AUP4 exists for compatible audio interchange with Audacity. Export produces a
compatibility report describing conversions, unavailable effects, and omitted
Soundscaper-only state.

AUP4 is audio-only. Video is omitted, and browser preferences, undo history,
mixer routing, and the browser's project library are not transferred. Do not
use AUP4 as the sole backup of a Soundscaper or Framescaper project.

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

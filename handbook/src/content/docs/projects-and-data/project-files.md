---
title: Project files
description: Choose between the local library, .scape, AUP4, and rendered backups.
sidebar:
  order: 2
---

## Local project library

The editor saves working projects into its local library. In a browser this is
origin-private storage; in the desktop edition it is application data. This is
the convenient working copy, not the only copy you should keep.

## `.scape`

Use **File → Export project file (.scape)** for a lossless portable project.
The format is shared by Soundscaper and Framescaper and is the appropriate
choice when you need to preserve mixed-media editing state.

Importing or opening a `.scape` copy can encounter an existing project with the
same ID. Use the offered copy workflow when both versions must remain in the
local library.

## AUP4

AUP4 exists for compatible audio interchange with Audacity. Export produces a
compatibility report describing conversions, unavailable effects, and omitted
Soundscaper-only state.

AUP4 is audio-only. Video is omitted, and browser preferences, undo history,
mixer routing, and the browser's project library are not transferred. Do not
use AUP4 as the sole backup of a Soundscaper or Framescaper project.

## Rendered backup

For important work, keep both:

1. A `.scape` project copy for future editing.
2. A rendered audio or video file that can be played without the editor.

Store those files outside the browser or application data directory.

---
title: "Project files"
description: "Choose between the local library, Scape project files, AUP4, and rendered backups."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"en-GB"} -->

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

## Rendered backup

For important work, keep both:

1. A Scape project copy (`.sscape` or `.fscape`) for future editing.
2. A rendered audio or video file that can be played without the editor.

Store those files outside the browser or application data directory.

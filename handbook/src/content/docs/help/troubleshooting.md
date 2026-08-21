---
title: Troubleshooting
description: Resolve common recording, storage, import, and export problems.
sidebar:
  order: 1
---

## A recording input is missing

Check operating-system and browser microphone permissions, then reopen the
device selector. For multitrack recording, make sure every armed track has an
available input assignment.

## A command is disabled

Many commands depend on the current state. Select the required project, track,
clip, or time range and try again. A feature can also be intentionally limited
to Soundscaper or Framescaper.

## An import uses too much memory

Compressed decoding and some large operations can need substantial temporary
memory even though stored project audio is chunked. Close unrelated tabs or
applications, retry with a smaller source, or use the desktop edition when
appropriate.

## A project disappeared from the browser

Confirm that you opened the same browser profile, origin, and product site.
Soundscaper and Framescaper share the library on the same `soundscaper.org`
origin, but another domain, browser profile, or cleared site store has a
different library.

If site data was cleared and no `.scape` export exists, the editor has no cloud
copy to restore.

## AUP4 omitted part of the project

Read the compatibility report. AUP4 carries compatible audio editing state but
omits video and can convert or omit effects and Soundscaper-only mixing state.
Use `.scape` for complete Soundscaper/Framescaper project transfer.

## An export fails or does not play

Retry after confirming that the selected range contains playable material. For
compressed audio or video, verify that the runtime assets can load. After a
successful export, test the actual file in another player.

For unresolved problems, use **Help → Support** to contact the maintainer and
include the product, platform, browser or desktop build, steps, and exact error.

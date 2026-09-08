---
title: "Troubleshooting"
description: "Resolve common recording, storage, import, and export problems."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"en-GB"} -->

## A recording input is missing

Check operating-system and browser microphone permissions, then reopen the
device selector. For multitrack recording, ensure every armed track has an
available input assignment.

## A command is disabled

Many commands depend on the current state. Select the required project, track,
clip, or time range and try again. A feature may also be intentionally limited
to Soundscaper or Framescaper.

## An import uses too much memory

Compressed decoding and certain large operations can require significant temporary
memory, even though stored project audio is chunked. Close unnecessary tabs or
applications, try with a smaller source, or use the desktop edition if suitable.

## A project disappeared from the browser

Verify that you have opened the correct browser profile, origin, and product site.
Soundscaper and Framescaper share the library on the same `soundscaper.org`
origin, but a different domain, browser profile, or cleared site store will have
a separate library.

If site data was cleared and no Scape project export exists, the editor cannot restore
a cloud copy.

## AUP4 omitted part of the project

View the compatibility report. AUP4 preserves compatible audio editing state but
excludes video and may convert or omit effects and Soundscaper-specific mixing state.
Use a Scape project file — `.sscape` or `.fscape`, both compatible with either product — for full project transfer.

## An export fails or does not play

Try again, confirming that the selected range contains playable content. For
compressed audio or video, ensure the runtime assets can load. After a
successful export, test the file in another media player.

For persistent issues, use **Help → Support** to contact the maintainer, including
the product, platform, browser or desktop build, steps taken, and the exact error.
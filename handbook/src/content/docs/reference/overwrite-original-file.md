---
title: Overwrite an imported file on desktop
description: Save the edited project over its original media file in Soundscaper or Framescaper.
sidebar:
  order: 10
---

In the Electron versions of Soundscaper and Framescaper, **File → Overwrite
filename** exports the complete edited project to the original imported media
file. It uses the original file's supported export settings and saves
immediately without opening the export dialog or a file picker. Audio keeps
its source format, sample rate, and channel count. Supported MP4 and WebM video
keeps its source container, dimensions, and frame rate.

Import one media file through **File → Import**, make your edits, then choose
**File → Overwrite filename**. You can repeat this after further edits. A time
selection does not limit the overwrite: it always renders the complete project.
The project keeps its imported media and editing history.

The command is unavailable when the project has no supported original file,
when several originals have been imported, or while importing, recording, or
processing. Browser versions use the ordinary export dialog.

Choose the ordinary **File → Export audio** in Soundscaper or **File → Export
video** in Framescaper when you want to choose another destination or change the
delivery settings. Overwriting replaces the original file's contents; keep a
separate copy if you need the unedited recording.

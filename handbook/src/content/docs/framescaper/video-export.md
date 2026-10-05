---
title: Export video
description: Validate the composed sequence and create an MP4 or WebM delivery.
sidebar:
  order: 3
---

## Before exporting

- Play through the complete sequence and every edit boundary.
- Confirm that visible and soloed tracks produce the intended picture.
- Check that linked audio remains synchronized.
- Confirm the export range and whether captions or audio should be included.

## Create the file

Open the export dialog and select a video format. Framescaper supports MP4 and
WebM delivery through the configured video runtime. Choose the dimensions,
frame rate, and other options appropriate for the destination.

Video encoding is more resource-intensive than ordinary timeline playback.
Keep the editor open until the export reports completion.

## Export audio clips separately {#export-audio-clips}

Choose **File → Export video**, select an audio format such as **WAV**, and set
**Output** to **Individual clips (split by clips)**. The export downloads one
archive containing a file for every audio clip. Video clips are excluded, and each
audio file contains only its own clip, including its trims and clip edits.
Files start at the clip's audible beginning, with no project-position padding
or effect tail. Numbered clip names keep repeated names distinct.

Track effects are included; master effects, mute, and solo do not affect this
export. See [Export clips as separate files](/soundscaper/edit-mix-and-export/#export-clips)
for the shared audio workflow.

## Verify the delivery

Open the exported file in a separate player. Check its duration, first and last
frames, picture orientation, audio synchronization, and expected captions.

The rendered video cannot replace the editable project. Export a `.fscape` copy
as well when you need to preserve the timeline and project media.

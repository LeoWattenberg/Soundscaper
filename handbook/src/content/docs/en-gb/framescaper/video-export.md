---
title: "Export video"
description: "Validate the composed sequence and create an MP4 or WebM delivery."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"en-GB"} -->

## Before exporting

- Play through the entire sequence and every edit boundary.
- Ensure visible and soloed tracks display the correct image.
- Verify that linked audio remains in sync.
- Check the export range and decide whether to include captions or audio.

## Create the file

Open the export dialog and choose a video format. Framescaper supports MP4 and
WebM formats via the configured video runtime. Select the appropriate dimensions,
frame rate, and other options for your destination.

Video encoding is more demanding on resources than regular timeline playback.
Keep the editor open until the export process is complete.

## Export audio clips separately {#export-audio-clips}

Choose **File → Export video**, select an audio format such as **WAV**, and set **Output** to **Individual clips (split by clips)**. The export downloads one archive containing a file for every audio clip. Video clips are excluded, and each audio file contains only its own clip, including its trims and clip edits.

Files start at the clip's audible beginning, with no padding to its project position or effect tail. Numbered clip names keep repeated names distinct.

Track effects are included; master effects, mute, and solo do not affect this export. See [Export clips as separate files](/soundscaper/edit-mix-and-export/#export-clips) for the shared audio workflow.

## Verify the delivery

Open the exported file in a separate player. Check its duration, first and last
frames, image orientation, audio sync, and expected captions.

The rendered video cannot replace the editable project. Remember to export a `.fscape` copy
when you need to keep the timeline and project media intact.
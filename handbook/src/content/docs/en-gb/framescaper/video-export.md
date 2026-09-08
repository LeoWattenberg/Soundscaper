---
title: "Export video"
description: "Validate the composed sequence and create an MP4 or WebM delivery."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"en-GB"} -->

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

## Verify the delivery

Open the exported file in a separate player. Check its duration, first and last
frames, image orientation, audio sync, and expected captions.

The rendered video cannot replace the editable project. Remember to export a `.fscape` copy
when you need to keep the timeline and project media intact.
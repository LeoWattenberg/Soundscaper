---
title: Edit, mix, and export
description: Arrange clips, balance tracks, apply effects, and create a delivery file.
sidebar:
  order: 4
---

## Arrange clips

Select clips or a time range before choosing an edit command. Split creates an
edit boundary at the playhead. Gap-preserving and ripple variants determine
whether later material stays in place or moves to close the removed region.

Use track folders, clip groups, and the Project Bin to keep larger projects
organized. Linked video and audio lanes remain synchronized until explicitly
unlinked.

## Build the mix

Use track gain, pan, mute, and solo controls to balance the project. The Mixer
panel exposes the same project state in a mix-oriented layout. Real-time
effects remain adjustable; destructive or rendered operations create project
changes that can be undone while history is available.

Use the playback meter and loudness analysis to inspect the result. Avoid
treating a meter target as a substitute for listening to the complete export.

## Export

Choose **File → Export audio** for a mixed delivery or **Export selected audio**
when only a selection should be rendered. Soundscaper can also export stems,
labels, and video when the project and runtime support those outputs.

Compressed formats use the FFmpeg runtime. Exact formats and conditional
availability are listed in the [generated format reference](/reference/).

Play the exported file in another application before delivering or deleting
source material.

---
title: Record audio
description: Give the editor input permission, choose routes, and protect a completed take.
sidebar:
  order: 3
---

Recording is available in Soundscaper. Framescaper uses a different capture
workflow and does not expose Soundscaper's audio recording toolset.

## Prepare the input

1. Open the recording-device controls and choose an available input.
2. Allow microphone or capture permission when the browser asks.
3. Turn on input monitoring if you need to inspect the incoming level before
   recording.
4. Check the recording meter and adjust the device or input level to avoid
   clipping.

Browser permission is scoped to the site and device. If no input appears,
review both operating-system and browser permissions.

## Record one or several tracks

For a normal recording, use the **Record** menu or transport recording action.

For multitrack routing, choose **View → Enable multi-track recording**, arm the
tracks you want to record, and assign an input to each armed track. Recording
will not start when no available input is assigned.

Soundscaper also exposes timed, punch/count-in, loop/take, and sound-activated
recording workflows through its menus. Start with a normal take before adding
these conditions.

## After the take

Stop recording and play the new clip before continuing. Wait for the project
status to report that saving is complete. For irreplaceable material, export a
rendered audio copy and a `.scape` project rather than relying only on the
local library.

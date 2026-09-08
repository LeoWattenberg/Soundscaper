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
organized.

### Adjust clip fades {#clip-fades}

Select an audio clip to reveal small triangular handles along the top of its
waveform, directly below the clip header.
Drag the left triangle inward for a fade-in, or the right triangle inward for
a fade-out. The waveform changes as you drag, and the area above the fade
curve becomes darker. The triangles follow the fade boundaries; dragging one
back to its corner removes that fade. Only the clip you drag is changed, even
when several clips are selected.

The handles disappear when you deselect the clip, but the faded waveform and
shading remain. These fades preserve the original audio and stay adjustable
after saving and reopening the project. Release to commit a fade, or press
**Escape** while dragging to cancel. **Undo** reverses one complete drag.
Playback and export use the committed fade settings.

With a selected clip focused, press **Tab** to reach its fade handles. Arrow
keys adjust the duration by 10 milliseconds, or 100 milliseconds with
**Shift**. **Home** removes the fade; **End** extends it across the clip.
For numeric entry, choose **Edit → Audio clips → Clip properties** and
use **Fading**.

## Build the mix

Use track gain, pan, mute, and solo controls to balance the project. The Mixer
panel exposes the same project state in a mix-oriented layout. Real-time
effects remain adjustable; destructive or rendered operations create project
changes that can be undone while history is available.

Use the playback meter and loudness analysis to inspect the result. Avoid
treating a meter target as a substitute for listening to the complete export.

### Reduce sibilance {#reduce-sibilance}

Choose **Effect → Noise removal and repair → De-esser**. Set **Frequency** near
the harsh part of the voice, then lower **Threshold** until the sibilants soften.
**Maximum reduction** limits the cut; start around 6–9 dB. Shorter **Attack**
catches the start of a consonant, while **Release** controls how quickly the
high frequencies recover. Only the upper band is reduced.

### Compress separate frequency bands {#multiband-compression}

Choose **Effect → Volume and compression → Multiband compressor**. The two
crossovers divide the signal into low, mid, and high bands. Each band has its
own threshold, ratio, and output gain. A ratio of 1 leaves that band's dynamics
unchanged. Attack and release apply to all three bands. The crossovers have
gentle, overlapping 6 dB/octave slopes; with all ratios at 1 and band gains at
0 dB, the original signal passes through unchanged.

Both effects link their channels to preserve the stereo balance and are also
available in track and master effect racks. Rack settings are saved with the
project and can be adjusted during playback. **Apply to selection** renders the
effect into the selected audio and supports Undo. Timeline automation is not
available for these two effects.

## Export

Choose **File → Export audio** for a mixed delivery or **Export selected audio**
when only a selection should be rendered. Soundscaper can also export stems and
labels.

Compressed formats use the FFmpeg runtime. Exact formats and conditional
availability are listed in the [generated format reference](/reference/).

Play the exported file in another application before delivering or deleting
source material.

For picture work — composing a sequence, video effects, and an MP4 or WebM
delivery — hand the project to [Framescaper](/framescaper/) and see
[export video](/framescaper/video-export/).

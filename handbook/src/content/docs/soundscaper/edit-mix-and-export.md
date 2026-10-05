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

### Edit a clip’s source {#clip-source-properties}

Choose **Edit → Audio clips → Clip properties** to open the source editor.
The full recording appears behind the clip. Drag the clip’s edges to change
its source in and duration while keeping its start on the project timeline.
The **Normalize** drawer contains clip gain and the peak and loudness actions.

Open **Pitch and tempo** and check **Link pitch and tempo** to change speed
and pitch together. A speed ratio of `1` and a pitch change of `0%` leave the
sound unchanged. A ratio of `2` plays twice as fast and an octave higher;
`0.5` plays half as fast and an octave lower. Editing either linked control
updates the other. Unchecking the link restores the independent pitch setting
while keeping the current speed ratio.

**Ctrl+click** the waveform to add a stretch marker tied to that source sample.
Dragging it changes the timing on either side; the overlay shows both playback
rates. The clip’s controls remain per clip. Selecting source audio and applying
an effect updates every clip that uses that source.

### Edit clips in a spreadsheet {#clip-spreadsheet}

Choose **View → Panels → Clip spreadsheet** to see all clips in the project.
The panel opens below the timeline. Use its panel menu to move it to another
dock, make it float, or close it. Its size and placement are saved with your
workspace. Each row shows a clip's track, timeline position, source file, source offset, duration,
pitch, speed, gain, fades, and playback flags. Times are in seconds, pitch is
in semitones, and speed is a ratio: `1` is normal speed and `2` is twice as fast.

Double-click a cell or select it and press **Enter** to edit its value. Press
**Enter** to apply the edit or **Escape** to cancel. Track and source cells show
their actual IDs. Change the track ID to move a clip to an existing audio track.
Change the source ID or enter a local file path to replace its audio, keeping
its timeline position, duration, speed, and source offset in seconds. The new
file must contain that source range. Reversed and inverted are checkboxes;
select a checkbox cell and press **Space** to toggle it. Clips on locked tracks
and video clips are read-only.

Changing duration trims or extends the source range at the current offset.
Changing speed keeps the source range unless you also paste a duration.
Ungroup or unlink clips before changing their timing here; edit warped clip
timing in the source editor.

Select a cell, drag across a range, or **Shift+click** another cell to extend
the selection. Click a row number or column heading to select the whole row
or column. Use **Ctrl+C** and **Ctrl+V** (**Cmd+C** and **Cmd+V** on macOS) to
exchange the selection with a spreadsheet editor. Values use tabs between
columns and newlines between rows. Pasting starts at the selected cell and
updates existing clips. A paste extending beyond existing rows is rejected.
Press **Escape** with a selection, or click the empty space below the table, to
clear the selection. Pasting with no selection inserts new rows, including in
an empty project. Playback flags copy as `true` or `false` and accept those
values when pasted. New rows follow the table's column
order and need a source file name or source ID. A unique existing track name
places the clip on that track; a new name creates an audio track. Blank track
names use the source name. Blank numeric cells use defaults: position and
offset `0`, speed `1`, pitch and gain `0`, and no fades. Blank duration uses
the remaining audio at the requested speed.

The panel first looks for the source in the project, including the Project
Bin. If it is missing, choose **Load referenced files** and select the audio
files listed in the dialog. Disk paths also need this file selection: pasting
a path does not grant the app access to the file. Selected files must match
the referenced names unambiguously. The panel imports the audio, validates
the source bounds and clip properties, and places the new clips at their
specified positions. **Ctrl+Z** (**Cmd+Z** on macOS) reverses a whole paste in
one step; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) redoes it. A paste
containing an invalid value leaves the clips unchanged.

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

### Use LADSPA effects and Vamp analyzers {#native-audio-plugins}

The desktop app can scan third-party plug-ins only after you allow a format and
one of its folders in **Effect → Plugin Manager**. Scanning is never automatic.
Allow each discovered installation before using it, and install only plug-ins
you trust: native plug-ins run executable code even though Soundscaper hosts
them in supervised helper processes.

LADSPA effects are available on Linux. Open one from **Effect → Audio Plugins**
after enabling it in the manager. Soundscaper builds controls from the LADSPA
ports because this format has no vendor interface. Those control values and the
effect's enabled or bypassed state are saved with the project.

Vamp plug-ins analyze audio instead of changing it. After enabling a Vamp
installation, select an audio track to analyze that track, or leave no audio
track selected to analyze the master mix. A time selection limits the analysis;
otherwise Soundscaper uses the complete project. Choose **Analyze → Vamp
Plugins**, select the analyzer output and its settings, then run it. Soundscaper
adds the returned timestamps as a new label track only after the complete
analysis succeeds, so cancelling or changing the project cannot leave partial
labels behind.

## Export

Choose **File → Export audio** for a mixed delivery or **Export selected audio**
when only a selection should be rendered. Soundscaper can also export stems and
labels.

### Export clips as separate files {#export-clips}

Choose **File → Export audio** and set **Output** to **Individual clips (split
by clips)**. Choose an audio format and press **Export** to download an archive
containing one file for every audio clip across the project's audio tracks.
Each file starts at the clip's audible beginning and ends at its audible end,
without padding it to the project timeline or adding an effect tail. Trims,
clip gain, fades, speed, and pitch edits are included. Overlapping clips stay
separate.

Files use the clip names with numbered prefixes. Unsupported filename
characters are replaced, and the numbers keep repeated clip names distinct.
Track effects are included; master effects, mute, and solo do not affect this
export. Unfreeze frozen tracks first to export their editable clips individually.

Compressed formats use the FFmpeg runtime. Exact formats and conditional
availability are listed in the [generated format reference](/reference/).

Play the exported file in another application before delivering or deleting
source material.

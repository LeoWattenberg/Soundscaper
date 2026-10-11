---
title: Your first motion project
description: Create a composition, animate a layer, and export a saved project.
sidebar:
  order: 2
---

## Create and add a layer {#create-and-add-a-layer}

1. Choose **File → New Composition** and enter a title, dimensions, frame rate,
   and duration in frames.
2. Choose **Layer → New Text** or **Layer → New Solid**. Choose the target
   composition when the project contains several compositions.
3. Open **Layer → Text and Appearance** to edit an existing text layer or a
   shape's fills and strokes. Fonts imported here are retained with the project.

Use **File → Import Media** for image, video, or audio sources. An import that
exceeds the current decoder or memory limits is refused with an explanation;
the original source file remains untouched.

## Animate and preview {#animate-and-preview}

Open **Layer → Properties and Keyframes** to choose a layer property and add
keys at exact frame positions. Curve controls change interpolation; spatial
editing changes position paths. **View → Timeline** opens layer timing,
ordering, grouping, and work-area controls.

Open **View → Composition Preview** to seek or play the composition. Preview
uses retained source media. Unsupported or invalid scene settings produce an
error instead of a substitute image. Close the preview to release its active
rendering resources.

## Save a portable copy {#save-a-portable-copy}

Choose **File → Save** to publish the current revision, then **File → Save Copy**
to download an `.mscape` archive. The archive includes the project and original
media needed to reopen it. Open it with **File → Open** on another device or
from a fresh browser library.

## Render {#render}

Choose **File → Render**. Select a composition, output format, and
frame range. The end frame is excluded: frames 0 through 29 use the range
`0` to `30`. A fractional work area selects its contained integer sample times;
an area with no output samples must be changed before rendering.

Use **Transparent PNG sequence (.tar)** for alpha. Extract the TAR archive to
obtain normal PNG images and timing metadata. MP4 and WebM use the background
color selected in the dialog. Rendering pins the submitted revision so later
edits do not alter an output already in progress. Closing the render dialog
keeps its job running. **File → Render Queue** shows progress, cancellation,
retry of the submitted revision, and completed downloads. Closing the editor
cancels unfinished jobs.

Return to the [Motionscaper handbook](/motionscaper/).

---
title: Motionscaper
description: Create animated compositions and retain editable motion projects locally.
sidebar:
  order: 1
---

Motionscaper is the motion graphics editor in the Scaper family. A project
contains compositions, layers, animation, and retained media. Its project file
extension is `.mscape`.

This is a development release. Start with a copy of important source material
and keep exported project archives alongside your working library.

## Start a composition {#start-a-composition}

Choose **File → New Composition**. The **Layer** menu opens text, shape,
animation, compositing, tracking, expression, and 3D scene tools. **View →
Composition Preview** opens playback; new editing surfaces appear when you
choose them from a menu.

Follow [your first motion project](/motionscaper/first-project/) to create,
animate, save, and render a composition.

## Save and deliver {#save-and-deliver}

**File → Save** publishes a saved revision. **Save Copy** exports the current
snapshot as an `.mscape` archive without publishing a new saved revision.
Imported original media and fonts travel with the archive. The **Project
Library** opens projects retained on this device.

**File → Render** offers transparent PNG frames in a TAR archive,
opaque MP4 or WebM video, and ProRes 4444 when the desktop encoder is available.
PNG sequences exclude audio. Browser video retains authored audio when its
encoder supports the requested format. Native ProRes reports its effective
color and alpha precision in the render dialog. **File → Render Queue** keeps
jobs available across dialog closes and project switches. It retains up to eight
jobs and 128 MiB of browser downloads; each download admits up to 64 MiB. Choose
a streaming file destination for larger output and remove finished jobs to
release retained downloads.

## Link to Framescaper {#link-to-framescaper}

Linked compositions require the separate Framescaper 1.1 development line.
In its **File → Linked compositions** dialog, create a pairing URL. Paste it
into Motionscaper's **File → Send Composition to Framescaper** dialog, connect,
and keep the editors and bridge windows open. Later **Save** operations send
new revisions automatically; **Save Copy** does not.

Framescaper retains each accepted revision and its complete media closure for
offline use. Undo pins a prior revision until you resume updates. Changes to
output size, timing, or the audio grid require an explicit Conform review.
The desktop receiver can instead watch a saved `.mscape` file you select.

## After Effects exchange {#after-effects-exchange}

**File → After Effects Bridge** provides readable scripts and reviews supported
exchange data before importing. `.aep` and `.aepx` files are opened through an
installed copy of After Effects and the bridge scripts. The development bridge
has not yet been qualified against installed After Effects. Review its report;
unsupported scene intent and original media remain preserved in project custody.

The renderer supports SDR color and alpha with 2.5D layers, cameras, lights,
shutter sampling, and depth of field. It does not claim HDR, full 3D meshes,
advanced AI masking, or arbitrary After Effects plug-in compatibility.

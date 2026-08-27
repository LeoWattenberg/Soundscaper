---
title: Import and export
description: Distinguish source media, project files, interchange files, and rendered deliveries.
sidebar:
  order: 1
---

Soundscaper uses different file types for different jobs.

## Source media

Use **File → Import** for audio, video, and labels. The current editor hint lists
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF, and WebM; additional video
containers are supported by the video import path. Availability can depend on
the active product and runtime.

Importing media adds a project-owned source. It does not make the original file
your editable project document.

## Editable project files

- Scape (`.sscape` from Soundscaper, `.fscape` from Framescaper, and either one openable in both) is the portable, full-fidelity project format shared by Soundscaper
  and Framescaper.
- AUP4 is audio-only interchange with Audacity. It is not a full backup of a
  mixed-media Soundscaper project.

See [Project files](/projects-and-data/project-files/) for the consequences of
each choice.

## Rendered deliveries

Audio exports create files intended for listening, publishing, or further
processing. Video exports create MP4 or WebM deliveries. A rendered file does
not retain the editable timeline, routing, effects, or project history.

Consult the [reference section](/reference/) for the generated format and
product-capability tables.

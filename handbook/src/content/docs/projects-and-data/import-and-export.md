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

Compressed audio exports and browser imports support up to one hour or 1 GB
(1,000,000,000 file bytes), whichever limit is reached first. Desktop
file selection and compressed audio import have no fixed file-size or duration
ceiling below the safe integer range. Long jobs read, encode, and save in
chunks; large browser exports require origin-private file storage and enough
free space. Large imports require enough local storage for the decoded audio.
Format structure, decoder support, and available storage can still limit an
import.

The browser tier covers MP3, MP2, FLAC, WavPack, Opus, and Ogg Vorbis. Browser
AAC/M4A support depends on the browser codec. Desktop streaming exports cover
the six bundled formats, with 24-bit FLAC and float32 lossless WavPack. Desktop
imports depend on decoder availability; large MP2 sources use the packet
decoder, while smaller MP2 sources use the utility compatibility tier.

An active job shows a progress bar even when **View → Status bar** is hidden.
Choose **Cancel** beside the bar to stop an import or audio export.

## Editable project files

- Scape (`.sscape` from Soundscaper, `.fscape` from Framescaper, and either one openable in both) is the portable, full-fidelity project format shared by Soundscaper
  and Framescaper.
- AUP3 and AUP4 are audio-only interchange with Audacity. Choose AUP3 to target
  the Audacity 3.7.9 project profile or AUP4 for the current interchange profile.
  Neither is a full backup of a mixed-media Soundscaper project; review the
  compatibility report after export.
- Adobe Audition SESX (`.sesx`) can be opened in the desktop edition to create
  a local project from its referenced audio files. Keep the original session
  and media; SESX export is not available.

See [Project files](/projects-and-data/project-files/) for the consequences of
each choice.

## Rendered deliveries

Audio exports create files intended for listening, publishing, or further
processing. Video exports create MP4 or WebM deliveries. A rendered file does
not retain the editable timeline, routing, effects, or project history.

Consult the [reference section](/reference/) for the generated format and
product-capability tables.

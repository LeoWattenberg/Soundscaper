---
title: "Import and export"
description: "Distinguish source media, project files, interchange files, and rendered deliveries."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"en-GB"} -->

Soundscaper uses different file types for different jobs.

## Source media

Use **File → Import** for audio, video, and labels. The current editor hint lists
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF, and WebM; additional video
containers are supported by the video import path. Availability can depend on
the active product and runtime.

Importing media adds a project-owned source. It does not make the original file
your editable project document.

Compressed audio imports and exports support up to one hour or 1 GB
(1,000,000,000 file bytes), whichever limit is reached first. A one-hour
48 kHz stereo file is supported when it fits that file limit. Long jobs read,
encode, and save in chunks; large browser exports require origin-private file
storage and enough free space. Large imports require persistent local storage
for the decoded audio. PCM formats retain their separate limits.

The browser tier covers MP3, MP2, FLAC, WavPack, Opus, and Ogg Vorbis. Browser
AAC/M4A support depends on the browser codec. Desktop streaming exports cover
the six bundled formats, with 24-bit FLAC and float32 lossless WavPack. Desktop
imports depend on native decoder availability; MP2 uses the smaller utility
compatibility tier. Desktop AAC and compatibility providers retain their
separate limits.

An active job shows a progress bar even when **View → Status bar** is hidden.
Choose **Cancel** beside the bar to stop an import or audio export.

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

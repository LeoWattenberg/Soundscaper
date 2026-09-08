---
title: "Import and export"
description: "Distinguish source media, project files, interchange files, and rendered deliveries."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","targetLocale":"en-GB"} -->

Soundscaper uses different file types for various tasks.

## Source Media

Use **File → Import** for audio, video, and labels. The current editor supports
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF, and WebM; additional video
containers are supported via the video import feature. Availability may depend
on the active product and system.

Importing media adds a project-owned source file. It does not make the original file
your editable project document.

## Editable Project Files

- Scape (`.sscape` from Soundscaper, `.fscape` from Framescaper, and either one compatible with both) is the portable, high-fidelity project format used by
  both Soundscaper and Framescaper.
- AUP4 is an audio-only format for exchanging projects with Audacity. It is not a comprehensive backup of a
  multimedia Soundscaper project.

For more information, see [Project Files](/projects-and-data/project-files/).

## Rendered Deliverables

Audio exports produce files optimised for listening, publishing, or additional
processing. Video exports create MP4 or WebM files. Rendered files do
not preserve the editable timeline, routing, effects, or project history.

Refer to the [reference section](/reference/) for detailed format and
product capability information.
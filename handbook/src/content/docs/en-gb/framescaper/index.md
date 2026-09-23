---
title: "Framescaper"
description: "Arrange video, composite picture, and deliver a local-first video project."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fe5df8f699907289847a5d9022c094e32168b502a532ebdf7708436a99db38b7","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fe5df8f699907289847a5d9022c094e32168b502a532ebdf7708436a99db38b7","targetLocale":"en-GB"} -->

Framescaper is the video-focused view of the shared editor. It emphasises video
preview, source monitoring, picture effects, compositing, nested sequences, and
multicamera work.

Soundscaper and Framescaper open each other’s project files: `.sscape`,
`.fscape`, and the older `.scape` all work in both. Use Soundscaper for
recording and detailed audio production, then hand the project back to
Framescaper for picture work.

## What lives where

Framescaper owns picture: video import, the Source Monitor and Video Preview,
picture effects, geometry and compositing, nested sequences, multicamera work,
and video delivery. Linked picture and audio lanes stay synchronised here until
you unlink them.

Soundscaper owns sound: audio recording, effects and analysis, mixing, and audio
delivery. Framescaper uses a different capture workflow and does not expose
Soundscaper's audio recording toolset, so record in Soundscaper and bring the
project back. The step-by-step [guides](/guides/) are written and verified
against Soundscaper, and cover the audio side of a video project too.

## Recommended path

1. [Create a first Framescaper project](/framescaper/first-project/).
2. [Prepare and export video](/framescaper/video-export/).
3. Review [project-file and backup behaviour](/projects-and-data/project-files/).

Open the browser editor at
[soundscaper.org/framescaper/en](https://soundscaper.org/framescaper/en/).

For desktop assistance, see [local processing, models, and plugins](/help/local-processing/).

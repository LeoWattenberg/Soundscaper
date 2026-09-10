---
title: "Framescaper"
description: "Arrange video, composite picture, and deliver a local-first video project."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","targetLocale":"en-GB"} -->

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
3. Review [project-file and backup behavior](/projects-and-data/project-files/).

Open the browser editor at
[soundscaper.org/framescaper/en](https://soundscaper.org/framescaper/en/).

---
title: "Storage, backups, and privacy"
description: "Understand local-first storage and protect projects from browser or device loss."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"en-GB"} -->

## What local-first means

Projects, recordings, and imported media are processed and stored on your
device. The editor does not require an account or synchronise projects to a
Soundscaper service.

On the web, audio and media use the browser's origin-private file system when
available, with IndexedDB fallbacks. Soundscaper requests persistent storage,
but the browser decides whether to grant it.

## What can remove a project

- Clearing site data removes the browser's local project library.
- Private or restricted browser contexts can fall back to temporary memory.
- Browser quota and eviction policies remain authoritative.
- Removing desktop application data manually removes its local library.
- A device or storage failure can remove every local copy on that device.

Uninstalling a packaged desktop build is designed to preserve its library, but
that is not a backup strategy.

## Backup routine

At useful milestones and before clearing or migrating storage:

1. Wait for local saving to complete.
2. Export a Scape project file (`.sscape` or `.fscape`).
3. Export and play a rendered delivery.
4. Copy both to storage outside the editor's local data.

Use AUP4 in addition when Audacity interchange matters, not instead of the
Scape project copy.

## Documentation-site privacy

This handbook is served as static files and uses browser-local search. The V1
site does not add an analytics service or an AI/search backend.

The full [Soundscaper and Framescaper privacy policy](https://soundscaper.org/privacy/en/)
also covers application delivery, device permissions, optional downloads,
desktop update checks, and Framescaper Web VCR connections.

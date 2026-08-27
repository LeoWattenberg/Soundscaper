---
title: Storage, backups, and privacy
description: Understand local-first storage and protect projects from browser or device loss.
sidebar:
  order: 3
---

## What local-first means

Projects, recordings, and imported media are processed and stored on your
device. The editor does not require an account or synchronize projects to a
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

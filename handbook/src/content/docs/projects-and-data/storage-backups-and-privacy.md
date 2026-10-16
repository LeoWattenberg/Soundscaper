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

## Sharing audio through audio.com {#sharing-audio-through-audiocom}

In Soundscaper, choose **Window → audio.com** to open the optional search and
upload panel. Connect your audio.com account to search published audio, listen
to previews, or upload audio files. The panel starts hidden and does not send
requests to audio.com just because the editor opens.

Expand **Upload to audio.com**, choose or drop supported audio files, then
choose **Publish** beside a queued file. Review the title, category, license,
visibility and download permission, and confirm that you have the rights to
share the audio. Soundscaper accepts files up to 100 MB through this panel.
Files begin unlisted with all rights reserved and downloads disabled.
Anyone with the link can listen to unlisted audio; it is not private.

The public audio.com API does not expose Audacity project upload or retrieval.
Sharing an audio file does not back up its editable project. Keep exporting
Scape and AUP4 files for project backups and interchange. The panel also does
not import transcoded previews as editable originals.

### Audiocity storage servers {#audiocity-storage-servers}

A self-hosted Soundscaper deployment can configure this panel to use an
Audiocity server instead. The panel names the server and shows its address
before you connect. Sign in with that server's account.

When the server advertises whole-file project storage, expand **Project
archives** to upload a standalone AUP3 or AUP4 export. Close the file in Audacity
first so its latest changes are saved in the file. Each upload creates a
separate stored project, up to 100 MB or the server's lower limit. Choose
**Refresh projects**, then **Download project** to retrieve a completed archive.
Open the downloaded file through **File → Open** to edit it.

This stores the selected exported file. It does not automatically save the
current editor project, merge edits, or retrieve Audacity's native block-based
cloud snapshots. Keep a local project backup and verify downloaded projects.

## Documentation-site privacy

This handbook is served as static files and uses browser-local search. The V1
site does not add an analytics service or an AI/search backend.

The full [Soundscaper and Framescaper privacy policy](https://soundscaper.org/privacy/en/)
also covers application delivery, device permissions, optional downloads,
desktop update checks, and Framescaper Web VCR connections.

---
title: Web or desktop
description: Understand how browser and packaged desktop editions store projects and access files.
sidebar:
  order: 2
---

Both editions process projects locally. Their storage and file access differ.

## Web editor

The browser edition keeps projects, recordings, and imported media in
origin-private browser storage. It does not upload a project to a Soundscaper
account, and no account is required.

Use the web editor when you want immediate access without installing an app.
Remember that browser storage remains subject to browser quota and eviction
rules. Clearing site data removes the local project library.

## Desktop preview

Packaged desktop previews keep an autosaved local library inside the desktop
application. They bundle the editor runtime and released translations for
offline editing.

Current preview packages may be unsigned or ad-hoc signed. Windows SmartScreen
or macOS Gatekeeper can therefore display an unknown-developer warning. Treat a
preview build as preview software rather than a signed stable release.

Opening an `.aup4` file imports an independent project into the desktop
library. Later edits do not rewrite the file you opened. **Save** updates the
library copy; **Save As** creates a new Audacity interchange file.

## Projects do not move automatically

The browser and desktop libraries are separate. Move a project deliberately:

- Use `.scape` for the full Soundscaper/Framescaper project.
- Use AUP4 when you specifically need audio interchange with Audacity.
- Export rendered audio or video as a durable playback copy.

See [Project files](/projects-and-data/project-files/) before deleting browser
site data or desktop application data.

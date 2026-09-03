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

Desktop packages are unsigned. macOS applies only the identity-free ad-hoc code
seal its loader needs to execute Electron and native binaries; that seal makes
no publisher or trust claim. Windows SmartScreen or macOS Gatekeeper can
therefore display an unknown-developer warning for preview and stable packages.

Opening an `.aup4` file imports an independent project into the desktop
library. Later edits do not rewrite the file you opened. **Save** updates the
library copy; **Save As** creates a new Audacity interchange file.

## Phones and tablets

The web editor keeps its desktop layout on every screen, but below 900px wide
(a phone, or a tablet held upright) it folds the chrome into drawers so the
timeline keeps the room:

- The **Menu** button at the top left opens a drawer with the full application
  menu, the project tabs, the action bar, and the tool toolbar. Play, stop,
  record, and search stay in the bar. Choosing a command closes the drawer.
- Track headers slide in over the lanes from the **Track headers** handle in the
  timeline's top-left corner, or from **View › Track headers**. Tapping the
  lanes or pressing Escape puts them away again.
- The introduction above the editor is collapsed by default on narrow screens;
  **Show introduction** brings it back.

**Edit › Preferences › Appearance › Layout** switches between Automatic,
Compact, and Desktop, so a small window on a desktop can keep the desktop
chrome and a wide tablet can opt into the drawers.

## Projects do not move automatically

The browser and desktop libraries are separate. Move a project deliberately:

- Use a Scape project file — `.sscape` from Soundscaper, `.fscape` from Framescaper — for the full project.
- Use AUP4 when you specifically need audio interchange with Audacity.
- Export rendered audio or video as a durable playback copy.

See [Project files](/projects-and-data/project-files/) before deleting browser
site data or desktop application data.

---
title: Editor skins
description: Choose a visual skin or try one temporarily through a URL.
---

Skins change the editor's colors, fonts, borders, and decorative backgrounds.
They are available in Soundscaper and Framescaper. Each product remembers its
own choice. Workspaces continue to control the arrangement of panels and tools.

## Choose a skin {#choose-a-skin}

Open **Edit → Preferences → Appearance** and select a skin:

- **Default** keeps the original editor design.
- **Sakura** combines cherry blossoms, pink accents, and rounded lettering.
- **Lilac** uses cool purples and layered violet textures.
- **Techno** combines blue circuit graphics with monospaced lettering.

Choose **Light**, **Dark**, or **Follow system theme** separately. Each skin has
both light and dark versions. **Clip style** remains a separate choice; the
Colorful palette is coordinated with each skin while keeping clip colors distinct.

High contrast takes priority over skin decoration. Turning high contrast off
restores the selected skin. Changing a skin never changes clip audio, project
content, or workspace layout.

## Try a skin from a link {#try-a-skin-from-a-link}

Add `?useskin=sakura` to an editor URL to temporarily preview Sakura. Use
`default`, `sakura`, `lilac`, or `techno` as the value. If the URL already has a
query parameter, append `&useskin=sakura` instead. An unknown value is ignored.

A URL preview does not replace your saved skin, even if you change another
preference. Reloading the preview URL keeps previewing it; visiting without the
parameter uses your saved choice. The parameter does not choose light or dark.

In **Preferences → Appearance**, choose **Keep this skin** to save the preview,
or **End preview** to return to your saved skin. Selecting any skin also saves
that choice and ends the preview. These actions remove only the skin parameter
from the current URL, without reloading the editor.

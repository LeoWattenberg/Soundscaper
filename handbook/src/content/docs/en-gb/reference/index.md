---
title: "Reference"
description: "Generated commands, shortcuts, formats, effects, and product capability tables."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"27ac617a3293f4d301daf72bed0b9f3e9127f4516531c320703c36e7afe8658c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"27ac617a3293f4d301daf72bed0b9f3e9127f4516531c320703c36e7afe8658c","targetLocale":"en-GB"} -->

Reference pages are generated from reviewed runtime registries and committed to
the repository. They describe implemented behaviour, not roadmap entries or the
mere presence of source files and tests.

Use this section to answer questions such as:

- Which default shortcut invokes a command?
- Is a command available in Soundscaper, Framescaper, or both?
- Which audio and video formats can be exported?
- What does an effect's parameter default to, and what values will it accept?
- Which effects can run while audio plays, and which need a selection?
- Which local assistance workflows exist, and which models do they require?
- Which panels does each workspace display?
- Which languages, browsers, and desktop packages are built and tested?
- Which features depend on a product, platform, or FFmpeg runtime?

Generated pages include their source provenance and are checked for drift in
the repository quality gate.

The hand-written [Macro programs](/reference/macro-programs/) page documents the JavaScript API a macro program runs against. [Overwrite an imported file on desktop
](/reference/overwrite-original-file/) describes the Electron File command shared by both products. Their behaviour is checked by the editor’s tests.

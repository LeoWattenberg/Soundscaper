---
title: "Import a export"
description: "Rozlište zdrojová média, projektové soubory, výměnné soubory a vykreslené dodávky."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","targetLocale":"cs"} -->

Soundscaper používá různé typy souborů pro různé úkoly.

## Zdrojová média

Použijte **Soubor → Importovat** pro audio, video a štítky. Aktuální nápověda editoru uvádí
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF a WebM; další video
kontejnery jsou podporovány cestou pro import videa. Dostupnost může záviset na
aktivním produktu a runtime.

Importování médií přidá zdroj vlastněný projektem. Neznamená to, že původní soubor
bude vaším editovatelným projektovým dokumentem.

## Editovatelné soubory projektu

- Scape (`.sscape` od Soundscaperu, `.fscape` od Framescaperu a oba formáty lze otevřít v obou aplikacích) je přenosný formát projektu s plnou věrností sdílený Soundscaperem
  a Framescaperem.
- AUP4 je audio-jený výměnný formát s Audacity. Není to plná záloha multimediálního projektu Soundscaperu.

Viz [Soubory projektu](/projects-and-data/project-files/) pro důsledky
každého výběru.

## Vykreslené dodávky

Audio exporty vytvářejí soubory určené k přehrávání, publikování nebo dalšímu
zpracování. Video exporty vytvářejí dodávky MP4 nebo WebM. Vykreslený soubor
neuchovává editovatelnou časovou osu, směrování, efekty nebo historii projektu.

Podrobnosti naleznete v [referenční sekci](/reference/) pro generovaný formát a
tabulkové produktové schopnosti.
---
title: "Import a export"
description: "Rozlište zdrojová média, projektové soubory, výměnné soubory a vykreslené dodávky."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"cs"} -->

Soundscaper používá různé typy souborů pro různé úkoly.

## Zdrojová média

Použijte **Soubor → Importovat** pro audio, video a štítky. Aktuální nápověda
editoru uvádí AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF a WebM;
další video kontejnery jsou podporovány cestou pro import videa. Dostupnost může
záviset na aktivním produktu a runtime.

Importování médií přidá zdroj vlastněný projektem. Neznamená to, že původní soubor
bude vaším editovatelným projektovým dokumentem.

Export komprimovaného zvuku a import v prohlížeči podporují až jednu hodinu nebo 1 GB (1 000 000 000 bajtů souboru), podle toho, který limit nastane dříve. Výběr souborů na počítači a import komprimovaného zvuku nemají pevný limit velikosti ani délky pod hranicí bezpečného rozsahu celých čísel. Dlouhé úlohy čtou, kódují a ukládají po částech; velké exporty v prohlížeči vyžadují úložiště souborů soukromé pro původ a dostatek volného místa. Velké importy potřebují dost místního úložiště pro dekódovaný zvuk. Import může omezit také struktura formátu, podpora dekodéru a dostupné úložiště.

Prohlížeč podporuje MP3, MP2, FLAC, WavPack, Opus a Ogg Vorbis. Podpora AAC/M4A závisí na kodeku prohlížeče. Streamovací exporty v počítačové edici pokrývají šest přibalených formátů a také bezztrátový 24bitový FLAC a float32 WavPack. Importy v počítačové edici závisí na dostupných dekodérech; velké zdroje MP2 používají paketový dekodér, menší zdroje MP2 vrstvu kompatibility nástroje.

Aktivní úloha zobrazuje ukazatel průběhu, i když je **Zobrazit → Stavový řádek** skrytý. Import nebo export zvuku zastavíte volbou **Zrušit** vedle ukazatele.

## Editovatelné soubory projektu

- Scape (`.sscape` od Soundscaperu, `.fscape` od Framescaperu a oba formáty lze
  otevřít v obou aplikacích) je přenosný formát projektu s plnou věrností
  sdílený Soundscaperem a Framescaperem.
- AUP3 a AUP4 umožňují výměnu zvuku s Audacity. AUP3 cílí na profil projektu Audacity 3.7.9, AUP4 na aktuální výměnný profil. Ani jeden není úplnou zálohou multimediálního projektu Soundscaperu; po exportu zkontrolujte zprávu o kompatibilitě.
- Počítačová edice může otevřít relace Adobe Audition SESX (`.sesx`) a vytvořit místní projekt z odkazovaných zvukových souborů. Ponechte si původní relaci i média; export do SESX není k dispozici.

Viz [Soubory projektu](/projects-and-data/project-files/) pro důsledky
každého výběru.

## Vykreslené dodávky

Audio exporty vytvářejí soubory určené k přehrávání, publikování nebo dalšímu
zpracování. Video exporty vytvářejí dodávky MP4 nebo WebM. Vykreslený soubor
neuchovává editovatelnou časovou osu, směrování, efekty nebo historii projektu.

Podrobnosti naleznete v [referenční sekci](/reference/) pro generovaný formát a
tabulkové produktové schopnosti.

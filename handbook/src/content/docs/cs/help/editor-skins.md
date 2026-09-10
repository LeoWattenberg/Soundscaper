---
title: "Vzhledy editoru"
description: "Vyberte vizuální vzhled nebo jej dočasně vyzkoušejte pomocí URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"cs"} -->

Skins mění barvy, písma, okraje a dekorativní pozadí editoru.
Jsou k dispozici v aplikacích Soundscaper a Framescaper. Každý produkt si
zapamatuje vlastní volbu. Pracovní prostory nadále řídí uspořádání panelů a nástrojů.

## Vyberte skin {#choose-a-skin}

Otevřete **Upravit → Předvolby → Vzhled** a vyberte skin:

- **Výchozí** zachovává původní design editoru.
- **Sakura** kombinuje květy třešňového stromu, růžové akcenty a zaoblené písmo.
- **Lilac** používá chladné fialové odstíny a vrstvené fialové textury.
- **Techno** kombinuje modré grafické prvky obvodových obvodů s písmem se stálým písmem.

Zvlášť vyberte **Světlý**, **Tmavý** nebo **Sledovat systémové téma**. Každý skin má
světlou i tmavou verzi. **Styl klipů** zůstává samostatnou volbou; paleta Colorful je
sladěná s každým skinem, přičemž barvy klipů zůstávají odlišné.

Vysoký kontrast má přednost před dekorací skinu. Vypnutí vysokého kontrastu
obnoví vybraný skin. Změna skinu nikdy nemění zvuk klipů, obsah projektu
ani rozložení pracovního prostoru.

## Vyzkoušejte skin z odkazu {#try-a-skin-from-a-link}

Přidejte `?useskin=sakura` do URL editoru pro dočasné náhledy Sakura. Použijte
`default`, `sakura`, `lilac`, nebo `techno` jako hodnotu. Pokud URL již má
parametr dotazového řetězce, připojte místo toho `&useskin=sakura`. Neznámá hodnota je ignorována.

Náhled URL nenahrazuje váš uložený skin, i když změníte jinou
předvolbu. Obnovení URL náhledu pokračuje v jeho náhledu; návštěva bez
parametru používá vaši uloženou volbu. Parametr nevolí světlý nebo tmavý režim.

V **Předvolby → Vzhled** vyberte **Ponechat tento skin** pro uložení náhledu,
nebo **Ukončit náhled** pro návrat k vašemu uloženému skinu. Výběr jakéhokoli skinu také uloží
tuto volbu a ukončí náhled. Tyto akce odeberou pouze parametr skinu
z aktuální URL, aniž by se editor znovu načítal.

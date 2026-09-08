---
title: "Úložiště, zálohy a soukromí"
description: "Pochopte místní úložiště a chraňte projekty před ztrátou prohlížeče nebo zařízení."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"cs"} -->

## Co znamená místní přístup

Projekty, nahrávky a importovaná média jsou zpracovávána a ukládána na vašem zařízení. Editor nevyžaduje účet ani nesynchronizuje projekty se službou Soundscaper.

Na webu používají zvuky a média systém souborů s původem v prohlížeči, pokud je k dispozici, s IndexDB jako zálohou. Soundscaper požaduje trvalé úložiště, ale rozhodnutí, zda ho udělit, je na prohlížeči.

## Co může odstranit projekt

- Vymazání dat webu odstraní místní knihovnu projektů prohlížeče.
- Soukromé nebo omezené kontexty prohlížeče mohou spadnout do dočasné paměti.
- Kvóty a zásady vyřazení prohlížeče zůstávají autoritativní.
- Ruční odstranění dat desktopové aplikace odstraní její místní knihovnu.
- Porucha zařízení nebo úložiště může odstranit všechny místní kopie na daném zařízení.

Odinstalace balené desktopové verze je navržena tak, aby zachovala její knihovnu, ale to není zálohovací strategie.

## Rutina zálohování

V užitečných milnících a před vymazáním nebo migrací úložiště:

1. Počkejte, až se místní ukládání dokončí.
2. Exportujte soubor projektu Scape (`.sscape` nebo `.fscape`).
3. Exportujte a přehrávejte vykreslenou dodávku.
4. Zkopírujte oba do úložiště mimo místní data editoru.

Použijte AUP4 navíc, když je důležitá výměna Audacity, ne místo kopie projektu Scape.

## Soukromí na dokumentačním webu

Tento návod je poskytován jako statické soubory a používá vyhledávání v prohlížeči. Stránka V1 nepřidává službu analýzy ani backend AI/search.

Celá [Zásada ochrany soukromí Soundscaper a Framescaper](https://soundscaper.org/privacy/en/) také pokrývá doručování aplikací, oprávnění zařízení, volitelné stahování, kontroly aktualizací pro desktop a připojení Framescaper Web VCR.
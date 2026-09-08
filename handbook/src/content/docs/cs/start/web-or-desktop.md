---
title: "Web nebo desktop"
description: "Pochopte, jak prohlížečové a balené desktopové edice ukládají projekty a přistupují k souborům."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"cs"} -->

Obě edice zpracovávají projekty lokálně. Jejich úložiště a přístup k souborům se liší.

## Webový editor

Prohlížečová edice ukládá projekty, nahrávky a importovaná média do originálně soukromého úložiště prohlížeče. Nepřenosí projekt na účet Soundscaper a nevyžaduje žádný účet.

Použijte webový editor, když chcete okamžitý přístup bez instalace aplikace. Mějte na paměti, že úložiště prohlížeče podléhá kvótám a pravidlům odstranění prohlížeče. Vymazání dat stránky odstraní místní knihovnu projektů.

## Desktopová náhled

Balené desktopové náhledy uchovávají automaticky uloženou místní knihovnu uvnitř desktopové aplikace. Obsahují editor runtime a vydané překlady pro offline úpravy.

Desktopové balíčky nejsou podepsány. macOS používá pouze identitu bez reklamního kódu, který jeho načítací program potřebuje k provedení Electron a nativních binárních souborů; toto pečeť nedělá žádný tvrzení o vydavateli nebo důvěře. Windows SmartScreen nebo macOS Gatekeeper může proto zobrazit upozornění na neznámého vývojáře pro náhled a stabilní balíčky.

Otevření souboru `.aup4` importuje nezávislý projekt do desktopové knihovny. Pozdější úpravy nepřepracovávají soubor, který jste otevřeli. **Uložit** aktualizuje kopii knihovny; **Uložit jako** vytvoří nový soubor Audacity interchange.

## Telefony a tablety

Webový editor zachovává svůj desktopový layout na každém displeji, ale pod 900px širokým (telefon, nebo tablet držený na výšku) skládá chrome do šuplíků, takže časová osa si ponechá prostor:

- Tlačítko **Menu** v levém horním rohu otevírá šuplík s celým aplikačním menu, kartami projektu, akční lištou a nástrojovou lištou. Přehrát, zastavit, nahrávat a hledat zůstávají v liště. Zvolení příkazu zavře šuplík.
- Záhlaví tratí se posouvají přes uličky z rukojeti **Záhlaví tratí** v levém horním rohu časové osy, nebo z **Zobrazit › Záhlaví tratí**. Klepnutí na uličky nebo stisknutí klávesy Escape je opět uklidí.
- Úvod nad editorem je na úzkých obrazovkách ve výchozím nastavení složený; **Zobrazit úvod** ho vrátí.

**Upravit › Předvolby › Vzhled › Rozložení** přepíná mezi Automatické, Kompaktní a Desktop, takže malé okno na desktopu si může ponechat desktopové chrome a široký tablet se může rozhodnout pro šuplíky.

## Projekty se nepřesouvají automaticky

Knihovny prohlížeče a desktopu jsou oddělené. Přesuňte projekt záměrně:

- Použijte soubor projektu Soundscaper - `.sscape`, Framescaper - `.fscape` pro celý projekt.
- Použijte AUP4, když potřebujete specificky zvukový interchange s Audacity.
- Exportujte vykreslený zvuk nebo video jako trvalou kopii pro přehrávání.

Viz [Soubor projektu](/projects-and-data/project-files/) před vymazáním dat prohlížeče nebo dat desktopové aplikace.
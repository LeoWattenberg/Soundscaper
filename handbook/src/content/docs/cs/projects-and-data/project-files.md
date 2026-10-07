---
title: "Soubory projektu"
description: "Vyberte si mezi místní knihovnou, soubory Scape, výměnou s Audacity, importem SESX a vykreslenými zálohami."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"cs"} -->

## Místní knihovna projektů

Editor ukládá pracovní projekty do své místní knihovny. V prohlížeči se jedná o úložiště specifické pro původ; v desktopové edici se jedná o data aplikace. Toto je pohodlná pracovní kopie, nikoli jediná kopie, kterou byste měli uchovávat.

## Soubory projektů Scape

V počítačové edici zůstávají importované zvukové a video soubory ve výchozím nastavení odkazy na původní soubory. Při opětovném otevření projektu ponechte soubory v původním umístění. Místní knihovna uchovává také mezipaměti úprav. Nahrávky a vytvořená či zpracovaná média jsou součástí projektu, protože nemají nezměněný externí originál.

Zvolte **Soubor → Správa projektu → Konsolidovat média**, chcete-li odkazovaná média zabalit do souboru projektu. Konsolidace projekt ihned uloží; v dialogu uložení zvolte cílové umístění. Uloženou konsolidovanou kopii lze přesunout nebo sdílet bez původních mediálních souborů. Pokud některé médium nelze konsolidovat nebo se uložení nezdaří, editor problém oznámí.

Exporty z prohlížeče média automaticky zabalí. Před otevřením počítačového projektu s externími odkazy v prohlížeči jej v počítačové edici konsolidujte.


Použijte **Soubor → Exportovat soubor projektu** k uložení upravovaného projektu. Každý produkt přidává svůj vlastní příponu: Soundscaper ukládá `.sscape` a Framescaper ukládá `.fscape`, a název položky nabídky je vždy ten, který se vztahuje. Formát za oběma je stejný, takže je to vhodná volba, když potřebujete zachovat stav smíšeného média.

Buď produkt otevře libovolnou příponu. `.sscape`, `.fscape`, vyhrazený `.liscape` a starší `.scape` soubory exportované před tím, než produkty získaly své vlastní přípony, se otevírají všude, a uložení jednoho z jiného produktu pouze změní jeho název - například `Mix.sscape` uložený z Framescaperu se stane `Mix.fscape`. Nic se nezmění na projektu samotném.

Při importu nebo otevírání kopie Scape může dojít ke střetu s existujícím projektem se stejným ID. Použijte nabízený pracovní postup kopie, pokud musí obě verze zůstat v místní knihovně.

## Audacity AUP3 a AUP4

Export projektů Audacity najdete v nabídce **Soubor → Exportovat ostatní**. Zvolte **Exportovat AUP3** pro profil projektu Audacity 3.7.9 nebo **Exportovat AUP4** pro aktuální výměnný profil Audacity. Každý export vytvoří zprávu o kompatibilitě popisující převody, nedostupné efekty a vynechaný stav specifický pro Soundscaper.

Oba formáty obsahují pouze zvuk. Video se vynechává a nepřenášejí se předvolby prohlížeče, historie vrácení změn, směrování mixážního pultu ani knihovna projektů prohlížeče. Nepoužívejte žádný z nich jako jedinou zálohu projektu Soundscaperu nebo Framescaperu.

## Adobe Audition SESX

V počítačové edici použijte **Soubor → Otevřít** k importu relace Adobe Audition `.sesx`. Odkazované zvukové soubory ponechte v odpovídající struktuře podsložek pod složkou relace, případně po výzvě zvolte složku médií. Import vytvoří nový místní projekt s podporovanými zvukovými stopami, klipy, jejich umístěním, ořezy, jednoduchými prolínačkami a statickým nastavením mixážního pultu.

Import SESX je jednosměrný. Nepřenášejí se efekty Audition, automatizace, směrování, video, značky, smyčky, natažení, propojené prolínačky ani přesné křivky prolínání. Po importu otevřete **Soubor → Zpráva o předání** a zkontrolujte chybějící média a další vynechaný obsah. Původní soubor SESX a média si ponechte pro další práci v Audition.

## Zálohování vykresleného obsahu

Pro důležitou práci si uchovejte obě tyto položky:

1. Kopii projektu Scape (`.sscape` nebo `.fscape`) pro budoucí úpravy.
2. Vykreslený zvukový nebo videový soubor, který lze přehrát bez editoru.

Uložte tyto soubory mimo adresář prohlížeče nebo dat aplikace.
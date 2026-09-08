---
title: "Soubory projektu"
description: "Vyberte si mezi místní knihovnou, soubory projektu Scape, AUP4 a vykreslenými zálohami."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"cs"} -->

## Místní knihovna projektů

Editor ukládá pracovní projekty do své místní knihovny. V prohlížeči se jedná o úložiště specifické pro původ; v desktopové edici se jedná o data aplikace. Toto je pohodlná pracovní kopie, nikoli jediná kopie, kterou byste měli uchovávat.

## Soubory projektů Scape

Použijte **Soubor → Exportovat soubor projektu** pro přenosný projekt bez ztrát. Každý produkt přidává svůj vlastní příponu: Soundscaper ukládá `.sscape` a Framescaper ukládá `.fscape`, a název položky nabídky je vždy ten, který se vztahuje. Formát za oběma je stejný, takže je to vhodná volba, když potřebujete zachovat stav smíšeného média.

Buď produkt otevře libovolnou příponu. `.sscape`, `.fscape`, vyhrazený `.liscape` a starší `.scape` soubory exportované před tím, než produkty získaly své vlastní přípony, se otevírají všude, a uložení jednoho z jiného produktu pouze změní jeho název - například `Mix.sscape` uložený z Framescaperu se stane `Mix.fscape`. Nic se nezmění na projektu samotném.

Při importu nebo otevírání kopie Scape může dojít ke střetu s existujícím projektem se stejným ID. Použijte nabízený pracovní postup kopie, pokud musí obě verze zůstat v místní knihovně.

## AUP4

AUP4 existuje pro kompatibilní výměnu zvuku s Audacity. Export vytvoří zprávu o kompatibilitě, která popisuje konverze, nedostupné efekty a vynecháný stav specifický pro Soundscaper.

AUP4 je pouze pro zvuk. Video je vynecháno a preference prohlížeče, historie vrácení, směrování mixážního pultu a knihovna projektů prohlížeče nejsou přenášeny. Nepoužívejte AUP4 jako jediný zálohu projektu Soundscaper nebo Framescaper.

## Zálohování vykresleného obsahu

Pro důležitou práci si uchovejte obě tyto položky:

1. Kopii projektu Scape (`.sscape` nebo `.fscape`) pro budoucí úpravy.
2. Vykreslený zvukový nebo videový soubor, který lze přehrát bez editoru.

Uložte tyto soubory mimo adresář prohlížeče nebo dat aplikace.
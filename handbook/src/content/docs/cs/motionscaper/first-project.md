---
title: "Váš první pohybový projekt"
description: "Vytvořte kompozici, animujte vrstvu a exportujte uložený projekt."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"cs"} -->

## Vytvoření a přidání vrstvy {#create-and-add-a-layer}

1. Zvolte **Soubor → Nová kompozice** a zadejte název, rozměry, snímkovou frekvenci
   a dobu trvání ve snímcích.
2. Zvolte **Vrstva → Nový text** nebo **Vrstva → Nová jednobarevná vrstva**. Pokud
   projekt obsahuje více kompozic, vyberte cílovou kompozici.
3. Otevřete **Vrstva → Text a vzhled** pro úpravu existující textové vrstvy nebo
   výplní a obrysů tvaru. Písma importovaná zde se uchovávají s projektem.

Pro obrázkové, obrazové nebo zvukové zdroje použijte **Soubor → Importovat média**.
Import, který překročí aktuální limity dekodéru nebo paměti, je odmítnut
s vysvětlením; původní zdrojový soubor zůstává nedotčený.

## Animace a náhled {#animate-and-preview}

Otevřete **Vrstva → Vlastnosti a klíčové snímky**, vyberte vlastnost vrstvy
a přidejte klíče v přesných polohách snímků. Ovládání křivek mění interpolaci;
prostorové úpravy mění dráhy polohy. **Zobrazení → Časová osa** otevírá ovládání
časování vrstev, jejich pořadí, seskupování a pracovní oblasti.

Otevřete **Zobrazení → Plátno kompozice** a vyberte a posuňte statickou 2D vrstvu.
Čtverec mění její velikost a kruh ji otáčí kolem nastavené kotvy. Každé dokončené
tažení je jeden krok zpět; Escape tažení zruší. Animované transformace
a transformace řízené výrazy zůstávají v nabídce Vlastnosti a klíčové snímky.

Otevřete **Zobrazení → Náhled kompozice** pro posun na daný čas nebo přehrávání
kompozice. Náhled používá uchovaná zdrojová média. Nepodporovaná nebo neplatná
nastavení scény způsobí chybu namísto náhradního obrázku. Zavřením náhledu
uvolníte jeho aktivní prostředky vykreslování.

## Uložení přenosné kopie {#save-a-portable-copy}

Zvolte **Soubor → Uložit** pro zveřejnění aktuální revize a poté
**Soubor → Uložit kopii** pro stažení archivu `.mscape`. Archiv obsahuje projekt
a původní média potřebná k opětovnému otevření. Na jiném zařízení nebo
z nové knihovny prohlížeče jej otevřete pomocí **Soubor → Otevřít**.

## Vykreslení {#render}

Zvolte **Soubor → Vykreslit**. Vyberte kompozici, výstupní formát a rozsah snímků.
Koncový snímek není zahrnut: snímky 0 až 29 používají rozsah `0` až `30`.
Zlomková pracovní oblast vybírá obsažené celočíselné časy vzorkování;
oblast bez výstupních vzorků je nutné před vykreslením změnit.

Pro alfu použijte **Průhledná sekvence PNG (.tar)**. Rozbalením archivu TAR
získáte běžné obrázky PNG a metadata časování. MP4 a WebM používají barvu pozadí
vybranou v dialogu. Vykreslení připne odeslanou revizi, takže pozdější úpravy
nezmění již probíhající výstup. Zavření dialogu vykreslení ponechá úlohu běžet.
**Soubor → Fronta vykreslení** zobrazuje průběh, rušení, opakování odeslané revize
a dokončená stažení. Zavření editoru zruší nedokončené úlohy.

Zpět na [příručku Motionscaper](/motionscaper/).

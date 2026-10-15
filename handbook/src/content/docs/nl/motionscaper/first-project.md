---
title: "Uw eerste Motion-project"
description: "Maak een compositie, animeer een laag en exporteer een opgeslagen project."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"nl"} -->

## Een laag maken en toevoegen {#create-and-add-a-layer}

1. Kies **Bestand → Nieuwe compositie** en voer een titel, afmetingen,
   framesnelheid en duur in frames in.
2. Kies **Laag → Nieuwe tekst** of **Laag → Nieuw effen vlak**. Kies de
   doelcompositie wanneer het project meerdere composities bevat.
3. Open **Laag → Tekst en uiterlijk** om een bestaande tekstlaag of de vullingen
   en contouren van een vorm te bewerken. Hier geïmporteerde lettertypen blijven bij het project bewaard.

Gebruik **Bestand → Media importeren** voor afbeeldingen, video of audio.
Een import die de huidige decoder- of geheugenlimieten overschrijdt, wordt met
een uitleg geweigerd; het oorspronkelijke bronbestand blijft ongewijzigd.

## Animeren en bekijken {#animate-and-preview}

Open **Laag → Eigenschappen en keyframes** om een laageigenschap te kiezen en
keys op exacte frameposities toe te voegen. Curvebediening wijzigt interpolatie;
ruimtelijke bewerking wijzigt positiebanen. **Beeld → Tijdlijn** opent bediening
voor laagtiming, volgorde, groeperen en werkgebied.

Open **Beeld → Compositiecanvas** om een statische 2D-laag te selecteren en te
verplaatsen. Het vierkant schaalt de laag en de cirkel draait deze rond het
ingestelde anker. Elke voltooide sleepbeweging is één stap voor ongedaan maken;
Escape annuleert slepen. Geanimeerde en door expressies gestuurde transformaties
blijven in Eigenschappen en keyframes.

Open **Beeld → Compositievoorbeeld** om door de compositie te zoeken of deze af
te spelen. Het voorbeeld gebruikt bewaarde bronmedia. Niet-ondersteunde of
ongeldige scène-instellingen geven een fout in plaats van een vervangend beeld.
Sluit het voorbeeld om de actieve renderbronnen vrij te geven.

## Een draagbare kopie opslaan {#save-a-portable-copy}

Kies **Bestand → Opslaan** om de huidige revisie te publiceren en daarna
**Bestand → Kopie opslaan** om een `.mscape`-archief te downloaden. Het archief
bevat het project en de oorspronkelijke media die nodig zijn om het opnieuw
te openen. Open het met **Bestand → Openen** op een ander apparaat of vanuit
een nieuwe browserbibliotheek.

## Renderen {#render}

Kies **Bestand → Renderen**. Selecteer een compositie, uitvoerformaat en
framebereik. Het eindframe is uitgesloten: frames 0 tot en met 29 gebruiken
het bereik `0` tot `30`. Een fractioneel werkgebied selecteert de gehele
bemonsteringstijdstippen die het bevat; een gebied zonder uitvoermonsters moet
worden gewijzigd voordat u rendert.

Gebruik **Transparante PNG-reeks (.tar)** voor alfa. Pak het TAR-archief uit om
gewone PNG-afbeeldingen en timingmetadata te verkrijgen. MP4 en WebM gebruiken
de achtergrondkleur die in het dialoogvenster is geselecteerd. Renderen zet
de ingediende revisie vast, zodat latere bewerkingen een al lopende uitvoer
niet wijzigen. Het renderdialoogvenster sluiten laat de taak doorgaan.
**Bestand → Renderwachtrij** toont voortgang, annulering, opnieuw proberen van
de ingediende revisie en voltooide downloads. De editor sluiten annuleert onafgemaakte taken.

Ga terug naar het [Motionscaper-handboek](/motionscaper/).

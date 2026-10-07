---
title: "Video exporteren"
description: "Valideer de samengestelde reeks en maak een MP4- of WebM-leveringsbestand."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"nl"} -->

## Voor het exporteren

- Speel de volledige reeks en elke bewerkingsgrens af.
- Controleer of zichtbare en solo gemaakte tracks het bedoelde beeld opleveren.
- Controleer of gekoppelde audio gesynchroniseerd blijft.
- Controleer het exportbereik en of ondertitels of audio moeten worden opgenomen.

## Het bestand maken

Open het exportdialoogvenster en selecteer een videoformaat. Framescaper ondersteunt MP4- en WebM-levering via de geconfigureerde video-runtime. Kies de afmetingen, beeldsnelheid en andere opties die bij de bestemming passen.

Videocodering vraagt meer bronnen dan gewone tijdlijnweergave. Houd de editor open totdat de export als voltooid wordt gemeld.

## Audioclips afzonderlijk exporteren {#export-audio-clips}

Kies **Bestand → Video exporteren**, selecteer een audio-indeling zoals **WAV** en stel **Uitvoer** in op **Afzonderlijke clips (splitsen per clip)**. De export downloadt een archief met één bestand voor elke audioclip. Videoclips worden uitgesloten; elk audiobestand bevat alleen de eigen clip, inclusief uitsneden en clipbewerkingen.

Bestanden beginnen bij het hoorbare begin van de clip, zonder opvulling tot de projectpositie of een effectstaart. Genummerde clipnamen houden clips met dezelfde naam uit elkaar.

Spooreffecten worden meegenomen; mastereffecten, dempen en solo hebben geen invloed op deze export. Zie de gedeelde audiowerkwijze bij [Clips als afzonderlijke bestanden exporteren](/soundscaper/edit-mix-and-export/#export-clips).

## De levering controleren

Open het geëxporteerde bestand in een aparte speler. Controleer de duur, het eerste en laatste frame, de beeldoriëntatie, audiosynchronisatie en de verwachte ondertitels.

De gerenderde video kan het bewerkbare project niet vervangen. Exporteer ook een `.fscape`-kopie wanneer je de tijdlijn en projectmedia wilt bewaren.

---
title: "Een geïmporteerd bestand op desktop overschrijven"
description: "Sla het bewerkte project in Soundscaper of Framescaper op over het oorspronkelijke mediabestand."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"nl"} -->

In de Electron-versies van Soundscaper en Framescaper exporteert **Bestand → Bestandsnaam overschrijven** het volledig bewerkte project naar het oorspronkelijk geïmporteerde mediabestand. De opdracht gebruikt de exportinstellingen die het oorspronkelijke bestand ondersteunt en slaat direct op, zonder het exportvenster of een bestandskiezer te openen. Audio behoudt het bronformaat, de samplefrequentie en het aantal kanalen. Ondersteunde MP4- en WebM-video behoudt de broncontainer, afmetingen en beeldsnelheid.

Importeer één mediabestand via **Bestand → Importeren**, bewerk het en kies daarna **Bestand → Bestandsnaam overschrijven**. Je kunt dit na verdere bewerkingen herhalen. Een tijdselectie beperkt het overschrijven niet: het volledige project wordt altijd gerenderd. Het project bewaart de geïmporteerde media en bewerkingsgeschiedenis.

De opdracht is niet beschikbaar als het project geen ondersteund oorspronkelijk bestand heeft, als er meerdere oorspronkelijke bestanden zijn geïmporteerd, of tijdens importeren, opnemen of verwerken. Browserversies gebruiken het gewone exportvenster.

Kies **Bestand → Audio exporteren** in Soundscaper of **Bestand → Video exporteren** in Framescaper als je een andere bestemming wilt kiezen of de uitvoerinstellingen wilt wijzigen. Overschrijven vervangt de inhoud van het oorspronkelijke bestand; bewaar een aparte kopie als je de onbewerkte opname nodig hebt.

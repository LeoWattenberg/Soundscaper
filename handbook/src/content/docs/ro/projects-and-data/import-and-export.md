---
title: "Import și export"
description: "Deosebiți fișierele media sursă, fișierele de proiect, fișierele de schimb și livrările redate."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"ro"} -->

Soundscaper folosește tipuri diferite de fișiere pentru activități diferite.

## Media sursă

Folosiți **Fișier → Import** pentru audio, video și etichete. Indicația curentă
a editorului include AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF și
WebM; calea de import video acceptă și alte containere. Disponibilitatea poate
depinde de produsul activ și de resursele de execuție.

Importul media adaugă o sursă deținută de proiect. Fișierul original nu devine
documentul de proiect pe care îl puteți edita.

Importul și exportul audio comprimat acceptă până la o oră sau 1 GB
(1 000 000 000 de octeți), în funcție de limita atinsă prima. Este acceptat un
fișier stereo de o oră la 48 kHz dacă se încadrează în limita de dimensiune.
Operațiile lungi citesc, codifică și salvează în blocuri; exporturile mari în
browser necesită stocare privată pentru origine și suficient spațiu liber.
Importurile mari necesită stocare locală persistentă pentru audio decodat.
Formatele PCM au limite separate.

Varianta pentru browser include MP3, MP2, FLAC, WavPack, Opus și Ogg Vorbis.
Compatibilitatea AAC/M4A în browser depinde de codecul browserului. Exportul în
streaming pe desktop acceptă cele șase formate incluse, precum și FLAC pe 24 de
biți și WavPack fără pierderi float32. Importul pe desktop depinde de
disponibilitatea decodoarelor native; MP2 folosește nivelul mai restrâns de
compatibilitate al utilitarului. AAC pe desktop și furnizorii de compatibilitate
au limite separate.

O operație activă afișează o bară de progres chiar dacă **Vizualizare → Bara de
stare** este ascunsă. Selectați **Anulare** de lângă bară pentru a opri un import
sau un export audio.

## Fișiere de proiect editabile

- Scape (`.sscape` din Soundscaper, `.fscape` din Framescaper; fiecare se poate deschide în ambele produse) este formatul de proiect portabil, fără pierderi, comun pentru Soundscaper și Framescaper.
- AUP4 este un format de schimb doar audio cu Audacity. Nu reprezintă o copie de siguranță completă a unui proiect Soundscaper cu mai multe tipuri media.

Consultați [Fișierele de proiect](/projects-and-data/project-files/) pentru
consecințele fiecărei opțiuni.

## Livrări redate

Exporturile audio creează fișiere pentru ascultare, publicare sau procesare
ulterioară. Exporturile video creează livrări MP4 sau WebM. Un fișier redat nu
păstrează cronologia editabilă, rutarea, efectele sau istoricul proiectului.

Consultați [secțiunea de referință](/reference/) pentru tabelele generate cu
formatele și funcțiile produselor.

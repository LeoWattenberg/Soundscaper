---
title: "Import și export"
description: "Deosebiți fișierele media sursă, fișierele de proiect, fișierele de schimb și livrările redate."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"ro"} -->

Soundscaper folosește tipuri diferite de fișiere pentru activități diferite.

## Media sursă

Folosiți **Fișier → Import** pentru audio, video și etichete. Indicația curentă
a editorului include AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF și
WebM; calea de import video acceptă și alte containere. Disponibilitatea poate
depinde de produsul activ și de resursele de execuție.

Importul media adaugă o sursă deținută de proiect. Fișierul original nu devine
documentul de proiect pe care îl puteți edita.

Exporturile audio comprimate și importurile în browser acceptă până la o oră sau 1 GB (1 000 000 000 de octeți), în funcție de limita atinsă prima. Selectarea fișierelor pe desktop și importul audio comprimat nu au o limită fixă de dimensiune sau durată sub intervalul numerelor întregi sigure. Operațiile lungi citesc, codifică și salvează în blocuri; exporturile mari în browser necesită stocare privată pentru origine și suficient spațiu liber. Importurile mari necesită suficient spațiu local pentru audio decodat. Structura formatului, suportul decodorului și spațiul disponibil pot limita, de asemenea, importul.

Varianta pentru browser include MP3, MP2, FLAC, WavPack, Opus și Ogg Vorbis. Compatibilitatea AAC/M4A în browser depinde de codec-ul browserului. Exportul în streaming pe desktop acceptă cele șase formate incluse, precum și FLAC fără pierderi pe 24 de biți și WavPack float32. Importul pe desktop depinde de disponibilitatea decodoarelor; sursele MP2 mari folosesc decodorul de pachete, iar sursele mai mici folosesc nivelul de compatibilitate al utilitarului.

O operație activă afișează o bară de progres chiar dacă **Vizualizare → Bara de
stare** este ascunsă. Selectați **Anulare** de lângă bară pentru a opri un import
sau un export audio.

## Fișiere de proiect editabile

- Scape (`.sscape` din Soundscaper, `.fscape` din Framescaper; fiecare se poate deschide în ambele produse) este formatul de proiect portabil, fără pierderi, comun pentru Soundscaper și Framescaper.
- AUP3 și AUP4 permit schimbul audio cu Audacity. Alegeți AUP3 pentru profilul de proiect Audacity 3.7.9 sau AUP4 pentru profilul curent de schimb. Niciunul nu reprezintă o copie de siguranță completă a unui proiect Soundscaper cu mai multe tipuri media; verificați raportul de compatibilitate după export.
- Ediția pentru desktop poate deschide sesiuni Adobe Audition SESX (`.sesx`) pentru a crea un proiect local din fișierele audio referite. Păstrați sesiunea și media originale; exportul SESX nu este disponibil.

Consultați [Fișierele de proiect](/projects-and-data/project-files/) pentru
consecințele fiecărei opțiuni.

## Livrări redate

Exporturile audio creează fișiere pentru ascultare, publicare sau procesare
ulterioară. Exporturile video creează livrări MP4 sau WebM. Un fișier redat nu
păstrează cronologia editabilă, rutarea, efectele sau istoricul proiectului.

Consultați [secțiunea de referință](/reference/) pentru tabelele generate cu
formatele și funcțiile produselor.

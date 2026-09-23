---
title: "Depanare"
description: "Rezolvați probleme frecvente de înregistrare, stocare, import și export."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"ro"} -->

## Lipsește o intrare de înregistrare

Verificați permisiunile pentru microfon din sistemul de operare și browser, apoi
redeschideți selectorul de dispozitive. Pentru înregistrarea pe mai multe
piste, asigurați-vă că fiecare pistă armată are atribuită o intrare disponibilă.

## O comandă este dezactivată

Multe comenzi depind de starea curentă. Selectați proiectul, pista, clipul sau
intervalul de timp necesar și încercați din nou. De asemenea, o funcție poate fi
limitată în mod intenționat la Soundscaper sau Framescaper.

## Un import folosește prea multă memorie

Decodarea formatelor comprimate și unele operații mari pot necesita multă
memorie temporară, chiar dacă sunetul proiectului este împărțit în blocuri.
Închideți filele sau aplicațiile care nu sunt necesare, încercați din nou cu o
sursă mai mică sau folosiți ediția desktop dacă este potrivit.

## Un proiect a dispărut din browser

Confirmați că ați deschis același profil de browser, aceeași origine și același
site al produsului. Soundscaper și Framescaper folosesc aceeași bibliotecă pe
originea `soundscaper.org`, dar un alt domeniu, profil de browser sau stocare a
site-ului golită va avea o bibliotecă diferită.

Dacă datele site-ului au fost șterse și nu există un export de proiect Scape,
editorul nu are o copie în cloud pe care să o poată restaura.

## AUP4 a omis o parte din proiect

Citiți raportul de compatibilitate. AUP4 păstrează starea compatibilă de editare
audio, dar omite videoclipul și poate converti sau omite efecte și starea de
mixaj specifică Soundscaper. Pentru transferul complet al proiectului, folosiți
un fișier de proiect Scape — `.sscape` sau `.fscape`; ambele se deschid în
oricare dintre produse.

## Un export eșuează sau nu poate fi redat

Încercați din nou după ce confirmați că intervalul selectat conține material
care poate fi redat. Pentru audio sau video comprimat, verificați dacă se pot
încărca resursele de execuție. După un export reușit, testați fișierul într-un
alt player.

Pentru probleme nerezolvate, folosiți **Ajutor → Asistență** pentru a contacta
responsabilul de mentenanță și includeți produsul, platforma, versiunea de
browser sau build-ul desktop, pașii și mesajul exact de eroare.

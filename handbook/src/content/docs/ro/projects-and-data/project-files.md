---
title: "Fișiere proiect"
description: "Alegeți între biblioteca locală, fișierele proiect Scape, AUP4 și copii de rezervă renderizate."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"ro"} -->

## Bibliotecă locală de proiecte

Editorul salvează proiectele de lucru în biblioteca sa locală. Într-un browser, acesta este stocarea privată a originii; în ediția pentru desktop, este datele aplicației. Aceasta este copia de lucru convenabilă, nu singura copie pe care ar trebui să o păstrați.

## Fișiere de proiect Scape

Utilizați **Fișier → Exportați fișierul proiectului** pentru o copie portabilă fără pierderi a proiectului. Fiecare produs adaugă propriul său sufix: Soundscaper salvează `.sscape`, iar Framescaper salvează `.fscape`, iar numele din meniu indică care dintre ele se aplică. Formatul din spatele ambelor este același, deci este alegerea potrivită atunci când trebuie să păstrați starea de editare multimediă.

Orice produs poate deschide oricare dintre sufixe. `.sscape`, `.fscape`, `.liscape` rezervat și `.scape`, fișierele exportate mai vechi, înainte ca produsele să aibă propriile lor sufixe, se deschid peste tot, iar salvarea unuia dintr-un produs diferit îl redenumește pur și simplu - de exemplu, un fișier `Mix.sscape` salvat din Framescaper devine `Mix.fscape`. Nimic din proiect nu se schimbă cu numele.

Importarea sau deschiderea unei copii Scape poate întâlni un proiect existent cu același ID. Utilizați fluxul de lucru de copiere oferit atunci când ambele versiuni trebuie să rămână în biblioteca locală.

## AUP4

AUP4 există pentru schimbul compatibil de audio cu Audacity. Exportul produce un raport de compatibilitate care descrie conversiile, efectele indisponibile și starea specifică Soundscaper-ului care a fost omisă.

AUP4 este doar audio. Video-ul este omis, iar preferințele browserului, istoricul de anulare, rutarea mixerului și biblioteca de proiecte a browserului nu sunt transferate. Nu utilizați AUP4 ca singura copie de rezervă a unui proiect Soundscaper sau Framescaper.

## Copie de rezervă randată

Pentru lucrări importante, păstrați ambele:

1. O copie a proiectului Scape (`.sscape` sau `.fscape`) pentru editare viitoare.
2. Un fișier audio sau video randat care poate fi redat fără editor.

Stocați aceste fișiere în afara directorului browserului sau al datelor aplicației.

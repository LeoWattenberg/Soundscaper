---
title: "Fișiere proiect"
description: "Alegeți între biblioteca locală, fișierele proiect Scape, AUP4 și copii de rezervă renderizate."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"ro"} -->

## Bibliotecă locală de proiecte

Editorul salvează proiectele de lucru în biblioteca sa locală. Într-un browser, acesta este stocarea privată a originii; în ediția pentru desktop, este datele aplicației. Aceasta este copia de lucru convenabilă, nu singura copie pe care ar trebui să o păstrați.

## Fișiere de proiect Scape

Pe desktop, fișierele audio și video importate rămân în mod implicit referințe la fișierele originale. Păstrați fișierele în locațiile lor originale când redeschideți proiectul. Biblioteca locală păstrează și cache-uri de editare. Înregistrările și fișierele media create sau procesate sunt incluse, deoarece nu au un original extern nemodificat.

Alegeți **Fișier → Gestionarea proiectului → Consolidați media** pentru a include media referită în fișierul proiectului. Consolidarea salvează imediat proiectul; alegeți o destinație în dialogul de salvare. După salvare, copia consolidată poate fi mutată sau partajată fără fișierele media originale. Dacă un fișier media nu poate fi consolidat sau salvarea eșuează, editorul raportează problema.

Exporturile din browser includ automat fișierele media. Consolidați pe desktop un proiect cu referințe externe înainte de a-l deschide în browser.


Utilizați **Fișier → Exportați fișierul proiectului** pentru a salva proiectul de editare. Fiecare produs adaugă propriul său sufix: Soundscaper salvează `.sscape`, iar Framescaper salvează `.fscape`, iar numele din meniu indică care dintre ele se aplică. Formatul din spatele ambelor este același, deci este alegerea potrivită atunci când trebuie să păstrați starea de editare multimediă.

Orice produs poate deschide oricare dintre sufixe. `.sscape`, `.fscape`, `.liscape` rezervat și `.scape`, fișierele exportate mai vechi, înainte ca produsele să aibă propriile lor sufixe, se deschid peste tot, iar salvarea unuia dintr-un produs diferit îl redenumește pur și simplu - de exemplu, un fișier `Mix.sscape` salvat din Framescaper devine `Mix.fscape`. Nimic din proiect nu se schimbă cu numele.

Importarea sau deschiderea unei copii Scape poate întâlni un proiect existent cu același ID. Utilizați fluxul de lucru de copiere oferit atunci când ambele versiuni trebuie să rămână în biblioteca locală.

## Audacity AUP3 și AUP4

Exportul proiectelor Audacity este disponibil în **Fișier → Exportați altele**. Alegeți **Exportați AUP3** pentru profilul de proiect Audacity 3.7.9 sau **Exportați AUP4** pentru profilul actual de schimb Audacity. Fiecare export creează un raport de compatibilitate care descrie conversiile, efectele indisponibile și stările specifice Soundscaper omise.

Ambele formate conțin doar audio. Video-ul este omis, iar preferințele browserului, istoricul de anulare, rutarea mixerului și biblioteca de proiecte a browserului nu sunt transferate. Nu utilizați niciunul ca singura copie de rezervă a unui proiect Soundscaper sau Framescaper.

## Adobe Audition SESX

În ediția pentru desktop, utilizați **Fișier → Deschidere** pentru a importa o sesiune Adobe Audition `.sesx`. Păstrați fișierele audio referite în structura relativă de directoare de sub dosarul sesiunii sau alegeți un dosar media când vi se solicită. Importul creează un proiect local nou cu pistele audio acceptate, clipurile, poziționarea, decupajele, estompările simple și setările statice ale mixerului.

Importul SESX este unidirecțional. Efectele Audition, automatizarea, rutarea, video-ul, marcatorii, buclele, întinderea, estompările încrucișate legate și curbele exacte de estompare nu sunt transferate. După import, deschideți **Fișier → Raport de livrare** pentru a verifica media lipsă și alt conținut omis. Păstrați fișierul SESX original și media pentru a continua lucrul în Audition.

## Copie de rezervă randată

Pentru lucrări importante, păstrați ambele:

1. O copie a proiectului Scape (`.sscape` sau `.fscape`) pentru editare viitoare.
2. Un fișier audio sau video randat care poate fi redat fără editor.

Stocați aceste fișiere în afara directorului browserului sau al datelor aplicației.

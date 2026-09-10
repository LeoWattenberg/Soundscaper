---
title: "Web sau desktop"
description: "Înțelegeți cum edițiile de browser și de desktop stochează proiectele și accesează fișierele."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"ro"} -->

Ambele ediții procesează proiectele local. Stocarea și accesul la fișiere diferă.

## Editor web

Ediția pentru browser stochează proiectele, înregistrările și mediile importate în stocarea privată a originii browserului. Nu încarcă un proiect pe un cont Soundscaper și nu necesită niciun cont.

Utilizați editorul web atunci când doriți acces imediat fără a instala o aplicație. Amintiți-vă că stocarea browserului rămâne supusă regulilor de cotă și evacuare ale browserului. Ștergerea datelor site-ului elimină biblioteca locală de proiecte.

## Previzualizare desktop

Previzualizările desktop ambalate păstrează o bibliotecă locală salvată automat în interiorul aplicației desktop. Ele includ editorul de execuție și traducerile lansate pentru editare offline.

Pachetele desktop sunt nesemnate. macOS aplică doar sigiliul de cod ad-hoc fără identitate de care încărcătorul are nevoie pentru a executa Electron și binarele native; acel sigiliu nu face nicio afirmație despre editor sau încredere. Prin urmare, Windows SmartScreen sau macOS Gatekeeper pot afișa un avertisment de dezvoltator necunoscut pentru pachetele de previzualizare și stabile.

Deschiderea unui fișier `.aup4` importă un proiect independent în biblioteca desktop. Editările ulterioare nu rescrie fișierul deschis. **Salvează** actualizează copia din bibliotecă; **Salvează ca** creează un nou fișier de schimb Audacity.

## Telefoane și tablete

Editorul web păstrează aspectul desktop pe orice ecran, dar sub 900px lățime (un telefon sau o tabletă ținută vertical) pliază bara de instrumente în sertare, astfel încât linia de timp să rămână vizibilă:

- Butonul **Meniu** din colțul din stânga sus deschide un sertar cu meniul complet al aplicației, filele de proiect, bara de acțiune și bara de instrumente cu instrumente. Redare, oprire, înregistrare și căutare rămân în bară. Alegerea unei comenzi închide sertarul.
- Antetele de pistă se deplasează peste benzi din mânerul **Antetele pistei** din colțul din stânga sus al liniei de timp sau din **Vizualizare › Antetele pistei**. Apăsarea pe benzi sau apăsarea tastei Escape le ascunde din nou.
- Introducerea de deasupra editorului este colapsată implicit pe ecrane înguste; **Arată introducerea** o readuce.

**Editare › Preferințe › Apariție › Layout** comută între Automat, Compact și Desktop, astfel încât o fereastră mică pe un desktop poate păstra bara de instrumente desktop, iar o tabletă largă poate opta pentru sertare.

## Proiectele nu se mută automat

Bibliotecile browserului și desktop sunt separate. Mută un proiect în mod intenționat:

- Utilizați un fișier de proiect Soundscaper - `.sscape`, un fișier Framescaper - `.fscape` - pentru întregul proiect.
- Utilizați AUP4 atunci când aveți nevoie specific de schimbul de audio cu Audacity.
- Exportați audio sau video randat ca o copie de redare durabilă.

Consultați [Fișiere de proiect](/projects-and-data/project-files/) înainte de a șterge datele site-ului browser sau datele aplicației desktop.

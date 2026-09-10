---
title: "Pielea editorului"
description: "Alegeți o piele vizuală sau încercați una temporar prin intermediul unui URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"ro"} -->

Pielele modifică culorile, fonturile, marginile și fundalurile decorative ale editorului.
Sunt disponibile în Soundscaper și Framescaper. Fiecare produs își amintește propria alegere. Spațiile de lucru continuă să controleze aranjamentul panourilor și al instrumentelor.

## Alege o piele {#choose-a-skin}

Deschide **Editare → Preferințe → Apariție** și selectează o piele:

- **Implicit** păstrează designul original al editorului.
- **Sakura** combină florile de cireș, accente roz și literă rotunjită.
- **Lilac** folosește mov rece și texturi violete stratificate.
- **Techno** combină graficele de circuite albastre cu literă monospaced.

Alege **Luminos**, **Întunecat** sau **Urmează tema sistemului** separat. Fiecare piele are atât versiuni luminoase, cât și întunecate. **Stilul clipului** rămâne o alegere separată; paleta Colorful este coordonată cu fiecare piele, păstrând culorile clipului distincte.

Contrastul ridicat are prioritate față de decorarea pielii. Dezactivarea contrastului ridicat restaurează pielea selectată. Modificarea unei piei nu modifică audio clip, conținutul proiectului sau aspectul spațiului de lucru.

## Încearcă o piele de la un link {#try-a-skin-from-a-link}

Adaugă `?useskin=sakura` la un URL al editorului pentru a previzualiza temporar Sakura. Folosește
`default`, `sakura`, `lilac` sau `techno` ca valoare. Dacă URL-ul are deja un parametru de interogare, adaugă `&useskin=sakura` în schimb. O valoare necunoscută este ignorată.

O previzualizare URL nu înlocuiește pielea salvată, chiar dacă modifici altă preferință. Încărcarea din nou a URL-ului de previzualizare continuă previzualizarea; vizitarea fără parametrul respectiv utilizează alegerea salvată. Parametrul nu alege lumina sau întunericul.

În **Preferințe → Apariție**, alege **Păstrează această piele** pentru a salva previzualizarea sau **Încheie previzualizarea** pentru a reveni la pielea salvată. Selectarea oricărei piei salvează de asemenea acea alegere și încheie previzualizarea. Aceste acțiuni elimină doar parametrul pielii din URL-ul curent, fără a reîncărca editorul.

---
title: "Motionscaper"
description: "Creați compoziții animate și păstrați local proiecte de animație editabile."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"ro"} -->

Motionscaper este editorul de grafică animată din familia Scaper. Un proiect
conține compoziții, straturi, animație și media păstrată. Extensia fișierului său
de proiect este `.mscape`.

Aceasta este o versiune de dezvoltare. Începeți cu o copie a materialului sursă
important și păstrați arhivele de proiect exportate alături de biblioteca de lucru.

## Începeți o compoziție {#start-a-composition}

Alegeți **Fișier → Compoziție nouă**. Meniul **Strat** deschide instrumente pentru text, forme,
animație, compunere, urmărire, expresii și scene 3D. **Vizualizare →
Previzualizarea compoziției** deschide redarea; suprafețele noi de editare apar când
le alegeți dintr-un meniu.

Alegeți **Vizualizare → Pânza compoziției** pentru a selecta, muta, redimensiona sau roti straturi cu
transformări 2D statice. Transformările animate rămân editabile prin instrumentele pentru proprietăți
și cronologie.

În **Vizualizare → Cronologie**, selectați straturile existente pentru a le redenumi, activa, dezactiva sau
elimina. Redenumirea păstrează referințele la proprietăți și animația. Eliminarea unui
strat păstrează media sa originală; includeți straturile dependente sau detașați mai întâi
legăturile lor. **Revenire** restaurează straturile eliminate. Un strat video selectat
oferă și o casetă audio dacă sursa păstrată conține sunet.

Urmați [primul proiect de animație](/motionscaper/first-project/) pentru a crea,
anima, salva și randa o compoziție.

## Salvare și livrare {#save-and-deliver}

**Fișier → Salvează** publică o revizie salvată. **Salvează o copie** exportă instantaneea
curentă ca arhivă `.mscape`, fără a publica o nouă revizie salvată.
Media și fonturile originale importate însoțesc arhiva. **Biblioteca de
proiecte** deschide proiectele păstrate pe acest dispozitiv.

**Fișier → Randează** oferă cadre PNG transparente într-o arhivă TAR,
video opac MP4 sau WebM și ProRes 4444 când encoderul desktop este disponibil.
Secvențele PNG exclud sunetul. Videoclipul din browser păstrează sunetul creat când
encoderul său acceptă formatul cerut. ProRes nativ raportează precizia efectivă a
culorii și alfa în dialogul de randare. **Fișier → Coadă de randare** păstrează
sarcinile disponibile după închiderea dialogului și schimbarea proiectului. Păstrează până la opt
sarcini și 128 MiB de descărcări din browser; fiecare descărcare admite până la 64 MiB. Alegeți
o destinație fișier cu scriere în flux pentru ieșiri mai mari și eliminați sarcinile finalizate pentru
a elibera descărcările păstrate. Dacă eșuează curățarea ieșirii native, folosiți **Reîncearcă curățarea
ieșirii** în această coadă. Sarcina își păstrează destinația până când curățarea reușește;
apoi o puteți elimina sau puteți reîncerca revizia trimisă cu o destinație nouă.

## Legătura cu Framescaper {#link-to-framescaper}

Compozițiile legate necesită linia de dezvoltare separată Framescaper 1.1.
În dialogul său **Fișier → Compoziții legate**, creați un URL de asociere. Lipiți-l
în dialogul **Fișier → Trimite compoziția în Framescaper** din Motionscaper, conectați-vă
și păstrați deschise editoarele și ferestrele punții. Operațiile **Salvează** ulterioare trimit
automat revizii noi; **Salvează o copie** nu face acest lucru.

Framescaper păstrează fiecare revizie acceptată și întregul ansamblu de media necesară pentru
utilizare offline. Revenire fixează o revizie anterioară până când reluați actualizările. Modificările de
dimensiune a ieșirii, temporizare sau grilă audio necesită o examinare explicită de conformare.
Receptorul desktop poate în schimb urmări un fișier `.mscape` salvat pe care îl selectați.

## Căutați actualizări desktop {#check-desktop-updates}

Alegeți **Ajutor → Caută actualizări** în aplicația desktop. Această verificare manuală caută
versiuni Motionscaper compatibile în depozitul GitHub al proiectului. Versiunile
preliminare pot primi versiuni preliminare mai noi; versiunile stabile primesc versiuni
stabile. Alegeți **Vezi versiunea** pentru a deschide pagina verificată a versiunii. Verificarea
nu descarcă și nu instalează o actualizare. Compilările pentru browser omit această comandă din meniu.

## Schimbul cu After Effects {#after-effects-exchange}

**Fișier → Punte After Effects** oferă scripturi lizibile și examinează datele de schimb
acceptate înainte de import. Fișierele `.aep` și `.aepx` se deschid printr-o
copie instalată de After Effects și scripturile punții. Puntea în dezvoltare
nu a fost încă validată cu After Effects instalat. Examinați raportul;
intenția scenei neacceptată și media originală rămân păstrate în custodia proiectului.

Dialogul oferă opțiuni separate de import și export pentru expresiile scalare de
opacitate acceptate care folosesc aritmetică, timpul compoziției, valoarea anterioară
expresiei și funcțiile Math standard. Ambele opțiuni sunt inițial dezactivate. Examinați noul
raport după schimbarea unei opțiuni; alte forme de expresie necesită eșantionare
sau randare explicită. Sursa originală a expresiei rămâne în schimbul
păstrat sau în arhiva `original.mscape`.

Rendererul acceptă culoare și alfa SDR cu straturi 2.5D, camere, lumini,
eșantionare a obturatorului și profunzime de câmp. Nu revendică suport HDR, rețele 3D complete,
măști AI avansate sau compatibilitate arbitrară cu extensii After Effects.

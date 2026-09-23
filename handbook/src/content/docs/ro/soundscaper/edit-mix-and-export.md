---
title: "Editați, mixați și exportați"
description: "Aranjați clipuri, echilibrați piste, aplicați efecte și creați un fișier de livrare."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"ro"} -->

## Aranjați clipurile

Selectați clipurile sau un interval de timp înainte de a alege o comandă de
editare. Împărțirea creează o limită de editare la cursorul de redare.
Variantele care păstrează spațiul sau deplasează materialul ulterior stabilesc
dacă acesta rămâne pe loc ori se mută pentru a închide regiunea eliminată.

Folosiți dosare de piste, grupuri de clipuri și Cutia proiectului pentru a
organiza proiectele mari.

### Ajustați fade-urile clipului {#clip-fades}

Selectați un clip audio pentru a afișa mânere triunghiulare mici în partea de
sus a formei de undă, imediat sub antetul clipului.
Trageți triunghiul din stânga spre interior pentru un fade-in, sau pe cel din
dreapta spre interior pentru un fade-out. Forma de undă se modifică în timp ce
trageți, iar zona de deasupra curbei fade-ului devine mai întunecată. Triunghiurile
urmează limitele fade-ului; readucerea unuia în colțul său elimină fade-ul
respectiv. Se modifică doar clipul tras, chiar dacă sunt selectate mai multe.

Mânerele dispar când deselectați clipul, dar forma de undă atenuată și umbrirea
rămân. Aceste fade-uri păstrează sunetul original și pot fi ajustate în
continuare după salvarea și redeschiderea proiectului. Eliberați pentru a aplica
fade-ul sau apăsați **Escape** în timpul tragerii pentru a anula. **Anulare**
inversează o tragere completă. Redarea și exportul folosesc setările fade-ului
aplicat.

Cu un clip selectat și focalizat, apăsați **Tab** pentru a ajunge la mânerele
fade-ului. Tastele săgeată ajustează durata cu 10 milisecunde sau cu 100
milisecunde împreună cu **Shift**. **Home** elimină fade-ul; **End** îl extinde
pe întregul clip. Pentru introducere numerică, alegeți **Editare → Clipuri
audio → Proprietăți clip** și folosiți **Fade**.

## Construiți mixajul

Folosiți comenzile de amplificare, panoramare, dezactivare și solo ale pistelor
pentru a echilibra proiectul. Panoul Mixer afișează aceeași stare a proiectului
într-un aranjament orientat spre mixaj. Efectele în timp real rămân ajustabile;
operațiile distructive sau redate creează modificări ale proiectului care pot fi
anulate cât timp istoricul este disponibil.

Folosiți indicatorul de redare și analiza intensității sonore pentru a inspecta
rezultatul. Nu tratați o țintă a indicatorului ca înlocuitor pentru ascultarea
exportului complet.

### Reduceți sibilanța {#reduce-sibilance}

Alegeți **Efect → Eliminarea zgomotului și reparare → De-esser**. Setați
**Frecvență** aproape de partea aspră a vocii, apoi coborâți **Prag** până când
sibilanții se domolesc. **Reducerea maximă** limitează atenuarea; începeți în
jur de 6–9 dB. Un **Atac** mai scurt prinde începutul unei consoane, iar
**Eliberare** stabilește cât de repede se refac frecvențele înalte. Se reduce
doar banda superioară.

### Comprimați separat benzile de frecvență {#multiband-compression}

Alegeți **Efect → Volum și compresie → Compresor multibandă**. Cele două
frecvențe de separare împart semnalul în benzi joasă, medie și înaltă. Fiecare
bandă are propriul prag, raport și câștig de ieșire. Un raport de 1 păstrează
dinamica benzii neschimbată. Atacul și eliberarea se aplică tuturor celor trei
benzi. Frecvențele de separare au pante line, suprapuse, de 6 dB/octavă; când
toate rapoartele sunt 1 și câștigurile benzilor sunt 0 dB, semnalul original
trece neschimbat.

Ambele efecte conectează canalele pentru a păstra echilibrul stereo și sunt
disponibile și în rack-urile de efecte ale pistei și masterului. Setările
rack-urilor se salvează cu proiectul și pot fi ajustate în timpul redării.
**Aplicare la selecție** redă efectul în sunetul selectat și acceptă Anulare.
Automatizarea pe cronologie nu este disponibilă pentru aceste două efecte.

### Folosiți efecte LADSPA și analizoare Vamp {#native-audio-plugins}

Aplicația desktop poate scana plug-in-uri terțe doar după ce permiteți un format
și unul dintre dosarele sale în **Efect → Manager de plug-in-uri**. Scanarea nu
se face niciodată automat. Permiteți fiecare instalare găsită înainte de
utilizare și instalați numai plug-in-uri în care aveți încredere: plug-in-urile
native execută cod chiar dacă Soundscaper le găzduiește în procese auxiliare
supravegheate.

Efectele LADSPA sunt disponibile în Linux. Deschideți unul din **Efect → Plug-in-
uri audio** după ce îl activați în manager. Soundscaper construiește comenzile
din porturile LADSPA, deoarece formatul nu are o interfață a furnizorului.
Valorile acestor comenzi și starea activată sau ocolită a efectului se salvează
cu proiectul.

Plug-in-urile Vamp analizează sunetul în loc să-l modifice. După activarea unei
instalări Vamp, selectați o pistă audio pentru a o analiza sau nu selectați
nicio pistă audio pentru a analiza mixajul master. O selecție de timp limitează
analiza; în caz contrar, Soundscaper folosește întregul proiect. Alegeți
**Analiză → Plug-in-uri Vamp**, selectați rezultatul analizorului și setările,
apoi rulați-l. Soundscaper adaugă marcajele temporale returnate ca pistă nouă de
etichete numai după reușita analizei complete, astfel încât anularea sau
modificarea proiectului să nu lase etichete parțiale.

## Export

Alegeți **Fișier → Exportare audio** pentru o livrare mixată sau **Exportare
audio selectat** pentru a reda doar o selecție. Soundscaper poate exporta și
stems și etichete.

Formatele comprimate folosesc mediul de execuție FFmpeg. Formatele exacte și
disponibilitatea condiționată sunt listate în [referința de formate generată](/reference/).

Redați fișierul exportat în altă aplicație înainte de livrare sau ștergerea
materialului sursă.

Pentru lucrul cu imagini — compunerea unei secvențe, efecte video și o livrare
MP4 sau WebM — predați proiectul către [Framescaper](/framescaper/) și consultați
[exportarea videoclipului](/framescaper/video-export/).

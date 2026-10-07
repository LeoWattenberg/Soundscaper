---
title: "Editați, mixați și exportați"
description: "Aranjați clipuri, echilibrați piste, aplicați efecte și creați un fișier de livrare."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"ro"} -->

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

### Editează sursa unui clip {#clip-source-properties}

Alege **Editare → Clipuri audio → Proprietățile clipului** pentru a deschide editorul sursei. Înregistrarea completă apare în spatele clipului. Trage de marginile clipului pentru a schimba începutul și durata sursei, păstrând neschimbat începutul clipului pe cronologia proiectului. Panoul **Normalizare** conține amplificarea clipului și acțiunile pentru vârf și intensitate sonoră.

Deschide **Înălțime și tempo** și bifează **Leagă înălțimea și tempo-ul** pentru a modifica viteza și înălțimea împreună. Raportul de viteză `1` și modificarea înălțimii `0%` lasă sunetul neschimbat. Raportul `2` redă de două ori mai repede și cu o octavă mai sus; `0.5` redă la jumătate din viteză și cu o octavă mai jos. Editarea unui control legat îl actualizează și pe celălalt. Dezactivarea legăturii restabilește setarea independentă a înălțimii, păstrând raportul actual de viteză.

Fă **Ctrl+clic** pe forma de undă pentru a adăuga un marcator de întindere legat de acel eșantion sursă. Tragerea lui schimbă sincronizarea de ambele părți; suprapunerea arată ambele viteze de redare. Comenzile clipului rămân specifice fiecărui clip. Selectarea sunetului sursă și aplicarea unui efect actualizează toate clipurile care folosesc sursa.

### Editează clipurile într-o foaie de calcul {#clip-spreadsheet}

Alege **Vizualizare → Panouri → Foaie de calcul pentru clipuri** pentru a vedea toate clipurile din proiect. Panoul se deschide sub cronologie. Meniul său permite mutarea în altă zonă de andocare, desprinderea într-o fereastră flotantă sau închiderea. Dimensiunea și poziția se salvează împreună cu spațiul de lucru. Fiecare rând arată pista, poziția pe cronologie, fișierul sursă, decalajul sursei, durata, înălțimea, viteza, amplificarea, fade-urile și opțiunile de redare. Timpul este exprimat în secunde, înălțimea în semitonuri, iar viteza este un raport: `1` este viteza normală, `2` este dublă.

Fă dublu clic pe o celulă sau selecteaz-o și apasă **Enter** pentru a-i edita valoarea. Apasă **Enter** pentru aplicare sau **Escape** pentru anulare. Celulele pentru pistă și sursă arată ID-urile reale. Schimbă ID-ul pistei pentru a muta un clip pe o pistă audio existentă. Schimbă ID-ul sursei sau introdu o cale de fișier locală pentru a înlocui sunetul, păstrând poziția pe cronologie, durata, viteza și decalajul sursei în secunde. Noul fișier trebuie să conțină intervalul sursei specificat. **Inversat** și **Inversat de fază** sunt casete de selectare; selectează o celulă și apasă **Spațiu** pentru a le comuta. Clipurile de pe piste blocate și clipurile video sunt doar pentru citire.

Schimbarea duratei scurtează sau prelungește intervalul sursei de la decalajul curent. Schimbarea vitezei păstrează intervalul sursei, cu excepția cazului în care lipești și o durată. Anulează gruparea sau legătura clipurilor înainte de a le modifica sincronizarea aici; sincronizarea clipurilor întinse se editează în editorul sursei.

Selectează o celulă, trage peste un interval sau folosește **Shift+clic** pe altă celulă pentru a extinde selecția. Fă clic pe numărul unui rând sau pe antetul unei coloane pentru a selecta rândul sau coloana în întregime. Folosește **Ctrl+C** și **Ctrl+V** (**Cmd+C** și **Cmd+V** pe macOS) pentru a transfera selecția cu o foaie de calcul. Coloanele sunt separate prin taburi, iar rândurile prin linii noi. Lipirea începe din celula selectată și actualizează clipurile existente. Lipirea care depășește rândurile existente este respinsă. Cu o selecție activă, apasă **Escape** sau fă clic în spațiul gol de sub tabel pentru a o șterge. Fără selecție, lipirea inserează rânduri noi, inclusiv într-un proiect gol. Opțiunile de redare se copiază ca `true` sau `false` și acceptă aceste valori la lipire. Rândurile noi respectă ordinea coloanelor tabelului și necesită numele fișierului sursă sau ID-ul sursei. Un nume unic de pistă existent plasează clipul pe pista respectivă; un nume nou creează o pistă audio. Numele de pistă goale folosesc numele sursei. Celulele numerice goale folosesc valorile implicite: poziție și decalaj `0`, viteză `1`, înălțime și amplificare `0`, fără fade-uri. Dacă durata este goală, se folosește sunetul rămas la viteza cerută.

Panoul caută mai întâi sursa în proiect, inclusiv în Coșul proiectului. Dacă lipsește, alege **Încarcă fișierele referențiate** și selectează fișierele audio enumerate în dialog. Și căile de pe disc necesită această selectare: lipirea unei căi nu oferă aplicației acces la fișier. Fișierele selectate trebuie să corespundă fără ambiguitate cu numele referențiate. Panoul importă sunetul, validează limitele sursei și proprietățile clipului și plasează clipurile noi la pozițiile indicate. **Ctrl+Z** (**Cmd+Z** pe macOS) anulează întreaga lipire într-un singur pas; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) o reface. Dacă lipirea conține o valoare nevalidă, clipurile rămân neschimbate.

## Construiți mixajul

Folosiți comenzile de amplificare, panoramare, dezactivare și solo ale pistelor
pentru a echilibra proiectul. Panoul Mixer afișează aceeași stare a proiectului
într-un aranjament orientat spre mixaj. Efectele în timp real rămân ajustabile;
operațiile distructive sau redate creează modificări ale proiectului care pot fi
anulate cât timp istoricul este disponibil.

Folosiți indicatorul de redare și analiza intensității sonore pentru a inspecta
rezultatul. Nu tratați o țintă a indicatorului ca înlocuitor pentru ascultarea
exportului complet.

### Ascultă frecvențele selectate {#listen-to-selected-frequencies}

Selectează fragmentul pe care vrei să-l asculți. Din meniul pistei, alege **Vizualizarea pistei → Spectrogramă**, apoi deschide **Opțiuni spectrogramă → Selectează intervalul frecvenței spectrale**. Introdu frecvența minimă și maximă și alege **Selectează intervalul** sau ajustează mânerele selecției din spectrogramă.

Alege **Opțiuni de redare → Redă frecvențele selectate** sau **Selectează → Spectral → Redă frecvențele selectate**. Intervalul temporal selectat este redat o singură dată la viteza normală, chiar dacă anterior ai ales altă viteză sau redarea în buclă. Filtrul de ascultare se aplică mixajului curent, inclusiv setărilor de mut, solo, amplificare și efecte. Un dreptunghi spectral indică banda de frecvență și intervalul temporal, dar nu pune pista în solo. Dacă redarea este deja activă, comanda o pune pe pauză; alege-o din nou pentru a începe audiția filtrată.

Filtrele de frecvență în timp real au tranziții graduale. Frecvențele din afara benzii devin mai slabe, la fel și cele de lângă limitele ei. **Pauză** sau **Oprire** elimină filtrul, astfel că următoarea redare normală folosește întregul interval de frecvență. Sunetul, selecțiile, istoricul de anulare și fișierele exportate rămân neschimbate.

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

### Exportă clipurile ca fișiere separate {#export-clips}

Alege **Fișier → Exportă audio** și setează **Ieșire** la **Clipuri individuale (separare după clipuri)**. Alege un format audio și apasă **Exportă** pentru a descărca o arhivă cu câte un fișier pentru fiecare clip audio de pe pistele audio ale proiectului. Fiecare fișier începe la începutul audibil al clipului și se termină la sfârșitul său audibil, fără completare până la cronologia proiectului sau coadă suplimentară de efect. Sunt incluse decupările, amplificarea clipului, estompările și modificările de viteză și înălțime. Clipurile suprapuse rămân separate.

Fișierele folosesc numele clipurilor cu prefixe numerotate. Caracterele neacceptate în numele fișierelor sunt înlocuite, iar numerele diferențiază numele repetate. Efectele pistei sunt incluse; efectele master, dezactivarea sunetului și solo nu influențează acest export. Decongelează mai întâi pistele înghețate pentru a exporta separat clipurile editabile.

Formatele comprimate folosesc mediul de execuție FFmpeg. Formatele exacte și
disponibilitatea condiționată sunt listate în [referința de formate generată](/reference/).

### Încorporează etichetele de capitol {#embedded-chapters}

În editorul din browser, alege **Fișier → Exportă audio**, selectează **MP3** sau **AAC / M4A** și activează **Încorporează etichetele ca capitole** în **Opțiuni audio**. Opțiunea este dezactivată implicit și adaugă titlurile și timpii etichetelor într-un singur fișier mixat. Adaugă etichete înainte de export; stem-urile, împărțirile în capitole și secvențele de mastering nu oferă această opțiune.

Sunt incluse numai etichetele care se intersectează cu intervalul livrat. Exportarea unei selecții deplasează timpii capitolelor la începutul fișierului rezultat. MP3 păstrează timpii de sfârșit ai etichetelor de regiune; o etichetă punctuală se încheie la capitolul următor sau la sfârșitul fișierului. M4A stochează începuturile capitolelor, iar fiecare capitol continuă până la următorul început sau la sfârșitul fișierului. M4A acceptă până la 255 de capitole și 255 de octeți UTF-8 pentru fiecare titlu. Afișarea capitolelor încorporate depinde de player.

Redați fișierul exportat în altă aplicație înainte de livrare sau ștergerea
materialului sursă.

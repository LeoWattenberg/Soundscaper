---
title: "Cum se compară Soundscaper"
description: "Comparați Soundscaper cu Audacity 4 și Adobe Audition în ceea ce privește înregistrarea, editarea, mixajul, livrarea și schimbul de fișiere."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"ro"} -->

Soundscaper reimplementează Audacity 4 pe web și adaugă un strat de producție deasupra acestuia. Adobe Audition este instrumentul comercial de post-producție față de care ambele sunt de obicei evaluate. Această pagină compară toate cele trei, astfel încât să puteți determina care dintre ele realizează deja deja sarcina pe care o aveți.

## Cum să citiți această pagină

Fiecare celulă conține **Da**, **Parțial** sau **Nu**, urmat de detaliile care o califică.

**Parțial** acoperă trei situații diferite, iar nota indică care se aplică: capacitatea există, dar este mai restrânsă decât în altă parte, există, dar depinde de ceva pe care trebuie să îl furnizați, sau este accesibilă doar prin ocolirea unei absențe.

Rândurile descriu capacități, nu comenzi de meniu. Pentru inventarul exact al comenzilor, consultați [Comenzi și scurtături](/reference/generated/commands/), iar pentru ceea ce permite fiecare produs, consultați
[Capacitățile produsului](/reference/generated/product-capabilities/).

### De unde provin aceste afirmații

- Rândurile pentru **Soundscaper** provin din acest depozit: profilele de capacitate ale produsului, manifestul de acțiuni de runtime și registrul de formate de export.
  Încărcăturile țintă native pentru desktop sunt generate de CI-ul depozitului sau de împachetarea țintă. Un pachet activează una doar după ce a pus în așteptare și a verificat rezultatul exact corespunzător; acele rânduri indică când este încă necesară o încărcătură.
- Rândurile pentru **Audacity 4** provin din inventarul upstream fixat în acest depozit, `4.0.0` la commit-ul `4c177d43`. O capacitate înregistrată de upstream, dar lăsată dezactivată sau comentată din meniu, este înregistrată ca atare, iar o capacitate fără înregistrare în construcția fixată este raportată ca absentă în acea construcție, nu ca absentă permanent.
- Rândurile pentru **Audition** provin din documentația publicată de Adobe pentru versiunea curentă. Ele nu sunt verificate față de o construcție în funcțiune.

## Platformă și termeni

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licență | Da — AGPL-3.0-only | Da — GPL, open source | Nu — proprietar și închis |
| Cost | Da — gratuit | Da — gratuit | Nu — abonament Creative Cloud |
| Rulează într-un browser | Da — Chromium, Firefox și WebKit | Nu — doar desktop | Nu — doar desktop |
| Construcții desktop | Da — Windows și Linux pe x64 și ARM64, macOS pe ARM64 | Da — Windows, macOS, Linux | Parțial — Windows și macOS, fără Linux |
| Funcționează fără cont | Da — nu există cont | Da — autentificarea este necesară doar pentru audio.com | Nu — este necesar un abonament autentificat |
| Stocare de proiecte în cloud | Nu — exclus prin designul local-first | Da — salvare și partajare prin audio.com | Parțial — fișiere Creative Cloud, sesiunile nu se sincronizează |
| Cerințe de sistem | Da — rulează oriunde rulează un browser actualizat | Parțial — crescut semnificativ față de Audacity 3 | Parțial — clasă de stație de lucru profesională |

## Model de proiect și sesiune

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Format nativ de proiect | Da — `.sscape`, o arhivă portabilă fără pierderi | Da — `.aup4` | Da — `.sesx` |
| Deschiderea proiectelor Audacity | Da — import și export AUP4 | Da — nativ | Nu |
| Cronologie de clipuri nedistructivă | Da | Da | Da — editor multitrack |
| Editor dedicat pentru fișier unic | Parțial — editarea probelor are loc în cronologie | Parțial — editările se aplică pe loc în cronologie | Da — editor de formă de undă |
| Conținut mono și stereo pe o singură pistă | Da — o pistă conține fie mono, fie stereo | Nu — o pistă este mono sau stereo | Nu — formatul canalului este fixat per pistă |
| Dosare de piste imbricate | Da — orice adâncime, cu posibilitatea de anulare, cu rutare | Nu | Parțial — doar bus-uri de submix, fără piste de dosar |
| Săculeț de proiect | Da — organizează fișierele și funcționează și ca clipboard | Nu | Parțial — panoul Files listează fișierele deschise |
| Salvare automată și recuperare după eroare | Da — salvare automată, blocări și plicuri de recuperare | Da | Da |
| Marcatori și regiuni denumite | Da — de prim rang, cu navigare și comportament ripple | Parțial — piste de etichete | Da — marcatori și intervale |
| Hărți de tempo și semnătură de compas | Da — hărți ordonate, rezolvate cu precizie la probă | Parțial — un singur tempo și o singură semnătură de compas per proiect | Parțial — un singur tempo per sesiune |

## Înregistrare

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Înregistrare multitrack | Da — mai multe surse simultan | Parțial — un singur dispozitiv de intrare deodată | Da — interfețe multi-intrare și multicanal |
| Audio de microfon și de desktop simultan | Da — integrat | Nu | Parțial — necesită un dispozitiv loopback de sistem de operare |
| Înregistrare programată | Da | Da | Nu |
| Înregistrare activată prin sunet | Da — cu prag reglabil | Da — cu prag reglabil | Nu |
| Numărare înainte de luare | Da — conștient de harta de tempo, gestionează metrul compus | Parțial — înregistrare de introducere | Parțial — pre-roll ca parte a punch and roll |
| Înregistrare punch | Da — o singură tranzacție, capturare implicită și rutată | Nu | Da — punch and roll |
| Înregistrare în buclă în luări | Da — o singură bandă per trecere, adăugată în același grup | Nu | Parțial — luări pe un singur clip, alese dintr-o listă |
| Comping de luări | Da — ascultare, promovare, editare regiuni de comp, aplatizare ca o singură editare anulabilă | Nu | Nu — fără editor de comp |
| Monitorizare și măsurare a intrării | Da | Da | Da |

## Editare cronologie

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Variante de editare în flux (ripple edit) | Da — per clip, per pistă și pe toate pistele, la tăiere și ștergere | Da — aceleași trei, la tăiere și ștergere | Parțial — ștergere în flux pe o selecție sau pe un gol |
| Împărțire, unire și împărțire la tăceri | Da | Da | Parțial — împărțire și decupare, fără unire de clipuri |
| Grupe de clipuri | Da | Da | Da |
| Câștig per clip | Da | Da | Da |
| Ton și viteză per clip | Da — ajustare, randare sau resetare | Da — ajustare, randare sau resetare | Parțial — întinderea rămâne editabilă, tonul este un efect |
| Urmărirea modificărilor de tempo | Da — clipurile se întind când harta se deplasează | Da | Nu |
| Cuantizare și groove conștiente de ritm | Da — hărți de warp cu intensitate de groove ajustabilă | Nu | Nu |
| Aliniere la zerouri de trecere | Da | Da | Da |
| Deseneare la nivel de eșantion | Da | Parțial — nicio acțiune de desenare înregistrată în versiunea fixată | Da — în editorul de formă de undă |
| Editare exclusiv cu tastatura | Da — fiecare primitivă de editare are o acțiune de navigare | Da — fiecare primitivă de editare are o acțiune de navigare | Parțial — scurtături extinse, unele panouri necesită mouse-ul |

## Lucrări spectrale și restaurare

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vizualizare spectrogramă | Da — cu setări per pistă | Da — cu setări per pistă | Da — afișaje de frecvență și ton |
| Selecție delimitată prin frecvență | Da | Da | Da — selecție cu dreptunghi și lasso |
| Pensulă spectrală | Da | Da | Da — pensulă și vindecare punctuală |
| Ștergere sau amplificarea unei regiuni spectrale | Da — ambele ca acțiuni directe | Da — ambele ca acțiuni directe | Parțial — aplicarea unui efect pe selecție |
| Repararea daunelor scurte | Da — Repair | Da — Repair | Da — Auto Heal și Spot Healing Brush |
| Reducerea zgomotului pe bandă largă | Da — cu un profil capturat | Da — cu un profil capturat | Da — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Eliminarea reverberației | Nu | Nu | Da — DeReverb |
| Unelte pentru clicuri, zgomot de rețea și sibilanțe | Parțial — doar Click Removal | Parțial — doar Click Removal | Da — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Panou de diagnostic | Parțial — Find Clipping ca analizor | Parțial — Find Clipping ca analizor | Da — diagnostic cu reparare per problemă |

## Efecte și plug-inuri

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suită de efecte încorporate | Da — cele 30 de efecte Audacity, modulele Nyquist incluse și efectele de primă parte fără echivalent în versiunea upstream, cum ar fi bitcrusher | Da — aceeași colecție încorporată de 30 de efecte | Da — aproximativ cincizeci, inclusiv dinamica multiband |
| Rack de efecte în timp real per pistă | Da — un set mai larg de efecte în timp real decât în versiunea upstream | Da | Da — șaisprezece sloturi per clip, pistă și master |
| EQ parametric | Da — un nou EQ parametric cu benzi automatizabile | Parțial — Filter Curve și Graphic EQ | Da — filtre parametrice, grafice și FFT |
| Preseturi de efecte | Da — aplicare, salvare, import, export | Da — aplicare, salvare, import, export | Da |
| Macro-uri și lanțuri în lot | Da — bibliotecă de macro-uri salvate cu șabloane | Nu — versiunea fixată comentează meniul Macros | Da — Favorites și Batch Process |
| Formate de module terțe | Parțial — VST3, CLAP, AU și LV2, precum și efecte Linux LADSPA și analizatoare Vamp pe desktop, cu consimțământ și izolare; niciunul în browser | Da — VST3, AU, LV2 și Nyquist, cu un manager de module | Parțial — VST3 și AU pe macOS, fără CLAP sau LV2 |
| Scriptare Nyquist | Da — module incluse și promptul Nyquist | Da — module incluse și promptul Nyquist | Nu |
| Pachete de efecte izolate | Parțial — pachete WebAssembly verificate, unul este livrat, iar cele externe sunt izolate | Nu | Nu |
| Instrumente virtuale | Nu — după 1.0 | Nu | Nu |

## Mixaj, rutare și automatizare

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer cu benzi de canale | Da | Parțial — controale de pistă și o pistă master | Da |
| Buse și submixuri | Da — imbricate, cu validare ciclică | Nu | Da — piste de bus |
| Trimiteri (Sends) | Da — pre și post fader, multiple asignări | Nu | Da — pre și post fader |
| Grupe VCA | Da | Nu | Nu |
| Intrare sidechain | Da | Nu | Da — prin trimiteri |
| Mixuri de cue și control-room | Da | Nu | Nu |
| Compensarea întârzierii modulelor | Da — redare, monitorizare, buse, sidechain-uri, randare și înghețare | Parțial — neexpusă în sursele fixate | Da |
| Benzi de automatizare | Da — gain, pan, mute, trimiteri, buse și parametri de module | Nu — fără benzi și fără instrument de anvelopă în versiunea fixată | Da — volum, pan și parametri de efecte |
| Moduri de automatizare | Da — read, trim, touch, latch și write | Nu | Parțial — read, write, latch și touch, fără trim |
| Forme de curbe | Da — linie, hold și curbă | Nu | Da — liniar și spline |
| Înghețarea pistei | Da — înghețare, dezghețare și commit fără pierderea stării | Nu | Parțial — bounce pe o pistă nouă |

## Metrică și analiză

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Indicator de intensitate | Da — stil EBU R 128, cu istoric | Nu — un efect de Normalizare a Intensității, dar fără indicator | Da — Radar de Intensitate conform ITU-R BS.1770 |
| Indicator de fază și corelație | Da | Nu | Da — indicator de fază și analiză |
| Măsurare surround | Da | Nu | Parțial — până la 5.1 |
| Plot de spectru | Da — Plot Spectrum | Parțial — înregistrat, dar compilarea fixată comentează din meniul Analyze | Da — Frequency Analysis |
| Clipping și RMS în forma de undă | Da — ambele, comutate per proiect | Da — ambele, comutate per proiect | Parțial — indicatori de clipping, RMS în Amplitude Statistics |
| Contrast de inteligibilitate a vorbirii | Da — analizator de Contrast | Parțial — înregistrat, dar compilarea fixată comentează din meniul Analyze | Nu |

## Canale și audio imersiv

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canale per fișier | Da — până la 32 pentru formate PCM | Parțial — piste mono și stereo | Da — până la 32 în editorul de formă de undă |
| Mixaj surround | Da — paturi până la 7.1.4 | Nu | Parțial — până la 5.1 |
| Audio bazat pe obiecte | Da — obiecte alături de paturi | Nu | Nu |
| Autoring și passthrough ADM | Da — BW64/ADM cu verificări de conformitate | Nu | Nu |
| Randare binaurală | Da — un model binaural numit | Nu | Parțial — binauraliser pentru ambisonics |
| Ambisonics | Nu | Nu | Da — prim ordin, cu un VR panner |

## Export și livrare

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ieșire fără pierderi | Da — WAV, AIFF, BWF și BW64 scrise nativ | Da — WAV, AIFF și FLAC | Da — WAV, AIFF, FLAC și altele |
| Ieșire cu pierderi | Parțial — MP3, AAC, Opus, Vorbis, MP2, FLAC și WavPack, toate prin runtime-ul FFmpeg | Parțial — MP3 integrat, restul prin o instalare opțională FFmpeg | Da — integrat |
| Setări personalizate de encoder | Da — o țintă FFmpeg personalizată | Da — o țintă FFmpeg personalizată | Da — opțiuni per format |
| Coadă de export | Da — pauză, anulare, reîncercare și rearanjare | Nu — un singur export deodată | Parțial — Batch Process fără control al cozii |
| Stems și variante într-o singură trecere | Da — puse în coadă împreună cu mixajul | Nu | Parțial — un singur mixdown per stem |
| Livrare pe regiuni | Da — secvențe de mastering cu metadate pe regiune, goluri și fade-uri | Parțial — export de etichete, fără export multi-fișier în compilarea fixată | Da — export de marcatori în fișiere separate |
| Normalizare a intensității la export | Da — parte a planului de livrare | Parțial — rulați efectul mai întâi | Da — Match Loudness |
| Dither și mapare de canale | Da — controale explicite | Parțial — dither în preferințe | Da — controale explicite |
| Raport de livrare | Da — detaliat per job | Nu | Nu |
| Coada de randare supraviețuiește unei reporniri | Da — pe desktop, repornire de la zero de octeți cu un jurnal de crăpături | Nu | Nu |

## Schimb de date cu alte instrumente

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Proiecte Audacity | Da — intrare și ieșire AUP4, cu un raport de omisiuni | Da — nativ | Nu |
| EDL | Parțial — export de clasă CMX3600, fără import | Nu | Nu |
| OpenTimelineIO | Parțial — doar export | Nu | Nu |
| FCPXML | Parțial — doar export | Nu | Da — import și export |
| DAWproject | Da — import și export, cu un raport de schimb | Nu | Nu |
| OMF | Nu | Nu | Parțial — import și export |
| Round-trip cu un editor video | Parțial — transmite același proiect către Framescaper fără a copia media | Nu | Da — Dynamic Link cu Premiere Pro |
| Schimb de etichete și marcatori | Da — import și export | Da — import și export | Da — liste de marcatori |

## Video

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Import video pentru referință | Da — pe linia de timp, cu audio asociat | Nu | Parțial — o singură pistă video, doar previzualizare |
| Editare linie de timp video | Parțial — editare de bază, suprafața completă este Framescaper | Nu | Nu |
| Export video | Da — MP4 și WebM prin runtime-ul FFmpeg | Nu | Nu — doar audio |
| Compunere, colorizare și efecte | Parțial — în Framescaper, pe același proiect | Nu | Nu |

## Asistență automatizată

| Capacitate | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Îmbunătățire vorbire | Parțial — doar desktop, odată ce sarcina modelului este instalată | Nu | Da — Enhance Speech |
| Transcriere și diarizare | Parțial — doar desktop, modele opționale | Nu | Nu — transcrierile se află în Premiere Pro |
| Separare sursă în stem-uri | Parțial — doar desktop, modele opționale | Nu | Nu |
| Ducking automat | Da — efect Auto Duck | Da — efect Auto Duck | Da — ducking Essential Sound |
| Detectare ritm și cadre | Parțial — doar desktop, modele opționale | Nu | Parțial — Remix resincronizează automat muzica |
| Rulează integral pe mașina dvs. | Da — inferența este doar desktop și offline după instalare | Da — nicio inferență | Parțial — unele funcții procesează în cloud-ul Adobe |
| Modelele sunt opționale și pot fi eliminate | Da — descărcate separat, fixate prin digest, ștergibile | Da — nimic de instalat | Nu — incluse în aplicație |

## La ce se reduc diferențele

Audacity 4 este un editor cu o singură trecere. Nu are bus-uri, nu are trimiteri, nu are piste de automatizare și nu are macro-uri în versiunea fixată. Soundscaper păstrează acel model de editare și adaugă pe deasupra stratul de mixare, automatizare și livrare, plus înregistrare, video și lucrări de schimb pe care Audacity nu le încearcă.

Audition conduce încă în profunzimea restaurării, în round-trips cu Premiere Pro și în ambisonics. Unde Soundscaper conduce este livrarea imersivă, gestionarea proiectelor și faptul că rulează într-un browser pe hardware pe care niciuna dintre celelalte nu îl suportă.

Dacă deja lucrați în Audacity, consultați
[fișiere de proiect și schimb cu Audacity](/projects-and-data/project-files/) pentru
modul de a transfera un proiect.

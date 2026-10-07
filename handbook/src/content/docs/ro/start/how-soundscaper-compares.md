---
title: "Cum se compară Soundscaper"
description: "Comparați Soundscaper Web și Desktop cu Audacity 4 și Adobe Audition pentru înregistrare, editare, mixare, livrare și interoperabilitate."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"ro"} -->

Soundscaper reimplementează Audacity 4 în browser și adaugă un nivel de producție. Adobe Audition este instrumentul comercial de post-producție cu care sunt comparate de obicei ambele. Această pagină compară Soundscaper Web, Soundscaper Desktop, Audacity 4 și Audition, pentru a vă ajuta să aflați care ediție vă acoperă deja nevoile.

## Cum să citiți această pagină

Fiecare celulă începe cu un simbol colorat, urmat de detaliile care îl explică:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — acceptat sau aplicabil
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — domeniu limitat, depinde de platformă sau necesită o soluție alternativă
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — indisponibil sau neaplicabil

Citiți notele împreună cu simbolurile. Instalarea opțională a unui plugin, model sau codec nu limitează de la sine o funcție desktop acceptată; nota precizează ce trebuie instalat. Web și Desktop au coloane separate, astfel încât o restricție a browserului nu reduce evaluarea Desktop.

Rândurile descriu capacități, nu comenzi de meniu. Pentru inventarul exact al comenzilor, consultați [Comenzi și scurtături](/reference/generated/commands/), iar pentru ceea ce permite fiecare produs, consultați
[Capacitățile produsului](/reference/generated/product-capabilities/).

### De unde provin aceste afirmații

- Rândurile pentru **Soundscaper** se bazează pe acest depozit: profilurile de capabilități ale produselor, manifestul acțiunilor runtime, registrul formatelor de export și verificările codecurilor pentru browser și desktop.
  Payloadurile native pentru desktop sunt generate de CI-ul depozitului sau de împachetarea pentru platforma țintă. Un pachet activează o funcție numai după pregătirea și verificarea rezultatului exact corespunzător; rândurile indică atunci când un payload este încă necesar.
- Rândurile pentru **Audacity 4** pornesc de la inventarul upstream fixat în acest depozit, `4.0.0` la commitul `4c177d43`, și includ modificările vizibile utilizatorilor până la lansarea oficială [`4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt), la commitul `d82386ce`. O funcție înregistrată upstream, dar dezactivată sau comentată din meniu, este indicată ca atare. O funcție care nu apare în inventarul verificat sau în notele de lansare este marcată ca absentă din acel material, nu ca absentă permanent. Desenarea eșantioanelor, anvelopele de volum ale clipurilor și importul proiectelor vechi sunt documentate și în [jurnalul oficial de modificări 4.0](https://www.audacityteam.org/changelog/) și în [manualul pentru volumul clipurilor](https://www.audacityteam.org/manual/clips/clip-gain/).
- Rândurile pentru **Audition** provin din documentația publicată de Adobe pentru versiunea curentă. Ele nu sunt verificate față de o construcție în funcțiune.

## Platformă și termeni

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licență | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, open source | / — proprietar și închis |
| Cost | + — gratuit | + — gratuit | + — gratuit | / — abonament Creative Cloud |
| Rulează într-un browser | + — Chromium, Firefox și WebKit | / — aplicație instalată | / — doar desktop | / — doar desktop |
| Construcții desktop | / — folosiți ediția pentru browser | + — Windows și Linux pe x64 și ARM64, macOS pe ARM64 | + — Windows (instalator sau versiune portabilă), macOS, Linux | ~ — Windows și macOS, fără Linux |
| Funcționează fără cont | + — nu există cont | + — nu există cont | + — autentificarea este necesară doar pentru audio.com | / — este necesar un abonament autentificat |
| Stocare de proiecte în cloud | / — exclus prin designul local-first | / — exclus prin designul local-first | + — salvare și partajare prin audio.com | ~ — fișiere Creative Cloud, sesiunile nu se sincronizează |
| Cerințe de sistem | + — rulează oriunde rulează un browser actualizat | + — Windows, Linux sau macOS pe arhitecturile desktop acceptate | ~ — crescut semnificativ față de Audacity 3 | ~ — clasă de stație de lucru profesională |

## Model de proiect și sesiune

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Format nativ de proiect | + — `.sscape`, o arhivă portabilă fără pierderi | + — `.sscape`, o arhivă portabilă fără pierderi | + — `.aup4` | + — `.sesx` |
| Deschiderea proiectelor Audacity | + — import AUP, AUP3 și AUP4; export AUP3 și AUP4 | + — import AUP, AUP3 și AUP4; export AUP3 și AUP4 | + — import AUP, AUP3 și AUP4; export AUP4, fără export AUP3 | / |
| Cronologie de clipuri nedistructivă | + | + | + | + — editor multitrack |
| Editor dedicat pentru fișier unic | + — editorul formei de undă sursă din proprietățile clipului | + — editorul formei de undă sursă din proprietățile clipului | ~ — editările se aplică pe loc în cronologie | + — editor de formă de undă |
| Conținut mono și stereo pe o singură pistă | + — o pistă conține fie mono, fie stereo | + — o pistă conține fie mono, fie stereo | / — o pistă este mono sau stereo | / — formatul canalului este fixat per pistă |
| Dosare de piste imbricate | + — orice adâncime, cu posibilitatea de anulare, cu rutare | + — orice adâncime, cu posibilitatea de anulare, cu rutare | / | ~ — doar bus-uri de submix, fără piste de dosar |
| Săculeț de proiect | + — organizează fișierele și funcționează și ca clipboard | + — organizează fișierele și funcționează și ca clipboard | / | ~ — panoul Files listează fișierele deschise |
| Salvare automată și recuperare după eroare | + — salvare automată, blocări și plicuri de recuperare | + — salvare automată, blocări și plicuri de recuperare | + | + |
| Marcatori și regiuni denumite | + — de prim rang, cu navigare și comportament ripple | + — de prim rang, cu navigare și comportament ripple | ~ — piste de etichete | + — marcatori și intervale |
| Hărți de tempo și semnătură de compas | + — hărți ordonate, rezolvate cu precizie la probă | + — hărți ordonate, rezolvate cu precizie la probă | ~ — un singur tempo și o singură semnătură de compas per proiect | ~ — un singur tempo per sesiune |

## Înregistrare

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Înregistrare multitrack | + — mai multe surse simultan | + — mai multe surse simultan | ~ — un singur dispozitiv de intrare deodată | + — interfețe multi-intrare și multicanal |
| Audio de microfon și de desktop simultan | ~ — integrat acolo unde browserul și sistemul de operare oferă acces la sunetul ecranului | + — microfon și captură audio desktop pe Windows; celelalte sisteme folosesc o intrare loopback | / | ~ — necesită un dispozitiv loopback de sistem de operare |
| Înregistrare programată | + | + | + | / |
| Înregistrare activată prin sunet | + — cu prag reglabil | + — cu prag reglabil | + — cu prag reglabil | / |
| Numărare înainte de luare | + — conștient de harta de tempo, gestionează metrul compus | + — conștient de harta de tempo, gestionează metrul compus | ~ — înregistrare de introducere | ~ — pre-roll ca parte a punch and roll |
| Înregistrare punch | + — o singură tranzacție, capturare implicită și rutată | + — o singură tranzacție, capturare implicită și rutată | / | + — punch and roll |
| Înregistrare în buclă în luări | + — o singură bandă per trecere, adăugată în același grup | + — o singură bandă per trecere, adăugată în același grup | / | ~ — luări pe un singur clip, alese dintr-o listă |
| Comping de luări | + — ascultare, promovare, editare regiuni de comp, aplatizare ca o singură editare anulabilă | + — ascultare, promovare, editare regiuni de comp, aplatizare ca o singură editare anulabilă | / | / — fără editor de comp |
| Monitorizare și măsurare a intrării | + | + | + | + |

## Editare cronologie

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Variante de editare în flux (ripple edit) | + — per clip, per pistă și pe toate pistele, la tăiere și ștergere | + — per clip, per pistă și pe toate pistele, la tăiere și ștergere | + — aceleași trei, la tăiere și ștergere | ~ — ștergere în flux pe o selecție sau pe un gol |
| Împărțire, unire și împărțire la tăceri | + | + | + | ~ — împărțire și decupare, fără unire de clipuri |
| Grupe de clipuri | + | + | + | + |
| Câștig per clip | + | + | + | + |
| Ton și viteză per clip | + — ajustare, randare sau resetare | + — ajustare, randare sau resetare | + — ajustare, randare sau resetare | ~ — întinderea rămâne editabilă, tonul este un efect |
| Urmărirea modificărilor de tempo | + — clipurile se întind când harta se deplasează | + — clipurile se întind când harta se deplasează | + | / |
| Cuantizare și groove conștiente de ritm | + — hărți de warp cu intensitate de groove ajustabilă | + — hărți de warp cu intensitate de groove ajustabilă | / | / |
| Aliniere la zerouri de trecere | + | + | + | + |
| Deseneare la nivel de eșantion | + | + | + — disponibilă la mărire până la eșantioane individuale | + — în editorul de formă de undă |
| Editare exclusiv cu tastatura | + — fiecare primitivă de editare are o acțiune de navigare | + — fiecare primitivă de editare are o acțiune de navigare | + — acțiunile de editare, cronologia și riglele verticale ale pistelor pot fi controlate de la tastatură | ~ — scurtături extinse, unele panouri necesită mouse-ul |

## Lucrări spectrale și restaurare

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Vizualizare spectrogramă | + — cu setări per pistă | + — cu setări per pistă | + — cu setări per pistă | + — afișaje de frecvență și ton |
| Selecție delimitată prin frecvență | + | + | + | + — selecție cu dreptunghi și lasso |
| Pensulă spectrală | + | + | + | + — pensulă și vindecare punctuală |
| Ștergere sau amplificarea unei regiuni spectrale | + — ambele ca acțiuni directe | + — ambele ca acțiuni directe | + — ambele ca acțiuni directe | ~ — aplicarea unui efect pe selecție |
| Repararea daunelor scurte | + — Repair | + — Repair | + — Repair | + — Auto Heal și Spot Healing Brush |
| Reducerea zgomotului pe bandă largă | + — cu un profil capturat | + — cu un profil capturat | + — cu un profil capturat | + — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Eliminarea reverberației | / — asistență disponibilă doar în Desktop | + — Reduce Reverb, cu modelul și motorul opționale instalate | / | + — DeReverb |
| Unelte pentru clicuri, zgomot de rețea și sibilanțe | ~ — Click Removal și De-esser; fără instrument dedicat pentru eliminarea bâzâitului | ~ — Click Removal și De-esser; fără instrument dedicat pentru eliminarea bâzâitului | ~ — doar Click Removal | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Panou de diagnostic | ~ — Find Clipping ca analizor | ~ — Find Clipping ca analizor | ~ — Find Clipping ca analizor | + — diagnostic cu reparare per problemă |

## Efecte și plug-inuri

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Suită de efecte încorporate | + — efecte derivate din Audacity, pluginuri Nyquist incluse și efecte proprii precum Bitcrusher și De-esser | + — efecte derivate din Audacity, pluginuri Nyquist incluse și efecte proprii precum Bitcrusher și De-esser | + — 30 de efecte integrate în versiunea fixată | + — aproximativ cincizeci, inclusiv dinamica multiband |
| Rack de efecte în timp real per pistă | + — un set mai larg de efecte în timp real decât în versiunea upstream | + — un set mai larg de efecte în timp real decât în versiunea upstream | + | + — șaisprezece sloturi per clip, pistă și master |
| EQ parametric | + — un nou EQ parametric cu benzi automatizabile | + — un nou EQ parametric cu benzi automatizabile | ~ — Filter Curve și Graphic EQ | + — filtre parametrice, grafice și FFT |
| Preseturi de efecte | + — aplicare, salvare, import, export | + — aplicare, salvare, import, export | + — aplicare, salvare, import, export | + |
| Macro-uri și lanțuri în lot | + — bibliotecă de macro-uri salvate cu șabloane | + — bibliotecă de macro-uri salvate cu șabloane | / — versiunea fixată comentează meniul Macros | + — Favorites și Batch Process |
| Formate de module terțe | / — pluginurile native necesită Desktop | + — VST3, CLAP, AU, LV2, Linux LADSPA și Vamp; diferă în funcție de platformă, cu consimțământ și izolare | + — VST3, AU, LV2 și Nyquist, cu un manager de module | ~ — VST3 și AU pe macOS, fără CLAP sau LV2 |
| Scriptare Nyquist | + — module incluse și promptul Nyquist | + — module incluse și promptul Nyquist | + — module incluse și promptul Nyquist | / |
| Pachete de efecte izolate | ~ — pachete WebAssembly verificate, unul este livrat, iar cele externe sunt izolate | ~ — pachete WebAssembly verificate, unul este livrat, iar cele externe sunt izolate | / | / |
| Instrumente virtuale | / | / | / | / |

## Mixaj, rutare și automatizare

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixer cu benzi de canale | + | + | ~ — controale de pistă și o pistă master | + |
| Buse și submixuri | + — imbricate, cu validare ciclică | + — imbricate, cu validare ciclică | / | + — piste de bus |
| Trimiteri (Sends) | + — pre și post fader, multiple asignări | + — pre și post fader, multiple asignări | / | + — pre și post fader |
| Grupe VCA | + | + | / | / |
| Intrare sidechain | + | + | / | + — prin trimiteri |
| Mixuri de cue și control-room | + | + | / | / |
| Compensarea întârzierii modulelor | + — redare, monitorizare, buse, sidechain-uri, randare și înghețare | + — redare, monitorizare, buse, sidechain-uri, randare și înghețare | ~ — neexpusă în sursele fixate | + |
| Benzi de automatizare | + — gain, pan, mute, trimiteri, buse și parametri de module | + — gain, pan, mute, trimiteri, buse și parametri de module | ~ — anvelope de volum pentru clip; fără piste de automatizare pentru piste sau efecte | + — volum, pan și parametri de efecte |
| Moduri de automatizare | + — read, trim, touch, latch și write | + — read, trim, touch, latch și write | / | ~ — read, write, latch și touch, fără trim |
| Forme de curbe | + — linie, hold și curbă | + — linie, hold și curbă | ~ — doar anvelope de volum pentru clip | + — liniar și spline |
| Înghețarea pistei | + — înghețare, dezghețare și commit fără pierderea stării | + — înghețare, dezghețare și commit fără pierderea stării | / | ~ — bounce pe o pistă nouă |

## Metrică și analiză

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Indicator de intensitate | + — stil EBU R 128, cu istoric | + — stil EBU R 128, cu istoric | / — un efect de Normalizare a Intensității, dar fără indicator | + — Radar de Intensitate conform ITU-R BS.1770 |
| Indicator de fază și corelație | + | + | / | + — indicator de fază și analiză |
| Măsurare surround | + | + | / | ~ — până la 5.1 |
| Plot de spectru | + — Plot Spectrum | + — Plot Spectrum | ~ — înregistrat, dar compilarea fixată comentează din meniul Analyze | + — Frequency Analysis |
| Clipping și RMS în forma de undă | + — setare la nivel de proiect, cu valori RMS configurabile pentru fiecare pistă | + — setare la nivel de proiect, cu valori RMS configurabile pentru fiecare pistă | + — ambele, comutate per proiect | ~ — indicatori de clipping, RMS în Amplitude Statistics |
| Contrast de inteligibilitate a vorbirii | + — analizator de Contrast | + — analizator de Contrast | ~ — înregistrat, dar compilarea fixată comentează din meniul Analyze | / |

În Soundscaper, deschideți meniul **Track visualization** al unei piste pentru a activa sau dezactiva **Half-wave** ori **Show RMS in waveform**. Afișarea implicită, frecvențele de crossover cu 3 benzi și setările spectrogramei se găsesc la **Edit → Preferences → Track display**.

## Canale și audio imersiv

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Canale per fișier | + — până la 32 pentru formate PCM | + — până la 32 pentru formate PCM | ~ — piste mono și stereo | + — până la 32 în editorul de formă de undă |
| Mixaj surround | + — paturi până la 7.1.4 | + — paturi până la 7.1.4 | / | ~ — până la 5.1 |
| Audio bazat pe obiecte | + — obiecte alături de paturi | + — obiecte alături de paturi | / | / |
| Autoring și passthrough ADM | + — BW64/ADM cu verificări de conformitate | + — BW64/ADM cu verificări de conformitate | / | / |
| Randare binaurală | + — un model binaural numit | + — un model binaural numit | / | ~ — binauraliser pentru ambisonics |
| Ambisonics | / | / | / | + — prim ordin, cu un VR panner |

## Export și livrare

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ieșire fără pierderi | + — scriere nativă WAV, AIFF, BWF și BW64; FLAC și WavPack prin codecuri dedicate | + — scriere nativă WAV, AIFF, BWF și BW64; FLAC și WavPack prin codecuri dedicate | + — WAV, AIFF și FLAC | + — WAV, AIFF, FLAC și altele |
| Ieșire cu pierderi | ~ — MP3, MP2, Opus și Ogg Vorbis; AAC depinde de browser | + — MP3, MP2, Opus, Ogg Vorbis și AAC prin furnizori de codec acceptați, inclusiv FFmpeg configurat | + — MP3, Opus și Ogg Vorbis; formate suplimentare prin FFmpeg opțional | ~ — MP2, MP3 și Ogg Vorbis; altele prin Adobe Media Encoder, fără o destinație FFmpeg generală |
| Setări personalizate de encoder | ~ — controale pentru fiecare format; argumentele FFmpeg personalizate nu sunt disponibile | ~ — controale pentru fiecare format; argumentele FFmpeg personalizate nu sunt disponibile | + — o țintă FFmpeg personalizată | + — opțiuni per format |
| Coadă de export | + — pauză, anulare, reîncercare și rearanjare | + — pauză, anulare, reîncercare și rearanjare | / — Export Multiple este o operațiune secvențială, nu o coadă de sarcini | ~ — Batch Process fără control al cozii |
| Stems și variante într-o singură trecere | + — puse în coadă împreună cu mixajul | + — puse în coadă împreună cu mixajul | ~ — Export Multiple scrie fiecare pistă separat, dar nu pune în aceeași coadă mixajul și randările alternative | ~ — un singur mixdown per stem |
| Livrare pe regiuni | + — secvențe de mastering cu metadate pe regiune, goluri și fade-uri | + — secvențe de mastering cu metadate pe regiune, goluri și fade-uri | + — Export Multiple scrie fiecare regiune etichetată într-un fișier separat | + — export de marcatori în fișiere separate |
| Normalizare a intensității la export | + — parte a planului de livrare | + — parte a planului de livrare | ~ — rulați efectul mai întâi | + — Match Loudness |
| Dither și mapare de canale | + — controale explicite | + — controale explicite | ~ — dither în preferințe | + — controale explicite |
| Raport de livrare | + — detaliat per job | + — detaliat per job | / | / |
| Coada de randare supraviețuiește unei reporniri | / — recuperarea persistentă a randării necesită Desktop | + — repornește de la octetul zero folosind un jurnal de blocare | / | / |

Soundscaper Desktop poate folosi FFmpeg configurat pentru formatele de export acceptate; editorul actual nu expune argumente FFmpeg arbitrare sau fiecare encoder FFmpeg. Consultați [Formate de export](/reference/generated/formats/) pentru destinațiile înregistrate. [Fluxul de export din Audacity](https://www.audacityteam.org/manual/getting-started/export-your-audio/) adaugă formate printr-o instalare opțională FFmpeg. Audition oferă un set fix de formate pentru scrierea fișierelor și o [predare către Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Schimb de date cu alte instrumente

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Proiecte Audacity | + — import AUP, AUP3 și AUP4; export AUP3 și AUP4 cu un raport de compatibilitate | + — import AUP, AUP3 și AUP4; export AUP3 și AUP4 cu un raport de compatibilitate | + — import AUP, AUP3 și AUP4; export AUP4, fără export AUP3 | / |
| Sesiuni Audition | / — importul SESX necesită Desktop | ~ — import audio din `.sesx` cu un raport al elementelor omise; fără export | / — fără import SESX în versiunea fixată | + — nativ |
| EDL | ~ — export de clasă CMX3600, fără import | ~ — export de clasă CMX3600, fără import | / | / |
| OpenTimelineIO | ~ — doar export | ~ — doar export | / | / |
| FCPXML | ~ — doar export | ~ — doar export | / | + — import și export |
| DAWproject | + — import și export, cu un raport de schimb | + — import și export, cu un raport de schimb | / | / |
| OMF | / | / | / | ~ — import și export |
| Round-trip cu un editor video | ~ — transmite același proiect către Framescaper fără a copia media | ~ — transmite același proiect către Framescaper fără a copia media | / | + — Dynamic Link cu Premiere Pro |
| Schimb de etichete și marcatori | + — import și export | + — import și export | + — import și export | + — liste de marcatori |

Pentru importarea în Soundscaper a unui fișier `.sesx` provenit din Audition, consultați [Fișiere de proiect](/projects-and-data/project-files/) pentru a vedea ce setări audio se transferă și ce marchează raportul ca omis.

## Video

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Import video pentru referință | + — pe linia de timp, cu audio asociat | + — pe linia de timp, cu audio asociat | / | ~ — o singură pistă video, doar previzualizare |
| Editare linie de timp video | ~ — editare de bază, suprafața completă este Framescaper | ~ — editare de bază, suprafața completă este Framescaper | / | / |
| Export video | ~ — MP4 și WebM acolo unde WebCodecs din browser acceptă codecurile necesare | + — MP4 și WebM cu un furnizor de codec verificat pentru desktop | / | / — doar audio |
| Compunere, colorizare și efecte | ~ — în Framescaper, pe același proiect | ~ — în Framescaper, pe același proiect | / | / |

## Asistență automatizată

Asistența Desktop este disponibilă după instalarea ponderilor opționale ale modelului și a unui motor nativ compatibil; aceste fluxuri nu sunt disponibile în Web. Model Manager le instalează pe ambele. Consultați [Asistență locală](/reference/generated/local-assistance/) pentru fluxurile și modelele disponibile.

| Capacitate | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Îmbunătățire vorbire | / — asistență disponibilă doar în Desktop | + — cu modelul și motorul opționale instalate | / | + — Enhance Speech |
| Transcriere și diarizare | / — asistență disponibilă doar în Desktop | + — cu modelele și motoarele opționale instalate | / | / — transcrierile se află în Premiere Pro |
| Separare sursă în stem-uri | / — asistență disponibilă doar în Desktop | + — cu modelul și motorul opționale instalate | / | / |
| Ducking automat | + — efect Auto Duck | + — efect Auto Duck | + — efect Auto Duck | + — ducking Essential Sound |
| Detectare ritm și cadre | / — detectarea ritmului necesită Desktop; detectarea cadrelor este în Framescaper | ~ — detectarea ritmului cu un model opțional; detectarea cadrelor este în Framescaper | / | ~ — Remix resincronizează automat muzica |
| Rulează integral pe mașina dvs. | + — procesare locală în browser; fără inferență de model | + — procesare locală și inferență offline după instalarea modelului | + — nicio inferență | ~ — unele funcții procesează în cloud-ul Adobe |
| Modelele sunt opționale și pot fi eliminate | / — fără instalarea modelelor în Web | + — descărcate separat, fixate prin digest, ștergibile | + — nimic de instalat | / — incluse în aplicație |

## La ce se reduc diferențele

Audacity 4 este un editor cu o singură trecere. În versiunea fixată nu există magistrale, trimiteri, piste de automatizare pentru piste sau efecte și nici macrocomenzi. Anvelopele de volum ale clipurilor permit automatizarea volumului în interiorul unui clip. Soundscaper păstrează acest model de editare și adaugă automatizarea pistelor și efectelor, mixarea și livrarea, precum și funcții de înregistrare, video și interoperabilitate pe care Audacity nu le oferă.

Audition conduce încă în profunzimea restaurării, în round-trips cu Premiere Pro și în ambisonics. Unde Soundscaper conduce este livrarea imersivă, gestionarea proiectelor și faptul că rulează într-un browser pe hardware pe care niciuna dintre celelalte nu îl suportă.

Dacă deja lucrați în Audacity, consultați
[fișiere de proiect și schimb cu Audacity](/projects-and-data/project-files/) pentru
modul de a transfera un proiect.

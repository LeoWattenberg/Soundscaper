---
title: "Confronto tra Soundscaper"
description: "Confronta Soundscaper Web e Desktop con Audacity 4 e Adobe Audition per registrazione, modifica, missaggio, consegna e interscambio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"it"} -->

Soundscaper reimplementa Audacity 4 sul web e vi aggiunge un livello di produzione. Adobe Audition è lo strumento commerciale di post-produzione con cui entrambi vengono solitamente confrontati. Questa pagina confronta Soundscaper Web e Desktop, Audacity 4 e Audition per aiutarti a capire quale edizione svolge già il lavoro che ti serve.

## Come leggere questa pagina

Ogni cella inizia con un simbolo colorato, seguito dalla precisazione corrispondente:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — supportato o applicabile
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — ambito limitato, dipendente dalla piattaforma o raggiungibile con una soluzione alternativa
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — non disponibile o non applicabile

Leggi le note insieme ai simboli. L’installazione facoltativa di un plug-in, modello o codec non rende di per sé limitata una funzionalità desktop supportata; la nota specifica cosa occorre installare. Web e Desktop hanno colonne distinte, quindi una limitazione del browser non riduce la valutazione di Desktop.

Le righe descrivono le funzionalità, non i comandi del menu. Per l'elenco completo dei comandi, vedi [Comandi e scorciatoie](/reference/generated/commands/), e per le funzionalità abilitate da ciascun prodotto, vedi [Funzionalità del prodotto](/reference/generated/product-capabilities/).

### Origine di queste affermazioni

- Le righe di **Soundscaper** provengono da questo repository: i profili delle capacità del prodotto, il manifesto delle azioni di runtime, il registro dei formati di esportazione e i controlli di supporto dei codec per browser e desktop.
  I payload nativi desktop sono generati dalla CI del repository o dal packaging del target. Un pacchetto abilita una funzione solo dopo aver preparato e verificato il risultato esatto corrispondente; queste righe indicano quando serve ancora un payload.
- Le righe di **Audacity 4** partono dall’inventario upstream fissato in questo repository, `4.0.0` al commit `4c177d43`, e comprendono le modifiche visibili agli utenti fino alla [versione ufficiale `4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt), al commit `d82386ce`. Una funzionalità registrata da upstream ma lasciata disattivata o esclusa dal menu con un commento viene indicata come tale. Se non compare nell’inventario verificato né nelle note di rilascio, viene segnalata come assente da quel materiale, non come permanentemente assente. Anche il disegno dei campioni, gli inviluppi di guadagno dei clip e l’importazione dei progetti legacy sono documentati nel [changelog ufficiale 4.0](https://www.audacityteam.org/changelog/) e nel [manuale del guadagno dei clip](https://www.audacityteam.org/manual/clips/clip-gain/).
- Le righe **Audition** provengono dalla documentazione pubblicata di Adobe per l'ultima versione. Non sono verificate su un'installazione in esecuzione.

## Piattaforma e termini

| Funzionalità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licenza | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, open source | / — proprietaria e chiusa |
| Costo | + — gratuito | + — gratuito | + — gratuito | / — abbonamento Creative Cloud |
| Esegue in un browser | + — Chromium, Firefox e WebKit | / — applicazione pacchettizzata | / — solo desktop | / — solo desktop |
| Versioni desktop | / — usa l’edizione web | + — Windows e Linux su x64 e ARM64, macOS su ARM64 | + — Windows (programma d’installazione o versione portatile), macOS, Linux | ~ — Windows e macOS, nessun Linux |
| Funziona senza account | + — nessun account esiste | + — nessun account esiste | + — accesso solo per audio.com | / — accesso con abbonamento richiesto |
| Archiviazione progetti cloud | / — esclusa dal design incentrato sul locale | / — esclusa dal design incentrato sul locale | + — salva e condividi tramite audio.com | ~ — file Creative Cloud, le sessioni non vengono sincronizzate |
| Requisiti di sistema | + — esegue ovunque un browser moderno | + — Windows, Linux o macOS sulle architetture desktop supportate | ~ — aumentati in modo sostanziale rispetto ad Audacity 3 | ~ — classe di workstation professionale |

## Modello di progetto e sessione

| Funzionalità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Formato progetto nativo | + — `.sscape`, un archivio portatile senza perdita di dati | + — `.sscape`, un archivio portatile senza perdita di dati | + — `.aup4` | + — `.sesx` |
| Apre progetti Audacity | + — importazione AUP, AUP3 e AUP4; esportazione AUP3 e AUP4 | + — importazione AUP, AUP3 e AUP4; esportazione AUP3 e AUP4 | + — importazione AUP, AUP3 e AUP4; esportazione AUP4, nessuna esportazione AUP3 | / |
| Timeline clip non distruttiva | + | + | + | + — editor multitrack |
| Editor singolo file dedicato | + — editor della forma d’onda sorgente nelle proprietà del clip | + — editor della forma d’onda sorgente nelle proprietà del clip | ~ — gli edit vengono applicati in loco nella timeline | + — editor delle forme d'onda |
| Contenuto mono e stereo su una singola traccia | + — una traccia contiene o l'uno o l'altro | + — una traccia contiene o l'uno o l'altro | / — una traccia è mono o stereo | / — il formato del canale è fisso per traccia |
| Cartelle di tracce annidate | + — a qualsiasi profondità, annullabile, con routing | + — a qualsiasi profondità, annullabile, con routing | / | ~ — solo bus di submix, nessuna traccia di cartella |
| Bin del progetto | + — organizza i file e funge da appunti | + — organizza i file e funge da appunti | / | ~ — il pannello File elenca i file aperti |
| Autosave e recupero in caso di crash | + — autosave, lucchetti e inviluppi di recupero | + — autosave, lucchetti e inviluppi di recupero | + | + |
| Marker e regioni denominate | + — di prima classe, con navigazione e comportamento a ondata | + — di prima classe, con navigazione e comportamento a ondata | ~ — tracce di etichette | + — marker e intervalli |
| Mappe di tempo e firma | + — mappe ordinate risolte con precisione campionaria | + — mappe ordinate risolte con precisione campionaria | ~ — un tempo e una firma di progetto | ~ — un tempo di sessione |

## Registrazione

| Funzionalità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Registrazione multitrack | + — più sorgenti contemporaneamente | + — più sorgenti contemporaneamente | ~ — un dispositivo di ingresso alla volta | + — interfacce multi-input e multicanale |
| Microfono e audio desktop insieme | ~ — integrato dove browser e sistema operativo consentono di acquisire l’audio dello schermo | + — microfono e loopback dell’audio desktop su Windows; sugli altri sistemi serve un ingresso loopback | / | ~ — richiede un dispositivo di loopback del sistema operativo |
| Registrazione temporizzata | + | + | + | / |
| Registrazione attivata dal suono | + — con una soglia impostabile | + — con una soglia impostabile | + — con una soglia impostabile | / |
| Count-in prima della ripresa | + — consapevole della mappa del tempo, gestisce il metro composto | + — consapevole della mappa del tempo, gestisce il metro composto | ~ — registrazione di lead-in | ~ — pre-roll come parte di punch and roll |
| Registrazione punch | + — una transazione, cattura predefinita e instradata | + — una transazione, cattura predefinita e instradata | / | + — punch and roll |
| Registrazione a ciclo in riprese | + — una corsia per passaggio, aggiunta allo stesso gruppo | + — una corsia per passaggio, aggiunta allo stesso gruppo | / | ~ — riprese su un clip, scelte da un elenco |
| Comping delle riprese | + — audition, promuovi, modifica le regioni comp, appiattisci come un'unica modifica annullabile | + — audition, promuovi, modifica le regioni comp, appiattisci come un'unica modifica annullabile | / | / — nessun editor comp |
| Monitoraggio e misurazione dell'input | + | + | + | + |

## Modifica della timeline

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Varianti di modifica a cascata | + — per clip, per traccia e per tutte le tracce, al taglio e alla cancellazione | + — per clip, per traccia e per tutte le tracce, al taglio e alla cancellazione | + — le stesse tre, al taglio e alla cancellazione | ~ — cancellazione a cascata su una selezione o un vuoto |
| Dividi, unisciti e dividi nei silenzi | + | + | + | ~ — dividi e ritaglia, nessuna unione di clip |
| Gruppi di clip | + | + | + | + |
| Guadagno clip | + | + | + | + |
| Pitch e velocità per clip | + — regola, renderizza o reimposta | + — regola, renderizza o reimposta | + — regola, renderizza o reimposta | ~ — lo stretch rimane modificabile, il pitch è un effetto |
| Segui i cambiamenti di tempo | + — le clip si allungano quando la mappa si sposta | + — le clip si allungano quando la mappa si sposta | + | / |
| Quantizzazione consapevole del battito e groove | + — mappe di warp con forza del groove regolabile | + — mappe di warp con forza del groove regolabile | / | / |
| Aggancia a zero attraversamenti | + | + | + | + |
| Disegno a livello di campione | + | + | + — disponibile con ingrandimento fino ai singoli campioni | + — nel editor delle forme d'onda |
| Modifica solo tastiera | + — ogni primitiva di modifica ha un'azione di navigazione | + — ogni primitiva di modifica ha un'azione di navigazione | + — le azioni di modifica, la timeline e i righelli verticali delle tracce sono navigabili da tastiera | ~ — scorciatoie estese, alcune finestre richiedono il mouse |

## Lavoro e ripristino spettrale

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Vista spettrogramma | + — con impostazioni per traccia | + — con impostazioni per traccia | + — con impostazioni per traccia | + — visualizzazioni di frequenza e pitch |
| Selezione limitata in frequenza | + | + | + | + — selezione a bandiera e lasso |
| Pennello spettrale | + | + | + | + — pennello e pennello di guarigione puntuale |
| Cancella o amplifica una regione spettrale | + — entrambe come azioni dirette | + — entrambe come azioni dirette | + — entrambe come azioni dirette | ~ — applica un effetto alla selezione |
| Ripara danni brevi | + — Ripara | + — Ripara | + — Ripara | + — Auto Heal e Pennello di Guarigione Puntuale |
| Riduzione del rumore a banda larga | + — con un profilo catturato | + — con un profilo catturato | + — con un profilo catturato | + — Riduzione del Rumore, Riduzione del Rumore Adattiva, DeNoise |
| De-reverb | / — solo assistenza desktop | + — Riduci riverbero, con modello e motore facoltativi installati | / | + — DeReverb |
| Strumenti per click, ronzio e sibilanza | ~ — Rimozione clic e De-esser; nessuno strumento dedicato alla rimozione del ronzio | ~ — Rimozione clic e De-esser; nessuno strumento dedicato alla rimozione del ronzio | ~ — Solo Rimozione Click | + — DeClicker, DeHummer, DeEsser, Eliminatore Click/Pop |
| Pannello diagnostico | ~ — Trova Clip come analizzatore | ~ — Trova Clip come analizzatore | ~ — Trova Clip come analizzatore | + — diagnostica con riparazione per problema |

## Effetti e plug-in

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Suite di effetti integrati | + — effetti derivati da Audacity, plug-in Nyquist inclusi ed effetti proprietari come Bitcrusher e De-esser | + — effetti derivati da Audacity, plug-in Nyquist inclusi ed effetti proprietari come Bitcrusher e De-esser | + — 30 effetti integrati nella build fissata | + — circa cinquanta, inclusi dinamici multi-banda |
| Rack di effetti in tempo reale per traccia | + — un set più ampio di effetti in tempo reale rispetto a quello a monte | + — un set più ampio di effetti in tempo reale rispetto a quello a monte | + | + — sedici slot per clip, traccia e master |
| EQ parametrico | + — un nuovo EQ parametrico con bande automatizzabili | + — un nuovo EQ parametrico con bande automatizzabili | ~ — Curva del Filtro e EQ Grafico | + — EQ parametrico, grafico e FFT |
| Preset degli effetti | + — applica, salva, importa, esporta | + — applica, salva, importa, esporta | + — applica, salva, importa, esporta | + |
| Macro e catene di batch | + — libreria di macro salvate con modelli | + — libreria di macro salvate con modelli | / — la build bloccata commenta fuori il menu Macro | + — Preferiti e Elaborazione Batch |
| Formati di plug-in di terze parti | / — i plug-in nativi richiedono Desktop | + — VST3, CLAP, AU, LV2, LADSPA per Linux e Vamp; supporto specifico per piattaforma, con consenso e isolamento | + — VST3, AU, LV2 e Nyquist, con un gestore di plug-in | ~ — VST3 e AU su macOS, nessun CLAP o LV2 |
| Scripting Nyquist | + — plug-in integrati e prompt Nyquist | + — plug-in integrati e prompt Nyquist | + — plug-in integrati e prompt Nyquist | / |
| Pacchetti di effetti sandbox | ~ — pacchetti WebAssembly esaminati, uno spedisce e quelli esterni sono recintati | ~ — pacchetti WebAssembly esaminati, uno spedisce e quelli esterni sono recintati | / | / |
| Strumenti virtuali | / | / | / | / |

## Miscelazione, instradamento e automazione

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixer con strisce di canale | + | + | ~ — controlli di traccia e una traccia master | + |
| Bus e submix | + — annidati, con convalida del ciclo | + — annidati, con convalida del ciclo | / | + — tracce di bus |
| Invii | + — pre e post fader, molteplici assegnazioni | + — pre e post fader, molteplici assegnazioni | / | + — pre e post fader |
| Gruppi VCA | + | + | / | / |
| Input a catena laterale | + | + | / | + — attraverso gli invii |
| Miscele di cue e control room | + | + | / | / |
| Compensazione del ritardo dei plug-in | + — riproduzione, monitoraggio, bus, catene laterali, render e freeze | + — riproduzione, monitoraggio, bus, catene laterali, render e freeze | ~ — non esposto nelle fonti bloccate | + |
| Corsie di automazione | + — guadagno, panoramica, muto, invii, bus e parametri dei plug-in | + — guadagno, panoramica, muto, invii, bus e parametri dei plug-in | ~ — inviluppi di guadagno del clip; nessuna corsia di automazione per tracce o effetti | + — volume, panoramica e parametri degli effetti |
| Modalità di automazione | + — leggi, ritaglia, tocca, aggancia e scrivi | + — leggi, ritaglia, tocca, aggancia e scrivi | / | ~ — leggi, scrivi, aggancia e tocca, nessun ritaglia |
| Forme delle curve | + — linea, tieni e curva | + — linea, tieni e curva | ~ — solo inviluppi di guadagno del clip | + — lineare e spline |
| Congelamento della traccia | + — congela, scongela e impegna senza perdere lo stato | + — congela, scongela e impegna senza perdere lo stato | / | ~ — rimbalza su una nuova traccia |

## Metering e analisi

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Metro di loudness | + — stile EBU R 128, con cronologia | + — stile EBU R 128, con cronologia | / — un effetto di Normalizzazione del Loudness ma nessun metro | + — Loudness Radar fino a ITU-R BS.1770 |
| Metro di fase e correlazione | + | + | / | + — metro di fase e analisi |
| Metering surround | + | + | / | ~ — fino a 5.1 |
| Trama dello spettro | + — Trama Spettro | + — Trama Spettro | ~ — registrato, ma la build bloccata commenta fuori dal menu Analizza | + — Analisi di Frequenza |
| Clipping e RMS nella forma d'onda | + — opzioni a livello di progetto con impostazioni RMS per singola traccia | + — opzioni a livello di progetto con impostazioni RMS per singola traccia | + — entrambi, attivati per progetto | ~ — indicatori di clip, RMS in Statistiche Ampiezza |
| Contrasto di intelligibilità del parlato | + — Analizzatore di Contrasto | + — Analizzatore di Contrasto | ~ — registrato, ma la build bloccata commenta fuori dal menu Analizza | / |

In Soundscaper, apri il menu **Visualizzazione traccia** di una traccia per attivare **Mezza onda** o **Mostra RMS nella forma d’onda**. La vista predefinita, le frequenze di crossover a 3 bande e le impostazioni dello spettrogramma si trovano in **Modifica → Preferenze → Visualizzazione traccia**.

## Canali e audio immersivo

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Canali per file | + — fino a 32 per formati PCM | + — fino a 32 per formati PCM | ~ — tracce mono e stereo | + — fino a 32 nell'editor delle forme d'onda |
| Mixaggio surround | + — letti fino a 7.1.4 | + — letti fino a 7.1.4 | / | ~ — fino a 5.1 |
| Audio basato su oggetti | + — oggetti insieme ai letti | + — oggetti insieme ai letti | / | / |
| Autore ADM e pass-through | + — BW64/ADM con controlli di conformità | + — BW64/ADM con controlli di conformità | / | / |
| Rendering binaurale | + — un modello binaurale denominato | + — un modello binaurale denominato | / | ~ — binauralizzatore per ambisonica |
| Ambisonica | / | / | / | + — primo ordine, con un panner VR |

## Esportazione e consegna

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Output senza perdite | + — WAV, AIFF, BWF e BW64 nativi; FLAC e WavPack tramite codec dedicati | + — WAV, AIFF, BWF e BW64 nativi; FLAC e WavPack tramite codec dedicati | + — WAV, AIFF e FLAC | + — WAV, AIFF, FLAC e altro |
| Output con perdita | ~ — MP3, MP2, Opus e Ogg Vorbis; AAC dipende dal browser | + — MP3, MP2, Opus, Ogg Vorbis e AAC tramite provider di codec supportati, incluso FFmpeg configurato | + — MP3, Opus e Ogg Vorbis; altri formati tramite FFmpeg facoltativo | ~ — MP2, MP3 e Ogg Vorbis; altri tramite Adobe Media Encoder, nessun target FFmpeg generale |
| Impostazioni codificatore personalizzate | ~ — controlli per formato; gli argomenti FFmpeg personalizzati non sono disponibili | ~ — controlli per formato; gli argomenti FFmpeg personalizzati non sono disponibili | + — un target FFmpeg personalizzato | + — opzioni per formato |
| Coda di esportazione | + — pausa, annulla, riprova e riordina | + — pausa, annulla, riprova e riordina | / — Esporta più file è una singola operazione sequenziale, non una coda di lavori | ~ — Batch Process senza controllo della coda |
| Consegna di steli e alternative in un solo passaggio | + — accodati insieme al mix | + — accodati insieme al mix | ~ — Esporta più file scrive ogni traccia separatamente, ma non mette in coda insieme il mix e i rendering alternativi | ~ — un mixdown per stelo |
| Consegna regione per regione | + — sequenze di masterizzazione con metadati, gap e dissolvenze per regione | + — sequenze di masterizzazione con metadati, gap e dissolvenze per regione | + — Esporta più file scrive ogni regione etichettata in un file separato | + — esporta marcatori in file separati |
| Normalizzazione della luminosità all'esportazione | + — parte del piano di consegna | + — parte del piano di consegna | ~ — esegui l'effetto per primo | + — Abbina la luminosità |
| Dither e mappatura dei canali | + — controlli espliciti | + — controlli espliciti | ~ — dither nelle preferenze | + — controlli espliciti |
| Rapporto di consegna | + — particolareggiato per lavoro | + — particolareggiato per lavoro | / | / |
| Coda di rendering sopravvive a un riavvio | / — il ripristino persistente dei rendering richiede Desktop | + — al riavvio riprende dal byte zero con un registro degli arresti anomali | / | / |

Soundscaper Desktop può usare FFmpeg configurato per i formati di esportazione supportati; l’editor attuale non espone argomenti FFmpeg arbitrari né tutti gli encoder FFmpeg. Consulta [Formati di esportazione](/reference/generated/formats/) per l’elenco dei target registrati. Il [flusso di esportazione](https://www.audacityteam.org/manual/getting-started/export-your-audio/) di Audacity aggiunge formati tramite un’installazione facoltativa di FFmpeg. Audition offre un insieme fisso di writer di file e un [passaggio ad Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Interscambio con altri strumenti

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Progetti Audacity | + — importazione AUP, AUP3 e AUP4; esportazione AUP3 e AUP4 con rapporto di compatibilità | + — importazione AUP, AUP3 e AUP4; esportazione AUP3 e AUP4 con rapporto di compatibilità | + — importazione AUP, AUP3 e AUP4; esportazione AUP4, nessuna esportazione AUP3 | / |
| Sessioni di Audition | / — l’importazione SESX richiede Desktop | ~ — importazione audio `.sesx` con rapporto sulle omissioni; nessuna esportazione | / — nessuna importazione SESX nella build fissata | + — nativo |
| EDL | ~ — esportazione CMX3600-class, nessuna importazione | ~ — esportazione CMX3600-class, nessuna importazione | / | / |
| OpenTimelineIO | ~ — esportazione solo | ~ — esportazione solo | / | / |
| FCPXML | ~ — esportazione solo | ~ — esportazione solo | / | + — importazione ed esportazione |
| DAWproject | + — importazione ed esportazione, con un rapporto di scambio | + — importazione ed esportazione, con un rapporto di scambio | / | / |
| OMF | / | / | / | ~ — importazione ed esportazione |
| Andata e ritorno con un editor video | ~ — passa lo stesso progetto a Framescaper senza copiare i media | ~ — passa lo stesso progetto a Framescaper senza copiare i media | / | + — Dynamic Link con Premiere Pro |
| Scambio di etichette e marcatori | + — importazione ed esportazione | + — importazione ed esportazione | + — importazione ed esportazione | + — elenchi di marcatori |

Per sapere quali impostazioni audio vengono trasferite quando importi un `.sesx` di Audition e cosa il rapporto segnala come omesso, consulta [File di progetto](/projects-and-data/project-files/).

## Video

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Importa video per riferimento | + — sulla timeline, con audio collegato | + — sulla timeline, con audio collegato | / | ~ — una traccia video, anteprima solo |
| Modifica timeline video | ~ — modifica di base, la superficie completa è Framescaper | ~ — modifica di base, la superficie completa è Framescaper | / | / |
| Esportazione video | ~ — MP4 e WebM se WebCodecs del browser supporta i codec richiesti | + — MP4 e WebM con un provider di codec desktop verificato | / | / — solo audio |
| Compositing, grading ed effetti | ~ — in Framescaper, sullo stesso progetto | ~ — in Framescaper, sullo stesso progetto | / | / |

## Assistenza macchina

L’assistenza desktop è supportata dopo l’installazione dei pesi facoltativi del modello e di un motore nativo corrispondente; questi flussi di lavoro non sono disponibili in Web. Gestione modelli installa entrambi. Per i flussi di lavoro e i modelli disponibili, consulta [Assistenza locale](/reference/generated/local-assistance/).

| Capacità | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Miglioramento del parlato | / — solo assistenza desktop | + — con modello e motore facoltativi installati | / | + — Migliora il parlato |
| Trascrizione e diarizzazione | / — solo assistenza desktop | + — con modelli e motori facoltativi installati | / | / — le trascrizioni vivono in Premiere Pro |
| Separazione della fonte in steli | / — solo assistenza desktop | + — con modello e motore facoltativi installati | / | / |
| Anatra automatica | + — effetto Auto Duck | + — effetto Auto Duck | + — effetto Auto Duck | + — Anatra Essential Sound |
| Rilevamento battute e riprese | / — il rilevamento dei battiti richiede Desktop; il rilevamento delle inquadrature è in Framescaper | ~ — rilevamento dei battiti con modello facoltativo; il rilevamento delle inquadrature è in Framescaper | / | ~ — Remix ritma automaticamente la musica |
| Funziona interamente sulla tua macchina | + — elaborazione locale nel browser; nessuna inferenza del modello | + — elaborazione locale e inferenza offline dopo l’installazione del modello | + — nessuna inferenza affatto | ~ — alcune funzionalità elaborano nel cloud di Adobe |
| I modelli sono opzionali e rimovibili | / — nessuna installazione di modelli in Web | + — scaricati separatamente, digest-pinned, cancellabili | + — nulla da installare | / — fornito con l'applicazione |

## Cosa significano le differenze

Audacity 4 è un editor a passaggio singolo. Nella build fissata non ha bus, mandate, corsie di automazione per tracce o effetti, né macro. Gli inviluppi di guadagno dei clip consentono di automatizzare il volume all’interno di un clip. Soundscaper mantiene questo modello di editing e aggiunge automazione di tracce ed effetti, missaggio e consegna, oltre a registrazione, video e interscambio che Audacity non affronta.

Audition è ancora in testa per quanto riguarda la profondità di ripristino,
per i round-trips con Premiere Pro e per l'ambisonica. Dove Soundscaper è in testa
è nella consegna immersiva, nella gestione dei progetti e nel fatto che funziona
in un browser su hardware che nessuno degli altri supporta.

Se lavori già con Audacity, vedi
[file di progetto e interscambio Audacity](/projects-and-data/project-files/) per
come trasferire un progetto.

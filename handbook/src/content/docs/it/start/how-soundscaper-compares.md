---
title: "Confronto di Soundscaper"
description: "Confronta Soundscaper con Audacity 4 e Adobe Audition per quanto riguarda registrazione, editing, mixaggio, distribuzione e interscambio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"5b9d7c73cc9a759d623469a935b0c57325920832ea7775ef89dee9cdede4a17f","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5b9d7c73cc9a759d623469a935b0c57325920832ea7775ef89dee9cdede4a17f","targetLocale":"it"} -->

Soundscaper reimplementa Audacity 4 sul web e aggiunge un livello di produzione
sopra di esso. Adobe Audition è lo strumento commerciale di post-produzione
contro cui entrambi vengono generalmente misurati. Questa pagina confronta tutti
e e tre per consentirti di capire quale dei tre esegue già il lavoro che devi
fare.

## Come leggere questa pagina

Ogni cella riporta **Sì**, **Parziale** o **No**, seguita dal dettaglio che
la qualifica.

**Parziale** copre tre situazioni diverse e la nota indica quale si applica:
la funzionalità esiste ma è più ristretta rispetto ad altre, esiste ma dipende
da qualcosa che devi fornire, oppure è raggiungibile solo aggirando un'assenza.

Le righe descrivono funzionalità, non comandi di menu. Per l'inventario esatto
dei comandi vedere [Comandi e scorciatoie](/reference/generated/commands/), e per ciò che ogni
prodotto abilita vedere
[Funzionalità del prodotto](/reference/generated/product-capabilities/).

### Da dove provengono queste affermazioni

- Le righe di **Soundscaper** provengono da questo repository: i profili di
  funzionalità del prodotto, il manifesto delle azioni runtime e il registro dei
  formati di esportazione. Diverse route desktop-native sono implementate ma
  ancora soggette a payload di macchina firmati; quelle righe lo specificano.
- Le righe di **Audacity 4** provengono dall'inventario upstream fissato in
  questo repository, `4.0.0` al commit `4c177d43`. Una funzionalità che upstream
  registra ma lascia disabilitata o commenta fuori dal menu viene
  registrata come tale, e una funzionalità senza registrazione nella build
  fissata viene riportata come assente in quella build piuttosto che come
  permanentemente assente.
- Le righe di **Audition** provengono dalla documentazione pubblicata da Adobe
  per la release corrente. Non sono verificate contro una build in esecuzione.

## Piattaforma e termini

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licenza | Sì — AGPL-3.0-only | Sì — GPL, open source | No — proprietario e chiuso |
| Costo | Sì — gratuito | Sì — gratuito | No — abbonamento Creative Cloud |
| Esecuzione nel browser | Sì — Chromium, Firefox e WebKit | No — solo desktop | No — solo desktop |
| Build desktop | Sì — Windows e Linux su x64 e ARM64, macOS su ARM64 | Sì — Windows, macOS, Linux | Parziale — Windows e macOS, nessun Linux |
| Funziona senza account | Sì — non esiste alcun account | Sì — accesso solo per audio.com | No — richiesto abbonamento con accesso effettuato |
| Archiviazione cloud dei progetti | No — escluso dal design local-first | Sì — salvataggio e condivisione tramite audio.com | Parziale — file Creative Cloud, le sessioni non vengono sincronizzate |
| Requisiti di sistema | Sì — funziona ovunque funzioni un browser attuale | Parziale — aumentati in modo sostanziale rispetto ad Audacity 3 | Parziale — classe workstation professionale |

## Modello di progetto e sessione

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Formato progetto nativo | Sì — `.sscape`, un archivio portatile senza perdite | Sì — `.aup4` | Sì — `.sesx` |
| Apre progetti Audacity | Sì — importazione ed esportazione AUP4 | Sì — nativo | No |
| Timeline clip non distruttiva | Sì | Sì | Sì — editor multitraccia |
| Editor di file singolo dedicato | Parziale — l'editing dei campioni avviene nella timeline | Parziale — le modifiche vengono applicate in loco nella timeline | Sì — editor di forma d'onda |
| Contenuto mono e stereo su una traccia | Sì — una traccia contiene l'uno o l'altro | No — una traccia è mono o stereo | No — il formato del canale è fisso per traccia |
| Cartelle di tracce annidate | Sì — qualsiasi profondità, annullabile, con instradamento | No | Parziale — solo bus submix, nessuna traccia cartella |
| Bin del progetto | Sì — organizza i file e funge da clipboard | No | Parziale — il pannello File elenca i file aperti |
| Salvataggio automatico e recupero da crash | Sì — salvataggio automatico, lock e involucri di recupero | Sì | Sì |
| Marker e regioni nominate | Sì — di prima classe, con navigazione e comportamento ripple | Parziale — tracce di etichette | Sì — marker e intervalli |
| Mappe di tempo e battuta | Sì — mappe ordinate risolte con precisione al campione | Parziale — un tempo e una battuta per progetto | Parziale — un tempo per sessione |

## Registrazione

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Registrazione multitraccia | Sì — più sorgenti contemporaneamente | Parziale — un dispositivo di input alla volta | Sì — interfacce multi-input e multicanale |
| Microfono e audio desktop insieme | Sì — integrato | No | Parziale — richiede un dispositivo loopback del sistema operativo |
| Registrazione temporizzata | Sì | Sì | No |
| Registrazione attivata dal suono | Sì — con soglia impostabile | Sì — con soglia impostabile | No |
| Conteggio prima della presa | Sì — consapevole della mappa del tempo, gestisce il metro composto | Parziale — registrazione di introduzione | Parziale — pre-roll come parte di punch and roll |
| Registrazione punch | Sì — una transazione, acquisizione predefinita e instradata | No | Sì — punch and roll |
| Registrazione in loop nelle prese | Sì — una corsia per passaggio, aggiunta allo stesso gruppo | No | Parziale — prese su un clip, scelte da un elenco |
| Comping delle prese | Sì — audizione, promozione, editing delle regioni comp, appiattimento come un'unica modifica annullabile | No | No — nessun editor comp |
| Monitoraggio e misurazione dell'input | Sì | Sì | Sì |

## Editing della timeline

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Varianti di modifica ripple | Sì — per clip, per traccia e per tutte le tracce, su taglio ed eliminazione | Sì — le stesse tre, su taglio ed eliminazione | Parziale — eliminazione ripple su una selezione o un vuoto |
| Divisione, unione e divisione in base ai silenzi | Sì | Sì | Parziale — divisione e ritaglio, nessuna unione di clip |
| Gruppi di clip | Sì | Sì | Sì |
| Guadagno clip | Sì | Sì | Sì |
| Pitch e velocità per clip | Sì — modifica, rendering o reset | Sì — modifica, rendering o reset | Parziale — lo stretch rimane modificabile, il pitch è un effetto |
| Seguire le variazioni di tempo | Sì — le clip si allungano quando la mappa si sposta | Sì | No |
| Quantizzazione e groove consapevoli del beat | Sì — mappe di warp con intensità del groove regolabile | No | No |
| Snap agli incroci dello zero | Sì | Sì | Sì |
| Disegno a livello di campione | Sì | Parziale — nessuna azione di disegno registrata nella build fissa | Sì — nell'editor di forma d'onda |
| Modifica solo da tastiera | Sì — ogni primitiva di modifica ha un'azione di navigazione | Sì — ogni primitiva di modifica ha un'azione di navigazione | Parziale — scorciatoie estese, alcuni pannelli richiedono il mouse |

## Lavoro spettrale e ripristino

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vista spettrale | Sì — con impostazioni per traccia | Sì — con impostazioni per traccia | Sì — display di frequenza e pitch |
| Selezione con limiti di frequenza | Sì | Sì | Sì — lasso e selezione libera |
| Pennello spettrale | Sì | Sì | Sì — pennello e riparazione spot |
| Eliminare o amplificare una regione spettrale | Sì — entrambi come azioni dirette | Sì — entrambi come azioni dirette | Parziale — applicare un effetto alla selezione |
| Riparare danni brevi | Sì — Riparazione | Sì — Riparazione | Sì — Auto Heal e Spot Healing Brush |
| Riduzione del rumore a banda larga | Sì — con un profilo acquisito | Sì — con un profilo acquisito | Sì — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| De-reverb | No | No | Sì — DeReverb |
| Strumenti per clic, ronzii e sibilanza | Parziale — solo Click Removal | Parziale — solo Click Removal | Sì — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Pannello di diagnostica | Parziale — Find Clipping come analizzatore | Parziale — Find Clipping come analizzatore | Sì — diagnostica con riparazione per problema |

## Effetti e plug-in

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suite di effetti integrata | Sì — i 30 effetti Audacity, i plug-in Nyquist inclusi e gli effetti di prima parte senza equivalente upstream, come il bitcrusher | Sì — la stessa raccolta integrata di 30 effetti | Sì — circa cinquanta, inclusa la dinamica multibanda |
| Rack di effetti in tempo reale per traccia | Sì — un set in tempo reale più ampio rispetto all'upstream | Sì | Sì — sedici slot per clip, traccia e master |
| EQ parametrico | Sì — un nuovo EQ parametrico con bande automatizzabili | Parziale — Filter Curve e Graphic EQ | Sì — filtri parametrici, grafici e FFT |
| Preset di effetto | Sì — applica, salva, importa, esporta | Sì — applica, salva, importa, esporta | Sì |
| Macro e catene batch | Sì — libreria di macro salvate con modelli | No — la build fissa commenta il menu Macros | Sì — Favorites e Batch Process |
| Formati di plug-in di terze parti | Parziale — VST3, CLAP, AU e LV2 su desktop dietro consenso e contenimento, nessuno nel browser | Sì — VST3, AU, LV2 e Nyquist, con un gestore di plug-in | Parziale — VST3 e AU su macOS, nessun CLAP o LV2 |
| Scripting Nyquist | Sì — plug-in inclusi e prompt Nyquist | Sì — plug-in inclusi e prompt Nyquist | No |
| Pacchetti di effetti sandboxed | Parziale — pacchetti WebAssembly revisionati, uno è incluso e quelli esterni sono recintati | No | No |
| Strumenti virtuali | No — dopo la 1.0 | No | No |

## Mixing, routing e automazione

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer con channel strips | Sì | Parziale — controlli traccia e una traccia master | Sì |
| Bus e submix | Sì — annidati, con validazione del ciclo | No | Sì — tracce bus |
| Sends | Sì — pre e post fader, più assegnazioni | No | Sì — pre e post fader |
| Gruppi VCA | Sì | No | No |
| Ingresso sidechain | Sì | No | Sì — tramite sends |
| Mix cue e control room | Sì | No | No |
| Compensazione del ritardo dei plug-in | Sì — riproduzione, monitoraggio, bus, sidechain, rendering e freeze | Parziale — non esposto nelle fonti fisse | Sì |
| Lane di automazione | Sì — guadagno, pan, mute, sends, bus e parametri dei plug-in | No — nessuna lane e nessun strumento di envelope nella build fissa | Sì — volume, pan e parametri degli effetti |
| Modalità di automazione | Sì — read, trim, touch, latch e write | No | Parziale — read, write, latch e touch, nessun trim |
| Forme di curva | Sì — linea, hold e curva | No | Sì — lineare e spline |
| Freeze traccia | Sì — freeze, unfreeze e commit senza perdere lo stato | No | Parziale — bounce su una nuova traccia |

## Metering e analisi

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Misuratore di loudness | Sì — stile EBU R 128, con cronologia | No — un effetto Loudness Normalization ma nessun misuratore | Sì — Loudness Radar a ITU-R BS.1770 |
| Misuratore di fase e correlazione | Sì | No | Sì — misuratore di fase e analisi |
| Metering surround | Sì | No | Parziale — fino a 5.1 |
| Grafico spettrale | Sì — Plot Spectrum | Parziale — registrato, ma la build fissa lo commenta fuori dal menu Analyze | Sì — Frequency Analysis |
| Clipping e RMS nella forma d'onda | Sì — entrambi, attivabili per progetto | Sì — entrambi, attivabili per progetto | Parziale — indicatori di clip, RMS in Amplitude Statistics |
| Contrasto di intelligibilità del parlato | Sì — analizzatore Contrast | Parziale — registrato, ma la build fissa lo commenta fuori dal menu Analyze | No |

## Canali e audio immersivo

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canali per file | Sì — fino a 32 per formati PCM | Parziale — tracce mono e stereo | Sì — fino a 32 nell'editor di forma d'onda |
| Mix surround | Sì — fino a 7.1.4 | No | Parziale — fino a 5.1 |
| Audio basato su oggetti | Sì — oggetti accanto ai bed | No | No |
| Creazione e passaggio ADM | Sì — BW64/ADM con controlli di conformità | No | No |
| Rendering binaurale | Sì — un modello binaurale nominato | No | Parziale — binauraliser per ambisonics |
| Ambisonics | No | No | Sì — prima ordine, con un panner VR |

## Esportazione e consegna

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Output senza perdite | Sì — WAV, AIFF, BWF e BW64 scritti nativamente | Sì — WAV, AIFF e FLAC | Sì — WAV, AIFF, FLAC e altri |
| Output con perdite | Parziale — MP3, AAC, Opus, Vorbis, MP2, FLAC e WavPack, tutti tramite il runtime FFmpeg | Parziale — MP3 integrato, il resto tramite un'installazione opzionale di FFmpeg | Sì — integrato |
| Impostazioni encoder personalizzate | Sì — un target FFmpeg personalizzato | Sì — un target FFmpeg personalizzato | Sì — opzioni per formato |
| Coda di esportazione | Sì — pausa, annulla, riprova e riordina | No — un'esportazione alla volta | Parziale — Batch Process senza controllo della coda |
| Stems e alternative in un'unica passata | Sì — in coda insieme al mix | No | Parziale — un mixdown per stem |
| Consegna per regione | Sì — sequenze di mastering con metadati per regione, spazi vuoti e dissolvenze | Parziale — esportazione etichette, nessuna esportazione multi-file nella build bloccata | Sì — esportazione marcatori in file separati |
| Normalizzazione della loudness all'esportazione | Sì — parte del piano di consegna | Parziale — eseguire prima l'effetto | Sì — Match Loudness |
| Dither e mapping dei canali | Sì — controlli espliciti | Parziale — dither nelle preferenze | Sì — controlli espliciti |
| Report di consegna | Sì — dettagliato per lavoro | No | No |
| La coda di rendering sopravvive a un riavvio | Sì — su desktop, riavvio da byte zero con un registro di crash | No | No |

## Scambio con altri strumenti

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Progetti Audacity | Sì — AUP4 in entrata e in uscita, con un report di omissioni | Sì — nativo | No |
| EDL | Parziale — esportazione di classe CMX3600, nessuna importazione | No | No |
| OpenTimelineIO | Parziale — solo esportazione | No | No |
| FCPXML | Parziale — solo esportazione | No | Sì — importazione ed esportazione |
| DAWproject | Sì — importazione ed esportazione, con un report di scambio | No | No |
| OMF | No | No | Parziale — importazione ed esportazione |
| Round-trip con un editor video | Parziale — passa lo stesso progetto a Framescaper senza copiare i media | No | Sì — Dynamic Link con Premiere Pro |
| Scambio di etichette e marcatori | Sì — importazione ed esportazione | Sì — importazione ed esportazione | Sì — elenchi di marcatori |

## Video

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Importazione video per riferimento | Sì — sulla timeline, con audio collegato | No | Parziale — una traccia video, solo anteprima |
| Modifica della timeline video | Parziale — modifica di base, la superficie completa è Framescaper | No | No |
| Esportazione video | Sì — MP4 e WebM tramite il runtime FFmpeg | No | No — solo audio |
| Compositing, grading ed effetti | Parziale — in Framescaper, sullo stesso progetto | No | No |

## Assistenza automatica

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Miglioramento del parlato | Parziale — solo desktop, una volta installato il payload del modello | No | Sì — Enhance Speech |
| Trascrizione e diarizzazione | Parziale — solo desktop, modelli opzionali | No | No — le trascrizioni sono in Premiere Pro |
| Separazione delle sorgenti in stems | Parziale — solo desktop, modelli opzionali | No | No |
| Ducking automatico | Sì — effetto Auto Duck | Sì — effetto Auto Duck | Sì — ducking Essential Sound |
| Rilevamento di beat e shot | Parziale — solo desktop, modelli opzionali | No | Parziale — Remix ricalcola automaticamente la musica |
| Si esegue interamente sulla tua macchina | Sì — l'inferenza è solo desktop e offline dopo l'installazione | Sì — nessuna inferenza | Parziale — alcune funzionalità vengono elaborate nel cloud di Adobe |
| I modelli sono opzionali e rimovibili | Sì — scaricati separatamente, fissati per digest, eliminabili | Sì — nulla da installare | No — inclusi con l'applicazione |

## Cosa aggiungono le differenze

Audacity 4 è un editor a singola passata. Non ha bus, invii, corsie di automazione né macro nella build bloccata. Soundscaper mantiene quel modello di editing e aggiunge sopra di esso il livello di mix, automazione e consegna, oltre a registrazione, video e lavoro di scambio che Audacity non tenta.

Audition è ancora leader in profondità di restauro, round-trips con Premiere Pro e ambisonics. Dove Soundscaper è leader è nella consegna immersiva, nella gestione dei progetti e nel fatto che si esegue in un browser su hardware che nessuno degli altri supporta.

Se lavori già in Audacity, consulta
[file di progetto e scambio con Audacity](/projects-and-data/project-files/) per
sapere come spostare un progetto.

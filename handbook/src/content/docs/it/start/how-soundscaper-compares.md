---
title: "Confronto tra Soundscaper"
description: "Confronto tra Soundscaper, Audacity 4 e Adobe Audition in termini di registrazione, editing, mixaggio, distribuzione e interscambio."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"it"} -->

Soundscaper reimplementa Audacity 4 sul web e aggiunge un livello di produzione sopra di esso. Adobe Audition è lo strumento commerciale di post-produzione con cui entrambi vengono solitamente confrontati. Questa pagina confronta i tre per aiutarti a capire quale soddisfa già le tue esigenze.

## Come leggere questa pagina

Ogni cella riporta **Sì**, **Parziale** o **No**, seguito da una nota esplicativa.

**Parziale** copre tre situazioni diverse, e la nota specifica quale si applica: la funzionalità esiste ma è più limitata rispetto agli altri, esiste ma dipende da qualcosa che devi fornire, o è accessibile solo aggirando un'assenza.

Le righe descrivono le funzionalità, non i comandi del menu. Per l'elenco completo dei comandi, vedi [Comandi e scorciatoie](/reference/generated/commands/), e per le funzionalità abilitate da ciascun prodotto, vedi [Funzionalità del prodotto](/reference/generated/product-capabilities/).

### Origine di queste affermazioni

- Le righe **Soundscaper** provengono da questo repository: i profili delle funzionalità del prodotto, il manifesto delle azioni in esecuzione e il registro dei formati di esportazione. I payload nativi per desktop sono generati dal CI del repository o dall'imballaggio del target. Un pacchetto ne abilita uno solo dopo aver eseguito il staging e verificato il risultato esatto corrispondente; quelle righe indicano quando è ancora richiesto un payload.
- Le righe **Audacity 4** provengono dall'inventario a monte bloccato in questo repository, `4.0.0` alla commit `4c177d43`. Una funzionalità che a monte viene registrata ma lasciata disabilitata o commentata fuori dal menu viene registrata come tale, e una funzionalità senza registrazione nel build bloccato viene riportata come assente in quel build piuttosto che come permanentemente assente.
- Le righe **Audition** provengono dalla documentazione pubblicata di Adobe per l'ultima versione. Non sono verificate su un'installazione in esecuzione.

## Piattaforma e termini

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licenza | Sì — AGPL-3.0-only | Sì — GPL, open source | No — proprietaria e chiusa |
| Costo | Sì — gratuito | Sì — gratuito | No — abbonamento Creative Cloud |
| Esegue in un browser | Sì — Chromium, Firefox e WebKit | No — solo desktop | No — solo desktop |
| Versioni desktop | Sì — Windows e Linux su x64 e ARM64, macOS su ARM64 | Sì — Windows, macOS, Linux | Parziale — Windows e macOS, nessun Linux |
| Funziona senza account | Sì — nessun account esiste | Sì — accesso solo per audio.com | No — accesso con abbonamento richiesto |
| Archiviazione progetti cloud | No — esclusa dal design incentrato sul locale | Sì — salva e condividi tramite audio.com | Parziale — file Creative Cloud, le sessioni non vengono sincronizzate |
| Requisiti di sistema | Sì — esegue ovunque un browser moderno | Parziale — aumentati in modo sostanziale rispetto ad Audacity 3 | Parziale — classe di workstation professionale |

## Modello di progetto e sessione

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Formato progetto nativo | Sì — `.sscape`, un archivio portatile senza perdita di dati | Sì — `.aup4` | Sì — `.sesx` |
| Apre progetti Audacity | Sì — importazione ed esportazione AUP4 | Sì — nativo | No |
| Timeline clip non distruttiva | Sì | Sì | Sì — editor multitrack |
| Editor singolo file dedicato | Parziale — l'editing dei campioni avviene nella timeline | Parziale — gli edit vengono applicati in loco nella timeline | Sì — editor delle forme d'onda |
| Contenuto mono e stereo su una singola traccia | Sì — una traccia contiene o l'uno o l'altro | No — una traccia è mono o stereo | No — il formato del canale è fisso per traccia |
| Cartelle di tracce annidate | Sì — a qualsiasi profondità, annullabile, con routing | No | Parziale — solo bus di submix, nessuna traccia di cartella |
| Bin del progetto | Sì — organizza i file e funge da appunti | No | Parziale — il pannello File elenca i file aperti |
| Autosave e recupero in caso di crash | Sì — autosave, lucchetti e inviluppi di recupero | Sì | Sì |
| Marker e regioni denominate | Sì — di prima classe, con navigazione e comportamento a ondata | Parziale — tracce di etichette | Sì — marker e intervalli |
| Mappe di tempo e firma | Sì — mappe ordinate risolte con precisione campionaria | Parziale — un tempo e una firma di progetto | Parziale — un tempo di sessione |

## Registrazione

| Funzionalità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Registrazione multitrack | Sì — più sorgenti contemporaneamente | Parziale — un dispositivo di ingresso alla volta | Sì — interfacce multi-input e multicanale |
| Microfono e audio desktop insieme | Sì — integrato | No | Parziale — richiede un dispositivo di loopback del sistema operativo |
| Registrazione temporizzata | Sì | Sì | No |
| Registrazione attivata dal suono | Sì — con una soglia impostabile | Sì — con una soglia impostabile | No |
| Count-in prima della ripresa | Sì — consapevole della mappa del tempo, gestisce il metro composto | Parziale — registrazione di lead-in | Parziale — pre-roll come parte di punch and roll |
| Registrazione punch | Sì — una transazione, cattura predefinita e instradata | No | Sì — punch and roll |
| Registrazione a ciclo in riprese | Sì — una corsia per passaggio, aggiunta allo stesso gruppo | No | Parziale — riprese su un clip, scelte da un elenco |
| Comping delle riprese | Sì — audition, promuovi, modifica le regioni comp, appiattisci come un'unica modifica annullabile | No | No — nessun editor comp |
| Monitoraggio e misurazione dell'input | Sì | Sì | Sì |

## Modifica della timeline

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Varianti di modifica a cascata | Sì — per clip, per traccia e per tutte le tracce, al taglio e alla cancellazione | Sì — le stesse tre, al taglio e alla cancellazione | Parziale — cancellazione a cascata su una selezione o un vuoto |
| Dividi, unisciti e dividi nei silenzi | Sì | Sì | Parziale — dividi e ritaglia, nessuna unione di clip |
| Gruppi di clip | Sì | Sì | Sì |
| Guadagno clip | Sì | Sì | Sì |
| Pitch e velocità per clip | Sì — regola, renderizza o reimposta | Sì — regola, renderizza o reimposta | Parziale — lo stretch rimane modificabile, il pitch è un effetto |
| Segui i cambiamenti di tempo | Sì — le clip si allungano quando la mappa si sposta | Sì | No |
| Quantizzazione consapevole del battito e groove | Sì — mappe di warp con forza del groove regolabile | No | No |
| Aggancia a zero attraversamenti | Sì | Sì | Sì |
| Disegno a livello di campione | Sì | Parziale — nessuna azione di disegno registrata nella build bloccata | Sì — nel editor delle forme d'onda |
| Modifica solo tastiera | Sì — ogni primitiva di modifica ha un'azione di navigazione | Sì — ogni primitiva di modifica ha un'azione di navigazione | Parziale — scorciatoie estese, alcune finestre richiedono il mouse |

## Lavoro e ripristino spettrale

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vista spettrogramma | Sì — con impostazioni per traccia | Sì — con impostazioni per traccia | Sì — visualizzazioni di frequenza e pitch |
| Selezione limitata in frequenza | Sì | Sì | Sì — selezione a bandiera e lasso |
| Pennello spettrale | Sì | Sì | Sì — pennello e pennello di guarigione puntuale |
| Cancella o amplifica una regione spettrale | Sì — entrambe come azioni dirette | Sì — entrambe come azioni dirette | Parziale — applica un effetto alla selezione |
| Ripara danni brevi | Sì — Ripara | Sì — Ripara | Sì — Auto Heal e Pennello di Guarigione Puntuale |
| Riduzione del rumore a banda larga | Sì — con un profilo catturato | Sì — con un profilo catturato | Sì — Riduzione del Rumore, Riduzione del Rumore Adattiva, DeNoise |
| De-reverb | No | No | Sì — DeReverb |
| Strumenti per click, ronzio e sibilanza | Parziale — Solo Rimozione Click | Parziale — Solo Rimozione Click | Sì — DeClicker, DeHummer, DeEsser, Eliminatore Click/Pop |
| Pannello diagnostico | Parziale — Trova Clip come analizzatore | Parziale — Trova Clip come analizzatore | Sì — diagnostica con riparazione per problema |

## Effetti e plug-in

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suite di effetti integrati | Sì — i 30 effetti di Audacity, i plug-in Nyquist integrati e gli effetti di prima parte senza equivalenti a monte, come il bitcrusher | Sì — la stessa collezione integrata di 30 effetti | Sì — circa cinquanta, inclusi dinamici multi-banda |
| Rack di effetti in tempo reale per traccia | Sì — un set più ampio di effetti in tempo reale rispetto a quello a monte | Sì | Sì — sedici slot per clip, traccia e master |
| EQ parametrico | Sì — un nuovo EQ parametrico con bande automatizzabili | Parziale — Curva del Filtro e EQ Grafico | Sì — EQ parametrico, grafico e FFT |
| Preset degli effetti | Sì — applica, salva, importa, esporta | Sì — applica, salva, importa, esporta | Sì |
| Macro e catene di batch | Sì — libreria di macro salvate con modelli | No — la build bloccata commenta fuori il menu Macro | Sì — Preferiti e Elaborazione Batch |
| Formati di plug-in di terze parti | Parziale — effetti VST3, CLAP, AU, LV2 e LADSPA Linux più analizzatori Vamp sul desktop dietro consenso e contenimento; nessuno nel browser | Sì — VST3, AU, LV2 e Nyquist, con un gestore di plug-in | Parziale — VST3 e AU su macOS, nessun CLAP o LV2 |
| Scripting Nyquist | Sì — plug-in integrati e prompt Nyquist | Sì — plug-in integrati e prompt Nyquist | No |
| Pacchetti di effetti sandbox | Parziale — pacchetti WebAssembly esaminati, uno spedisce e quelli esterni sono recintati | No | No |
| Strumenti virtuali | No — dopo 1.0 | No | No |

## Miscelazione, instradamento e automazione

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixer con strisce di canale | Sì | Parziale — controlli di traccia e una traccia master | Sì |
| Bus e submix | Sì — annidati, con convalida del ciclo | No | Sì — tracce di bus |
| Invii | Sì — pre e post fader, molteplici assegnazioni | No | Sì — pre e post fader |
| Gruppi VCA | Sì | No | No |
| Input a catena laterale | Sì | No | Sì — attraverso gli invii |
| Miscele di cue e control room | Sì | No | No |
| Compensazione del ritardo dei plug-in | Sì — riproduzione, monitoraggio, bus, catene laterali, render e freeze | Parziale — non esposto nelle fonti bloccate | Sì |
| Corsie di automazione | Sì — guadagno, panoramica, muto, invii, bus e parametri dei plug-in | No — nessuna corsia e nessun strumento a busta nella build bloccata | Sì — volume, panoramica e parametri degli effetti |
| Modalità di automazione | Sì — leggi, ritaglia, tocca, aggancia e scrivi | No | Parziale — leggi, scrivi, aggancia e tocca, nessun ritaglia |
| Forme delle curve | Sì — linea, tieni e curva | No | Sì — lineare e spline |
| Congelamento della traccia | Sì — congela, scongela e impegna senza perdere lo stato | No | Parziale — rimbalza su una nuova traccia |

## Metering e analisi

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Metro di loudness | Sì — stile EBU R 128, con cronologia | No — un effetto di Normalizzazione del Loudness ma nessun metro | Sì — Loudness Radar fino a ITU-R BS.1770 |
| Metro di fase e correlazione | Sì | No | Sì — metro di fase e analisi |
| Metering surround | Sì | No | Parziale — fino a 5.1 |
| Trama dello spettro | Sì — Trama Spettro | Parziale — registrato, ma la build bloccata commenta fuori dal menu Analizza | Sì — Analisi di Frequenza |
| Clipping e RMS nella forma d'onda | Sì — entrambi, attivati per progetto | Sì — entrambi, attivati per progetto | Parziale — indicatori di clip, RMS in Statistiche Ampiezza |
| Contrasto di intelligibilità del parlato | Sì — Analizzatore di Contrasto | Parziale — registrato, ma la build bloccata commenta fuori dal menu Analizza | No |

## Canali e audio immersivo

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canali per file | Sì — fino a 32 per formati PCM | Parziale — tracce mono e stereo | Sì — fino a 32 nell'editor delle forme d'onda |
| Mixaggio surround | Sì — letti fino a 7.1.4 | No | Parziale — fino a 5.1 |
| Audio basato su oggetti | Sì — oggetti insieme ai letti | No | No |
| Autore ADM e pass-through | Sì — BW64/ADM con controlli di conformità | No | No |
| Rendering binaurale | Sì — un modello binaurale denominato | No | Parziale — binauralizzatore per ambisonica |
| Ambisonica | No | No | Sì — primo ordine, con un panner VR |

## Esportazione e consegna

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Output senza perdite | Sì — WAV, AIFF, BWF e BW64 scritti nativamente | Sì — WAV, AIFF e FLAC | Sì — WAV, AIFF, FLAC e altro |
| Output con perdita | Parziale — MP3, AAC, Opus, Vorbis, MP2, FLAC e WavPack, tutti tramite il runtime FFmpeg | Parziale — MP3 integrato, il resto tramite installazione FFmpeg opzionale | Sì — integrato |
| Impostazioni codificatore personalizzate | Sì — un target FFmpeg personalizzato | Sì — un target FFmpeg personalizzato | Sì — opzioni per formato |
| Coda di esportazione | Sì — pausa, annulla, riprova e riordina | No — un'esportazione alla volta | Parziale — Batch Process senza controllo della coda |
| Consegna di steli e alternative in un solo passaggio | Sì — accodati insieme al mix | No | Parziale — un mixdown per stelo |
| Consegna regione per regione | Sì — sequenze di masterizzazione con metadati, gap e dissolvenze per regione | Parziale — etichette di esportazione, nessuna esportazione multipla nel build fissato | Sì — esporta marcatori in file separati |
| Normalizzazione della luminosità all'esportazione | Sì — parte del piano di consegna | Parziale — esegui l'effetto per primo | Sì — Abbina la luminosità |
| Dither e mappatura dei canali | Sì — controlli espliciti | Parziale — dither nelle preferenze | Sì — controlli espliciti |
| Rapporto di consegna | Sì — particolareggiato per lavoro | No | No |
| Coda di rendering sopravvive a un riavvio | Sì — sul desktop, riprendendo da byte zero con un diario di crash | No | No |

## Interscambio con altri strumenti

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Progetti Audacity | Sì — AUP4 in e out, con un rapporto di omissione | Sì — nativo | No |
| EDL | Parziale — esportazione CMX3600-class, nessuna importazione | No | No |
| OpenTimelineIO | Parziale — esportazione solo | No | No |
| FCPXML | Parziale — esportazione solo | No | Sì — importazione ed esportazione |
| DAWproject | Sì — importazione ed esportazione, con un rapporto di scambio | No | No |
| OMF | No | No | Parziale — importazione ed esportazione |
| Andata e ritorno con un editor video | Parziale — passa lo stesso progetto a Framescaper senza copiare i media | No | Sì — Dynamic Link con Premiere Pro |
| Scambio di etichette e marcatori | Sì — importazione ed esportazione | Sì — importazione ed esportazione | Sì — elenchi di marcatori |

## Video

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Importa video per riferimento | Sì — sulla timeline, con audio collegato | No | Parziale — una traccia video, anteprima solo |
| Modifica timeline video | Parziale — modifica di base, la superficie completa è Framescaper | No | No |
| Esportazione video | Sì — MP4 e WebM tramite il runtime FFmpeg | No | No — solo audio |
| Compositing, grading ed effetti | Parziale — in Framescaper, sullo stesso progetto | No | No |

## Assistenza macchina

| Capacità | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Miglioramento del parlato | Parziale — solo desktop, una volta installato il payload del modello | No | Sì — Migliora il parlato |
| Trascrizione e diarizzazione | Parziale — solo desktop, modelli opt-in | No | No — le trascrizioni vivono in Premiere Pro |
| Separazione della fonte in steli | Parziale — solo desktop, modelli opt-in | No | No |
| Anatra automatica | Sì — effetto Auto Duck | Sì — effetto Auto Duck | Sì — Anatra Essential Sound |
| Rilevamento battute e riprese | Parziale — solo desktop, modelli opt-in | No | Parziale — Remix ritma automaticamente la musica |
| Funziona interamente sulla tua macchina | Sì — l'inferenza è solo desktop e offline dopo l'installazione | Sì — nessuna inferenza affatto | Parziale — alcune funzionalità elaborano nel cloud di Adobe |
| I modelli sono opzionali e rimovibili | Sì — scaricati separatamente, digest-pinned, cancellabili | Sì — nulla da installare | No — fornito con l'applicazione |

## Cosa significano le differenze

Audacity 4 è un editor a singolo passaggio. Non ha bus, invii,
lane di automazione o macro nel build fissato. Soundscaper mantiene quel modello di
modifica e aggiunge lo strato di mixaggio, automazione e consegna sopra di esso,
più il lavoro di registrazione, video e interscambio che Audacity non tenta.

Audition è ancora in testa per quanto riguarda la profondità di ripristino,
per i round-trips con Premiere Pro e per l'ambisonica. Dove Soundscaper è in testa
è nella consegna immersiva, nella gestione dei progetti e nel fatto che funziona
in un browser su hardware che nessuno degli altri supporta.

Se lavori già con Audacity, vedi
[file di progetto e interscambio Audacity](/projects-and-data/project-files/) per
come trasferire un progetto.

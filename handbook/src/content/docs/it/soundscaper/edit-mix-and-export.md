---
title: "Modifica, mescola ed esporta"
description: "Organizza le clip, bilancia le tracce, applica effetti e crea un file di consegna."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"it"} -->

## Organizza le clip

Seleziona le clip o un intervallo temporale prima di scegliere un comando di modifica. Split crea un
confine di modifica in corrispondenza del cursore di riproduzione. Le varianti che preservano gli
spazi e quelle ripple determinano se il materiale successivo resta al suo posto o si sposta per
chiudere la regione rimossa.

Usa le cartelle delle tracce, i gruppi di clip e il Project Bin per tenere organizzati i progetti
più grandi.

### Regola le dissolvenze delle clip {#clip-fades}

Seleziona una clip audio per visualizzare piccoli manici triangolari lungo la parte superiore della
forma d'onda, subito sotto l'intestazione della clip.
Trascina il triangolo sinistro verso l'interno per creare una dissolvenza in entrata, oppure quello
destro verso l'interno per una dissolvenza in uscita. La forma d'onda cambia mentre trascini e l'area
sopra la curva della dissolvenza diventa più scura. I triangoli seguono i limiti della dissolvenza;
riportandone uno al proprio angolo rimuovi quella dissolvenza. Anche quando sono selezionate più clip,
cambia solo la clip che trascini.

Quando deselezioni la clip, i manici scompaiono, ma restano la forma d'onda sfumata e l'ombreggiatura.
Queste dissolvenze conservano l'audio originale e restano regolabili dopo il salvataggio e la
riapertura del progetto. Rilascia per confermare una dissolvenza, oppure premi **Escape** mentre
trascini per annullarla. **Undo** annulla un trascinamento completo. La riproduzione e l'esportazione
usano le impostazioni confermate della dissolvenza.

Con una clip selezionata e attiva, premi **Tab** per raggiungere i suoi manici di dissolvenza. I tasti
freccia regolano la durata di 10 millisecondi, oppure di 100 millisecondi con **Shift**. **Home**
rimuove la dissolvenza; **End** la estende sull'intera clip. Per inserire un valore numerico, scegli
**Edit → Audio clips → Clip properties** e usa **Fading**.

### Modifica la sorgente di una clip {#clip-source-properties}

Scegli **Edit → Audio clips → Clip properties** per aprire l’editor della sorgente. La registrazione completa appare dietro la clip. Trascina i bordi della clip per cambiare l’inizio della sorgente e la durata, mantenendo invariato l’inizio della clip sulla timeline del progetto. Il riquadro **Normalize** contiene il guadagno della clip e le azioni per picchi e loudness.

Apri **Pitch and tempo** e seleziona **Link pitch and tempo** per modificare insieme velocità e tonalità. Un rapporto di velocità pari a `1` e una variazione di tonalità dello `0%` lasciano il suono invariato. Il rapporto `2` riproduce al doppio della velocità e un’ottava più in alto; `0.5` dimezza la velocità e abbassa la tonalità di un’ottava. Modificando uno dei controlli collegati si aggiorna l’altro. Disattivando il collegamento, la tonalità torna indipendente mentre il rapporto di velocità corrente resta invariato.

Fai **Ctrl+clic** sulla forma d’onda per aggiungere un marcatore di stretching associato a quel campione sorgente. Trascinandolo si modifica il tempo su entrambi i lati; la sovrapposizione mostra entrambe le velocità di riproduzione. I controlli della clip restano specifici di ogni clip. Selezionando l’audio sorgente e applicando un effetto, si aggiornano tutte le clip che usano quella sorgente.

### Modifica le clip in un foglio di calcolo {#clip-spreadsheet}

Scegli **View → Panels → Clip spreadsheet** per visualizzare tutte le clip del progetto. Il pannello si apre sotto la timeline. Il suo menu permette di spostarlo in un altro dock, renderlo flottante o chiuderlo. Dimensioni e posizione sono salvate con lo spazio di lavoro. Ogni riga mostra traccia, posizione sulla timeline, file sorgente, offset sorgente, durata, tonalità, velocità, guadagno, dissolvenze e opzioni di riproduzione. I tempi sono in secondi, la tonalità in semitoni e la velocità è un rapporto: `1` indica la velocità normale e `2` il doppio.

Fai doppio clic su una cella oppure selezionala e premi **Enter** per modificarne il valore. Premi **Enter** per applicare la modifica o **Escape** per annullarla. Le celle di traccia e sorgente mostrano gli ID effettivi. Cambia l’ID della traccia per spostare una clip su una traccia audio esistente. Cambia l’ID della sorgente o inserisci un percorso file locale per sostituire l’audio, mantenendo posizione nella timeline, durata, velocità e offset sorgente in secondi. Il nuovo file deve contenere l’intervallo sorgente indicato. **Reversed** e **Inverted** sono caselle di controllo; seleziona una cella e premi **Space** per alternarle. Le clip sulle tracce bloccate e le clip video sono di sola lettura.

Modificando la durata si accorcia o allunga l’intervallo sorgente dall’offset corrente. Modificando la velocità, l’intervallo sorgente resta invariato, salvo che venga incollata anche una durata. Separa o scollega le clip prima di modificarne qui il tempo; regola nel source editor il tempo delle clip deformate.

Seleziona una cella, trascina su un intervallo o fai **Shift+clic** su un’altra cella per estendere la selezione. Fai clic su un numero di riga o sull’intestazione di colonna per selezionare l’intera riga o colonna. Usa **Ctrl+C** e **Ctrl+V** (**Cmd+C** e **Cmd+V** su macOS) per scambiare la selezione con un foglio di calcolo. Le colonne sono separate da tabulazioni e le righe da nuove righe. L’incolla parte dalla cella selezionata e aggiorna le clip esistenti. Un incolla che supera le righe esistenti viene rifiutato. Con una selezione, premi **Escape** o fai clic nello spazio vuoto sotto la tabella per deselezionarla. Senza selezione, l’incolla inserisce righe nuove, anche in un progetto vuoto. Le opzioni di riproduzione vengono copiate come `true` o `false` e accettano questi valori quando incollate. Le righe nuove seguono l’ordine delle colonne della tabella e richiedono un nome di file sorgente o un ID sorgente. Un nome di traccia esistente e univoco colloca la clip su quella traccia; un nome nuovo crea una traccia audio. I nomi di traccia vuoti usano il nome della sorgente. Le celle numeriche vuote adottano i valori predefiniti: posizione e offset `0`, velocità `1`, tonalità e guadagno `0` e nessuna dissolvenza. Se la durata è vuota, viene usato l’audio rimanente alla velocità richiesta.

Il pannello cerca prima la sorgente nel progetto, incluso il Project Bin. Se manca, scegli **Load referenced files** e seleziona i file audio elencati nella finestra di dialogo. Anche i percorsi su disco richiedono questa selezione: incollare un percorso non concede all’app l’accesso al file. I file selezionati devono corrispondere senza ambiguità ai nomi di riferimento. Il pannello importa l’audio, convalida i limiti della sorgente e le proprietà delle clip, quindi colloca le nuove clip nelle posizioni specificate. **Ctrl+Z** (**Cmd+Z** su macOS) annulla un intero incolla in un solo passaggio; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) lo ripristina. Se un incolla contiene un valore non valido, le clip restano invariate.

## Costruisci il mix

Usa i controlli di guadagno della traccia, pan, mute e solo per bilanciare il progetto. Il pannello
Mixer mostra lo stesso stato del progetto in una disposizione orientata al mix. Gli effetti in tempo
reale restano regolabili; le operazioni distruttive o renderizzate creano modifiche al progetto che
possono essere annullate finché la cronologia è disponibile.

Usa il misuratore di riproduzione e l'analisi della loudness per controllare il risultato. Non trattare
il valore obiettivo del misuratore come un sostituto dell'ascolto dell'esportazione completa.

### Ascolta le frequenze selezionate {#listen-to-selected-frequencies}

Seleziona il passaggio da ascoltare. Dal menu della traccia scegli **Track visualization → Spectrogram**, poi apri **Spectrogram options → Select spectral frequency range**. Inserisci la frequenza minima e massima e scegli **Select range**, oppure regola le maniglie di selezione nello spettrogramma.

Scegli **Play options → Play selected frequencies** oppure **Select → Spectral → Play selected frequencies**. L’intervallo temporale selezionato viene riprodotto una volta a velocità normale, anche se in precedenza era stata scelta un’altra velocità o la riproduzione in loop. Il filtro di ascolto si applica al mix corrente, incluse le impostazioni di mute, solo, guadagno ed effetti. Un rettangolo spettrale indica banda di frequenza e intervallo temporale, ma non mette la traccia in solo. Se la riproduzione è già attiva, il comando la mette in pausa; sceglilo di nuovo per avviare l’ascolto filtrato.

I filtri di frequenza in tempo reale hanno bordi sfumati. Le frequenze esterne alla banda si attenuano, così come quelle vicine ai limiti. **Pause** o **Stop** rimuove il filtro, quindi la successiva riproduzione normale usa l’intera gamma di frequenze. Audio, selezioni, cronologia di annullamento e file esportati restano invariati.

### Riduci le sibilanti {#reduce-sibilance}

Scegli **Effect → Noise removal and repair → De-esser**. Imposta **Frequency** vicino alla parte
aspra della voce, poi abbassa **Threshold** finché le sibilanti non si attenuano. **Maximum reduction**
limita il taglio: inizia intorno a 6–9 dB. Un **Attack** più breve cattura l'inizio di una consonante,
mentre **Release** controlla la rapidità con cui si riprendono le alte frequenze. Viene ridotta solo la
banda superiore.

### Comprimi bande di frequenza separate {#multiband-compression}

Scegli **Effect → Volume and compression → Multiband compressor**. I due crossover dividono il
segnale nelle bande bassa, media e alta. Ogni banda ha la propria soglia, il proprio rapporto e il
proprio guadagno di uscita. Un rapporto pari a 1 lascia inalterata la dinamica di quella banda.
Attack e release si applicano a tutte e tre le bande. I crossover hanno pendenze dolci e sovrapposte
di 6 dB per ottava; con tutti i rapporti a 1 e i guadagni delle bande a 0 dB, il segnale originale
passa senza variazioni.

Entrambi gli effetti collegano i canali per conservare l'equilibrio stereo e sono disponibili anche
nei rack degli effetti della traccia e del master. Le impostazioni dei rack vengono salvate con il
progetto e possono essere regolate durante la riproduzione. **Apply to selection** esegue il rendering
dell'effetto sull'audio selezionato e supporta **Undo**. Per questi due effetti non è disponibile
l'automazione della timeline.

### Usa effetti LADSPA e analizzatori Vamp {#native-audio-plugins}

L'app desktop può cercare plug-in di terze parti solo dopo che hai autorizzato un formato e una delle
sue cartelle in **Effect → Plugin Manager**. La scansione non è mai automatica. Autorizza ogni
installazione trovata prima di usarla e installa solo plug-in di cui ti fidi: i plug-in nativi
eseguono codice eseguibile anche se Soundscaper li ospita in processi helper supervisionati.

Gli effetti LADSPA sono disponibili su Linux. Dopo averli abilitati nel gestore, aprine uno da
**Effect → Audio Plugins**. Soundscaper costruisce i controlli a partire dalle porte LADSPA, perché
questo formato non ha un'interfaccia del produttore. I valori dei controlli e lo stato attivo o
bypassato dell'effetto vengono salvati con il progetto.

I plug-in Vamp analizzano l'audio senza modificarlo. Dopo aver abilitato un'installazione Vamp,
seleziona una traccia audio per analizzarla, oppure non selezionare alcuna traccia audio per
analizzare il mix master. Una selezione temporale limita l'analisi; altrimenti Soundscaper usa
l'intero progetto. Scegli **Analyze → Vamp Plugins**, seleziona l'output dell'analizzatore e le sue
impostazioni, quindi eseguilo. Soundscaper aggiunge i timestamp restituiti come nuova traccia di
etichette solo dopo che l'analisi completa è riuscita, quindi annullare o modificare il progetto non
può lasciare etichette parziali.

## Esporta

Scegli **File → Export audio** per una consegna con il mix oppure **Export selected audio** quando
deve essere renderizzata solo una selezione. Soundscaper può esportare anche stem ed etichette.

### Esportare le clip come file separati {#export-clips}

Scegli **File → Esporta audio** e imposta **Output** su **Clip singole (dividi per clip)**. Scegli un formato audio e premi **Esporta** per scaricare un archivio con un file per ogni clip audio nelle tracce audio del progetto. Ogni file inizia all’inizio udibile della clip e termina alla sua fine udibile, senza estensioni fino alla timeline del progetto né code di effetti aggiunte. Sono inclusi tagli, guadagno della clip, dissolvenze e modifiche di velocità e intonazione. Le clip sovrapposte restano separate.

I file usano i nomi delle clip con prefissi numerati. I caratteri non supportati nei nomi vengono sostituiti e i numeri distinguono i nomi ripetuti. Sono inclusi gli effetti delle tracce; effetti master, mute e solo non influiscono su questa esportazione. Scongela prima le tracce congelate per esportare separatamente le clip modificabili.

I formati compressi usano il runtime FFmpeg. I formati esatti e la disponibilità condizionata sono
elencati nel [riferimento ai formati generato](/reference/).

### Incorpora i marcatori di capitolo {#embedded-chapters}

Nell’editor del browser, scegli **File → Export audio**, seleziona **MP3** o **AAC / M4A** e attiva **Embed labels as chapters** in **Audio options**. L’opzione è disattivata per impostazione predefinita e inserisce titoli e orari delle etichette in un unico file mixato. Aggiungi le etichette prima di esportare; l’opzione non è disponibile per stem, divisioni in capitoli o sequenze di mastering.

Sono incluse solo le etichette che intersecano l’intervallo consegnato. Esportando una selezione, gli orari dei capitoli vengono spostati all’inizio del file prodotto. MP3 conserva gli orari di fine delle etichette di regione; un’etichetta puntuale termina al capitolo successivo o alla fine del file. M4A memorizza gli inizi dei capitoli, e ciascuno continua fino all’inizio successivo o alla fine del file. M4A supporta fino a 255 capitoli e 255 byte UTF-8 per titolo. La visualizzazione dei capitoli incorporati dipende dal lettore.

Riproduci il file esportato in un'altra applicazione prima di consegnarlo o eliminare il materiale
sorgente.

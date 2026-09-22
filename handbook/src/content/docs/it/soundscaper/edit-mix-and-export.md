---
title: "Modifica, mescola ed esporta"
description: "Organizza le clip, bilancia le tracce, applica effetti e crea un file di consegna."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"it"} -->

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

## Costruisci il mix

Usa i controlli di guadagno della traccia, pan, mute e solo per bilanciare il progetto. Il pannello
Mixer mostra lo stesso stato del progetto in una disposizione orientata al mix. Gli effetti in tempo
reale restano regolabili; le operazioni distruttive o renderizzate creano modifiche al progetto che
possono essere annullate finché la cronologia è disponibile.

Usa il misuratore di riproduzione e l'analisi della loudness per controllare il risultato. Non trattare
il valore obiettivo del misuratore come un sostituto dell'ascolto dell'esportazione completa.

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

I formati compressi usano il runtime FFmpeg. I formati esatti e la disponibilità condizionata sono
elencati nel [riferimento ai formati generato](/reference/).

Riproduci il file esportato in un'altra applicazione prima di consegnarlo o eliminare il materiale
sorgente.

Per lavori con immagini — composizione di una sequenza, effetti video e una consegna MP4 o WebM —
affida il progetto a [Framescaper](/framescaper/) e consulta [esporta video](/framescaper/video-export/).

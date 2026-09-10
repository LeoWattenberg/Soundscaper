---
title: "Modifica, mescola ed esporta"
description: "Organizza le clip, bilancia le tracce, applica effetti e crea un file di consegna."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","targetLocale":"it"} -->

## Organizza le clip

Seleziona le clip o un intervallo di tempo prima di scegliere un comando di modifica. Split crea un confine di modifica sulla testina di riproduzione. Le varianti Gap-preserving e ripple determinano se il materiale successivo rimane in posizione o si sposta per chiudere la regione rimossa.

Utilizza cartelle di traccia, gruppi di clip e Project Bin per mantenere organizzati i progetti più grandi.

### Regola i dissolvenzi delle clip {#clip-fades}

Seleziona una clip audio per visualizzare piccoli manici triangolari lungo la parte superiore della sua forma d'onda, direttamente sotto l'intestazione della clip.
Trascina il triangolo sinistro verso l'interno per un fade-in, o il triangolo destro verso l'interno per un fade-out. La forma d'onda cambia durante il trascinamento e l'area sopra la curva del dissolvenzo diventa più scura. I triangoli seguono i confini del dissolvenzo; trascinando uno di essi verso il suo angolo originale, si rimuove quel dissolvenzo. Viene modificata solo la clip trascinata, anche quando sono selezionate più clip.

I manici scompaiono quando si deseleziona la clip, ma la forma d'onda dissolta e la sfumatura rimangono. Questi dissolvenzi preservano l'audio originale e restano regolabili dopo il salvataggio e la riapertura del progetto. Rilascia per confermare un dissolvenzo, oppure premi **Escape** durante il trascinamento per annullare. **Annulla** inverte un trascinamento completo. La riproduzione e l'esportazione utilizzano le impostazioni del dissolvenzo confermate.

Con una clip selezionata e focalizzata, premi **Tab** per raggiungere i suoi manici di dissolvenzo. I tasti freccia regolano la durata di 10 millisecondi, oppure di 100 millisecondi con **Shift**. **Home** rimuove il dissolvenzo; **End** lo estende su tutta la clip.
Per l'immissione numerica, scegli **Modifica → Clip audio → Proprietà clip** e
usa **Dissolvenza**.

## Crea il mix

Utilizza i controlli di guadagno di traccia, pan, mute e solo per bilanciare il progetto. Il pannello Mixer espone lo stesso stato del progetto in un layout orientato al mix. Gli effetti in tempo reale restano regolabili; le operazioni distruttive o renderizzate creano modifiche al progetto che possono essere annullate mentre la cronologia è disponibile.

Utilizza il misuratore di riproduzione e l'analisi della loudness per ispezionare il risultato. Evita di considerare un target del misuratore come sostituto dell'ascolto dell'esportazione completa.

### Riduci la sibilanza {#reduce-sibilance}

Scegli **Effetto → Rimozione e riparazione del rumore → De-esser**. Imposta **Frequenza** vicino alla parte aspra della voce, quindi abbassa **Soglia** finché i sibilanti non si ammorbidiscono.
**Riduzione massima** limita il taglio; inizia intorno a 6–9 dB. Un **Attack** più breve
rileva l'inizio di una consonante, mentre **Release** controlla la velocità con cui le
alte frequenze si riprendono. Viene ridotta solo la banda superiore.

### Comprimi bande di frequenza separate {#multiband-compression}

Scegli **Effetto → Volume e compressione → Compressore multibanda**. I due
crossover dividono il segnale in bande basse, medie e alte. Ogni banda ha la
sua soglia, rapporto e guadagno di uscita. Un rapporto di 1 lascia invariata la dinamica di quella banda. Attack e release si applicano a tutte e tre le bande. I crossover hanno
pendenze dolci e sovrapposte di 6 dB/ottava; con tutti i rapporti a 1 e i guadagni delle bande a
0 dB, il segnale originale passa invariato.

Entrambi gli effetti collegano i propri canali per preservare l'equilibrio stereo e sono anche
disponibili negli rack di effetti di traccia e master. Le impostazioni del rack vengono salvate con il
progetto e possono essere regolate durante la riproduzione. **Applica alla selezione** renderizza l'
effetto nell'audio selezionato e supporta Annulla. L'automazione della timeline non
è disponibile per questi due effetti.

## Esporta

Scegli **File → Esporta audio** per una consegna mixata o **Esporta audio selezionato**
quando solo una selezione deve essere renderizzata. Soundscaper può anche esportare stampe ed
etichette.

I formati compressi utilizzano il runtime FFmpeg. I formati esatti e la disponibilità
condizionale sono elencati nel [riferimento ai formati generato](/reference/).

Riproduci il file esportato in un'altra applicazione prima di consegnarlo o eliminare
il materiale sorgente.

Per il lavoro su immagini — composizione di una sequenza, effetti video e una
consegna MP4 o WebM — passa il progetto a [Framescaper](/framescaper/) e consulta
[esporta video](/framescaper/video-export/).

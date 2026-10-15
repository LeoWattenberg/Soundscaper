---
title: "Motionscaper"
description: "Crea composizioni animate e conserva in locale progetti di animazione modificabili."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"it"} -->

Motionscaper è l'editor di grafica animata della famiglia Scaper. Un progetto
contiene composizioni, livelli, animazioni e media conservati. L'estensione del
suo file di progetto è `.mscape`.

Questa è una versione di sviluppo. Inizia con una copia del materiale sorgente
importante e conserva gli archivi di progetto esportati insieme alla libreria di lavoro.

## Inizia una composizione {#start-a-composition}

Scegli **File → Nuova composizione**. Il menu **Livello** apre gli strumenti per testo, forme,
animazione, compositing, tracciamento, espressioni e scene 3D. **Visualizza →
Anteprima della composizione** apre la riproduzione; le nuove superfici di modifica appaiono quando
le scegli da un menu.

Scegli **Visualizza → Area della composizione** per selezionare, spostare, ridimensionare o ruotare livelli con
trasformazioni 2D statiche. Le trasformazioni animate restano modificabili tramite gli strumenti delle proprietà
e della timeline.

In **Visualizza → Timeline**, seleziona i livelli esistenti per rinominarli, abilitarli, disabilitarli o
rimuoverli. La rinomina conserva i riferimenti alle proprietà e l'animazione. La rimozione di un
livello ne conserva i media originali; includi i livelli dipendenti o scollega prima i relativi
collegamenti. **Annulla** ripristina i livelli rimossi. Un livello video selezionato
mostra anche una casella audio quando la sorgente conservata contiene audio.

Segui [il tuo primo progetto di animazione](/motionscaper/first-project/) per creare,
animare, salvare e renderizzare una composizione.

## Salva e distribuisci {#save-and-deliver}

**File → Salva** pubblica una revisione salvata. **Salva copia** esporta l'istantanea
attuale come archivio `.mscape` senza pubblicare una nuova revisione salvata.
I media e i font originali importati accompagnano l'archivio. La **Libreria
progetti** apre i progetti conservati su questo dispositivo.

**File → Rendering** offre fotogrammi PNG trasparenti in un archivio TAR,
video opachi MP4 o WebM e ProRes 4444 quando l'encoder desktop è disponibile.
Le sequenze PNG escludono l'audio. Il video nel browser conserva l'audio creato quando il suo
encoder supporta il formato richiesto. ProRes nativo indica la precisione effettiva
di colore e alfa nella finestra di rendering. **File → Coda di rendering** mantiene
disponibili i processi anche chiudendo le finestre o cambiando progetto. Conserva fino a otto
processi e 128 MiB di download nel browser; ogni download ammette fino a 64 MiB. Scegli
una destinazione file in streaming per output più grandi e rimuovi i processi completati per
liberare i download conservati. Se la pulizia dell'output nativo fallisce, usa **Riprova la pulizia
dell'output** in questa coda. Il processo mantiene la destinazione finché la pulizia non riesce;
puoi quindi rimuoverlo o riprovare la revisione inviata con una nuova destinazione.

## Collega a Framescaper {#link-to-framescaper}

Le composizioni collegate richiedono la linea di sviluppo separata Framescaper 1.1.
Nella sua finestra **File → Composizioni collegate**, crea un URL di abbinamento. Incollalo
nella finestra **File → Invia composizione a Framescaper** di Motionscaper, connettiti
e tieni aperti gli editor e le finestre del bridge. Le operazioni **Salva** successive inviano
automaticamente nuove revisioni; **Salva copia** non lo fa.

Framescaper conserva ogni revisione accettata e l'insieme completo dei relativi media per
l'uso offline. Annulla fissa una revisione precedente finché non riprendi gli aggiornamenti. Le modifiche a
dimensioni dell'output, temporizzazione o griglia audio richiedono un esame esplicito di conformazione.
Il ricevitore desktop può invece monitorare un file `.mscape` salvato che selezioni.

## Controlla gli aggiornamenti desktop {#check-desktop-updates}

Scegli **Aiuto → Controlla aggiornamenti** nell'app desktop. Questo controllo manuale cerca
versioni compatibili di Motionscaper nel repository GitHub del progetto. Le versioni
in anteprima possono ricevere nuove versioni in anteprima; le versioni stabili ricevono versioni
stabili. Scegli **Visualizza versione** per aprire la pagina verificata della versione. Il controllo
non scarica né installa un aggiornamento. Le build per browser omettono questo comando di menu.

## Scambio con After Effects {#after-effects-exchange}

**File → Bridge After Effects** offre script leggibili ed esamina i dati di scambio
supportati prima dell'importazione. I file `.aep` e `.aepx` vengono aperti tramite una
copia installata di After Effects e gli script del bridge. Il bridge in sviluppo
non è ancora stato convalidato con After Effects installato. Esamina il rapporto;
le impostazioni di scena non supportate e i media originali restano conservati con il progetto.

La finestra offre opzioni separate di importazione ed esportazione per le espressioni scalari
di opacità supportate che usano aritmetica, tempo della composizione, valore prima
dell'espressione e funzioni Math standard. Entrambe le opzioni sono inizialmente disattivate. Esamina il nuovo
rapporto dopo aver cambiato un'opzione; altre forme di espressione richiedono campionamento
o rendering espliciti. Il sorgente originale delle espressioni resta nello scambio
conservato o nell'archivio `original.mscape`.

Il renderer supporta colore e alfa SDR con livelli 2.5D, camere, luci,
campionamento dell'otturatore e profondità di campo. Non dichiara supporto per HDR, mesh 3D complete,
mascheratura AI avanzata o compatibilità con plug-in arbitrari di After Effects.

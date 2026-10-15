---
title: "Il tuo primo progetto di animazione"
description: "Crea una composizione, anima un livello ed esporta un progetto salvato."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"it"} -->

## Crea e aggiungi un livello {#create-and-add-a-layer}

1. Scegli **File → Nuova composizione** e inserisci titolo, dimensioni, frequenza fotogrammi
   e durata in fotogrammi.
2. Scegli **Livello → Nuovo testo** o **Livello → Nuova tinta unita**. Scegli la composizione
   di destinazione quando il progetto ne contiene diverse.
3. Apri **Livello → Testo e aspetto** per modificare un livello di testo esistente o
   i riempimenti e i contorni di una forma. I font importati qui vengono conservati con il progetto.

Usa **File → Importa media** per sorgenti immagine, video o audio. Un'importazione che
supera i limiti attuali del decoder o della memoria viene rifiutata con una spiegazione;
il file sorgente originale resta inalterato.

## Anima e visualizza l'anteprima {#animate-and-preview}

Apri **Livello → Proprietà e fotogrammi chiave** per scegliere una proprietà del livello e aggiungere
fotogrammi chiave in posizioni esatte. I controlli delle curve modificano l'interpolazione; la modifica
spaziale cambia i tracciati di posizione. **Visualizza → Timeline** apre i controlli di temporizzazione,
ordinamento, raggruppamento e area di lavoro dei livelli.

Apri **Visualizza → Area della composizione** per selezionare e spostare un livello 2D statico. Il
quadrato lo ridimensiona e il cerchio lo ruota attorno al punto di ancoraggio impostato. Ogni
trascinamento completato è un solo passaggio di annullamento; Esc annulla un trascinamento. Le trasformazioni animate e
guidate da espressioni restano in Proprietà e fotogrammi chiave.

Apri **Visualizza → Anteprima della composizione** per spostarti nel tempo o riprodurre la composizione. L'anteprima
usa i media sorgente conservati. Impostazioni di scena non supportate o non valide producono un
errore al posto di un'immagine sostitutiva. Chiudi l'anteprima per liberarne le risorse
di rendering attive.

## Salva una copia portabile {#save-a-portable-copy}

Scegli **File → Salva** per pubblicare la revisione attuale, quindi **File → Salva copia**
per scaricare un archivio `.mscape`. L'archivio include il progetto e i media
originali necessari per riaprirlo. Aprilo con **File → Apri** su un altro dispositivo o
da una nuova libreria del browser.

## Rendering {#render}

Scegli **File → Rendering**. Seleziona una composizione, il formato di output e
l'intervallo di fotogrammi. Il fotogramma finale è escluso: i fotogrammi da 0 a 29 usano l'intervallo
`0`–`30`. Un'area di lavoro frazionaria seleziona gli istanti di campionamento interi che contiene;
un'area senza campioni di output deve essere modificata prima del rendering.

Usa **Sequenza PNG trasparente (.tar)** per l'alfa. Estrai l'archivio TAR per
ottenere normali immagini PNG e metadati di temporizzazione. MP4 e WebM usano il colore
di sfondo selezionato nella finestra. Il rendering fissa la revisione inviata, così le modifiche
successive non alterano un output già in corso. Chiudere la finestra di rendering
lascia il processo in esecuzione. **File → Coda di rendering** mostra avanzamento, annullamento,
nuovo tentativo della revisione inviata e download completati. La chiusura dell'editor
annulla i processi incompleti.

Torna al [manuale di Motionscaper](/motionscaper/).

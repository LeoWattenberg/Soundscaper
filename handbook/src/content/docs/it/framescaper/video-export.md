---
title: "Esporta video"
description: "Convalida la sequenza composita e crea una consegna in formato MP4 o WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"it"} -->

## Prima dell'esportazione

- Riproduci la sequenza completa e ogni confine di modifica.
- Verifica che le tracce visibili e in modalità solo producano l'immagine prevista.
- Controlla che l'audio collegato rimanga sincronizzato.
- Conferma l'intervallo di esportazione e se includere sottotitoli o audio.

## Creare il file

Apri la finestra di dialogo di esportazione e seleziona un formato video. Framescaper supporta la distribuzione in MP4 e
WebM tramite il runtime video configurato. Scegli le dimensioni,
la frequenza dei fotogrammi e altre opzioni appropriate per la destinazione.

La codifica video è più intensiva in termini di risorse rispetto alla normale riproduzione della timeline.
Mantieni l'editor aperto fino a quando l'esportazione non segnala il completamento.

## Verificare la consegna

Apri il file esportato in un player separato. Controlla la sua durata, il primo e l'ultimo
fotogramma, l'orientamento dell'immagine, la sincronizzazione audio e i sottotitoli previsti.

Il video renderizzato non può sostituire il progetto modificabile. Esporta anche una copia `.fscape`
quando è necessario preservare la timeline e i media del progetto.

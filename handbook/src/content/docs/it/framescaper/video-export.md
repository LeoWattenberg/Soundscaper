---
title: "Esporta video"
description: "Convalida la sequenza composita e crea una consegna in formato MP4 o WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"it"} -->

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

## Esportare separatamente le clip audio {#export-audio-clips}

Scegli **File → Esporta video**, seleziona un formato audio come **WAV** e imposta **Output** su **Clip singole (dividi per clip)**. L’esportazione scarica un archivio con un file per ogni clip audio. Le clip video sono escluse e ogni file audio contiene solo la clip corrispondente, inclusi tagli e modifiche.

I file iniziano dall’inizio udibile della clip, senza spazio fino alla sua posizione nel progetto né coda dell’effetto. I nomi numerati distinguono le clip con lo stesso nome.

Gli effetti della traccia sono inclusi; gli effetti master, il silenziamento e il solo non influiscono su questa esportazione. Per il flusso audio condiviso, consulta [Esportare le clip come file separati](/soundscaper/edit-mix-and-export/#export-clips).

## Verificare la consegna

Apri il file esportato in un player separato. Controlla la sua durata, il primo e l'ultimo
fotogramma, l'orientamento dell'immagine, la sincronizzazione audio e i sottotitoli previsti.

Il video renderizzato non può sostituire il progetto modificabile. Esporta anche una copia `.fscape`
quando è necessario preservare la timeline e i media del progetto.

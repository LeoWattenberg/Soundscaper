---
title: "Sovrascrivere un file importato su desktop"
description: "Salva il progetto modificato sopra il file multimediale originale in Soundscaper o Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"it"} -->

Nelle versioni Electron di Soundscaper e Framescaper, **File → Sovrascrivi nome file** esporta l’intero progetto modificato nel file multimediale importato in origine. Usa le impostazioni di esportazione supportate dal file originale e salva subito, senza aprire la finestra di esportazione o il selettore di file. L’audio mantiene il formato sorgente, la frequenza di campionamento e il numero di canali. I video MP4 e WebM supportati mantengono il contenitore, le dimensioni e la frequenza dei fotogrammi originali.

Importa un file multimediale con **File → Importa**, apporta le modifiche, quindi scegli **File → Sovrascrivi nome file**. Puoi ripetere l’operazione dopo ulteriori modifiche. Una selezione temporale non limita la sovrascrittura: viene sempre renderizzato l’intero progetto. Il progetto conserva i file multimediali importati e la cronologia delle modifiche.

Il comando non è disponibile se il progetto non contiene un file originale supportato, se sono stati importati più file originali o durante l’importazione, la registrazione o l’elaborazione. Le versioni browser usano la normale finestra di esportazione.

Scegli **File → Esporta audio** in Soundscaper o **File → Esporta video** in Framescaper se vuoi scegliere un’altra destinazione o modificare le impostazioni di consegna. La sovrascrittura sostituisce il contenuto del file originale; conserva una copia separata se ti serve la registrazione non modificata.

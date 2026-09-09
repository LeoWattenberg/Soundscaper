---
title: "Archiviazione, backup e privacy"
description: "Comprendi l'archiviazione locale-prima e proteggi i progetti da perdite di browser o dispositivo."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"it"} -->

## Cosa significa local-first

Progetti, registrazioni e media importati vengono elaborati e archiviati sul tuo dispositivo. L'editor non richiede un account o sincronizza i progetti con un servizio Soundscaper.

Sul web, l'audio e i media utilizzano il file system origin-private del browser quando disponibile, con fallback IndexedDB. Soundscaper richiede uno spazio di archiviazione persistente, ma il browser decide se concederlo o meno.

## Cosa può rimuovere un progetto

- La cancellazione dei dati del sito rimuove la libreria di progetti locale del browser.
- Contesti del browser privati o limitati possono ricorrere alla memoria temporanea.
- I limiti di quota e le politiche di eliminazione del browser rimangono autoritativi.
- La rimozione manuale dei dati dell'applicazione desktop rimuove la sua libreria locale.
- Un guasto del dispositivo o dello spazio di archiviazione può rimuovere ogni copia locale su quel dispositivo.

La disinstallazione di una build desktop impacchettata è progettata per preservare la sua libreria, ma non è una strategia di backup.

## Routine di backup

In momenti utili e prima di cancellare o migrare lo spazio di archiviazione:

1. Attendi il completamento del salvataggio locale.
2. Esporta un file di progetto Scape (`.sscape` o `.fscape`).
3. Esporta e riproduci una resa di consegna.
4. Copia entrambi in uno spazio di archiviazione al di fuori dei dati locali dell'editor.

Utilizza AUP4 in aggiunta quando l'intercambio Audacity è importante, non al posto della copia del progetto Scape.

## Privacy del sito di documentazione

Questa guida viene servita come file statici e utilizza la ricerca locale del browser. Il sito V1 non aggiunge un servizio di analisi o un backend AI/search.

La completa [politica sulla privacy di Soundscaper e Framescaper](https://soundscaper.org/privacy/en/) copre anche la consegna dell'applicazione, le autorizzazioni del dispositivo, i download opzionali, i controlli di aggiornamento desktop e le connessioni VCR Web di Framescaper.
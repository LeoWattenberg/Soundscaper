---
title: "Importazione ed esportazione"
description: "Distinguere i media di origine, i file di progetto, i file di interscambio e le consegne rese."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"it"} -->

Soundscaper usa tipi di file diversi per lavori diversi.

## Media di origine

Usa **File → Importa** per audio, video ed etichette. L'indicazione attuale dell'editor elenca
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; il percorso di importazione video
supporta anche altri contenitori video. La disponibilità può dipendere dal prodotto e dal runtime
attivi.

L'importazione dei media aggiunge una sorgente di proprietà del progetto. Non trasforma il file
originale nel documento modificabile del progetto.

Le importazioni e le esportazioni audio compresse supportano fino a un'ora o 1 GB
(1,000,000,000 byte di file), a seconda di quale limite viene raggiunto per primo. Un file stereo di
un'ora a 48 kHz è supportato quando rientra nel limite delle dimensioni. I lavori lunghi leggono,
codificano e salvano a blocchi; le esportazioni browser di grandi dimensioni richiedono spazio di
archiviazione privato dell'origine e spazio libero sufficiente. Le importazioni grandi richiedono
l'archiviazione locale persistente per l'audio decodificato. I formati PCM mantengono i propri limiti
separati.

Il livello browser supporta MP3, MP2, FLAC, WavPack, Opus e Ogg Vorbis. Il supporto AAC/M4A nel
browser dipende dal codec del browser. Le esportazioni desktop in streaming coprono i sei formati
inclusi, oltre a FLAC lossless a 24 bit e WavPack lossless float32. Le importazioni desktop dipendono
dalla disponibilità dei decoder nativi; MP2 usa il livello di compatibilità dell'utility più piccola.
AAC desktop e i provider di compatibilità mantengono i propri limiti separati.

Un lavoro attivo mostra una barra di avanzamento anche quando **View → Status bar** è nascosta.
Scegli **Cancel** accanto alla barra per interrompere un'importazione o un'esportazione audio.

## File di progetto modificabili

- Scape (`.sscape` da Soundscaper, `.fscape` da Framescaper, ed entrambi apribili in entrambi i programmi) è il formato di progetto portatile e a piena fedeltà condiviso da Soundscaper e Framescaper.
- AUP4 è un formato di interscambio solo audio con Audacity. Non è un backup completo di un progetto Soundscaper con contenuti multimediali.

Vedi [File di progetto](/projects-and-data/project-files/) per le conseguenze di ogni scelta.

## Consegne renderizzate

Le esportazioni audio creano file destinati all'ascolto, alla pubblicazione o a un'ulteriore elaborazione. Le esportazioni video creano consegne MP4 o WebM. Un file renderizzato non conserva la timeline modificabile, il routing, gli effetti o la cronologia del progetto.

Consulta la [sezione di riferimento](/reference/) per le tabelle generate dei formati e delle capacità dei prodotti.

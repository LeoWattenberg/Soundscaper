---
title: "Importazione ed esportazione"
description: "Distinguere i media di origine, i file di progetto, i file di interscambio e le consegne rese."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"it"} -->

Soundscaper usa tipi di file diversi per lavori diversi.

## Media di origine

Usa **File → Importa** per audio, video ed etichette. L'indicazione attuale dell'editor elenca
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; il percorso di importazione video
supporta anche altri contenitori video. La disponibilità può dipendere dal prodotto e dal runtime
attivi.

L'importazione dei media aggiunge una sorgente di proprietà del progetto. Non trasforma il file
originale nel documento modificabile del progetto.

Le esportazioni di audio compresso e le importazioni nel browser supportano fino a un’ora o 1 GB (1,000,000,000 byte di file), a seconda del limite raggiunto per primo. La selezione dei file sul desktop e l’importazione di audio compresso non hanno un limite fisso di dimensione o durata al di sotto dell’intervallo degli interi sicuri. I lavori lunghi leggono, codificano e salvano a blocchi; le esportazioni browser di grandi dimensioni richiedono spazio di archiviazione privato dell’origine e spazio libero sufficiente. Le importazioni grandi richiedono spazio locale sufficiente per l’audio decodificato. Anche la struttura del formato, il supporto del decoder e lo spazio disponibile possono limitare un’importazione.

Il livello browser supporta MP3, MP2, FLAC, WavPack, Opus e Ogg Vorbis. Il supporto AAC/M4A dipende dal codec del browser. Le esportazioni desktop in streaming coprono i sei formati inclusi, oltre a FLAC lossless a 24 bit e WavPack float32 senza perdita. Le importazioni desktop dipendono dalla disponibilità dei decoder; le sorgenti MP2 grandi usano il decoder a pacchetti, mentre quelle più piccole usano il livello di compatibilità dell’utility.

Un lavoro attivo mostra una barra di avanzamento anche quando **View → Status bar** è nascosta.
Scegli **Cancel** accanto alla barra per interrompere un'importazione o un'esportazione audio.

## File di progetto modificabili

- Scape (`.sscape` da Soundscaper, `.fscape` da Framescaper, ed entrambi apribili in entrambi i programmi) è il formato di progetto portatile e a piena fedeltà condiviso da Soundscaper e Framescaper.
- AUP3 e AUP4 consentono lo scambio audio con Audacity. Scegli AUP3 per il profilo di progetto Audacity 3.7.9 o AUP4 per il profilo di scambio attuale. Nessuno dei due è un backup completo di un progetto Soundscaper con contenuti multimediali; dopo l’esportazione controlla il rapporto di compatibilità.
- L’edizione desktop può aprire sessioni Adobe Audition SESX (`.sesx`) per creare un progetto locale dai file audio a cui fanno riferimento. Conserva la sessione e i media originali; l’esportazione SESX non è disponibile.

Vedi [File di progetto](/projects-and-data/project-files/) per le conseguenze di ogni scelta.

## Consegne renderizzate

Le esportazioni audio creano file destinati all'ascolto, alla pubblicazione o a un'ulteriore elaborazione. Le esportazioni video creano consegne MP4 o WebM. Un file renderizzato non conserva la timeline modificabile, il routing, gli effetti o la cronologia del progetto.

Consulta la [sezione di riferimento](/reference/) per le tabelle generate dei formati e delle capacità dei prodotti.

---
title: "Importazione ed esportazione"
description: "Distinguere i media di origine, i file di progetto, i file di interscambio e le consegne rese."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","targetLocale":"it"} -->

Soundscaper utilizza diversi tipi di file per diversi compiti.

## Media di origine

Utilizza **File → Importa** per audio, video e etichette. L'attuale suggerimento dell'editor elenca
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF e WebM; sono supportati ulteriori contenitori video tramite il percorso di importazione video. La disponibilità può dipendere
dal prodotto attivo e dall'esecuzione.

L'importazione di media aggiunge una fonte di proprietà del progetto. Non rende il file originale
il documento modificabile del tuo progetto.

## File di progetto modificabili

- Scape (`.sscape` da Soundscaper, `.fscape` da Framescaper e uno dei due apribile in entrambi) è il formato di progetto portatile, a piena fedeltà condiviso da Soundscaper
e Framescaper.
- AUP4 è uno scambio audio-only con Audacity. Non è un backup completo di un progetto multimediale Soundscaper.

Vedi [File di progetto](/projects-and-data/project-files/) per le conseguenze
di ogni scelta.

## Consegne rese

Le esportazioni audio creano file destinati all'ascolto, alla pubblicazione o ad ulteriore
Elaborazione. Le esportazioni video creano consegne MP4 o WebM. Un file reso non
mantiene la timeline modificabile, il routing, gli effetti o la cronologia del progetto.

Consulta la sezione [di riferimento](/reference/) per le tabelle di formato generato e
capacità del prodotto.
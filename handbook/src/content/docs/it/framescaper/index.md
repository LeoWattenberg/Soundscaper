---
title: "Framescaper"
description: "Organizza i video, composita le immagini e consegna un progetto video incentrato sulla localizzazione."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","targetLocale":"it"} -->

Framescaper è la visuale incentrata sul video dell'editor condiviso. Sottolinea l'anteprima video, il monitoraggio della sorgente, gli effetti delle immagini, la composizione, le sequenze annidate e il lavoro multicamera.

Soundscaper e Framescaper aprono i file di progetto ciascuno dell'altro: `.sscape`, `.fscape` e il più vecchio `.scape` funzionano tutti in entrambi. Usa Soundscaper per la registrazione e la produzione audio dettagliata, poi restituisci il progetto a Framescaper per il lavoro sulle immagini.

## Cosa si trova dove

Framescaper gestisce le immagini: importazione video, monitoraggio della sorgente e anteprima video, effetti sulle immagini, geometria e composizione, sequenze annidate, lavoro multicamera e distribuzione video. Le corsie di immagini e audio collegate rimangono sincronizzate qui fino a quando non le si scollega.

Soundscaper gestisce l'audio: registrazione audio, effetti e analisi, mixaggio e distribuzione audio. Framescaper utilizza un flusso di lavoro di acquisizione diverso e non espone il set di strumenti di registrazione audio di Soundscaper, quindi registra in Soundscaper e porta il progetto indietro. Le guide passo-passo [guide](/guides/) sono scritte e verificate contro Soundscaper e coprono anche il lato audio di un progetto video.

## Percorso raccomandato

1. [Crea un primo progetto Framescaper](/framescaper/first-project/).
2. [Prepara ed esporta video](/framescaper/video-export/).
3. Rivedi il comportamento [file di progetto e backup](/projects-and-data/project-files/).

Apri l'editor del browser a
[soundscaper.org/framescaper/en](https://soundscaper.org/framescaper/en/).
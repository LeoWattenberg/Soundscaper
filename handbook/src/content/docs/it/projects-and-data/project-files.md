---
title: "File del progetto"
description: "Scegli tra la libreria locale, i file del progetto Scape, AUP4 e i backup renderizzati."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"it"} -->

## Libreria locale del progetto

L'editor salva i progetti di lavoro nella sua libreria locale. In un browser, si tratta di archiviazione privata dell'origine; nell'edizione desktop è dati dell'applicazione. Questa è la comoda copia di lavoro, non l'unica copia che dovresti conservare.

## File di progetto Scape

Utilizza **File → Esporta file progetto** per un progetto portatile senza perdita di dati. Ogni prodotto scrive il proprio suffisso: Soundscaper salva `.sscape` e Framescaper salva `.fscape`, e la voce del menu indica quale si applica. Il formato dietro entrambi è lo stesso, quindi è la scelta appropriata quando è necessario preservare lo stato di editing multimodale.

Entrambi i prodotti aprono entrambi i suffissi. `.sscape`, `.fscape`, il riservato `.liscape` e i più vecchi file `.scape` esportati prima che i prodotti avessero i propri suffissi si aprono ovunque, e il salvataggio di uno da un prodotto diverso lo rinomina semplicemente - ad esempio, un file `Mix.sscape` salvato da Framescaper diventa `Mix.fscape`. Nulla del progetto cambia con il nome.

L'importazione o l'apertura di una copia Scape può incontrare un progetto esistente con lo stesso ID. Utilizza il flusso di lavoro di copia offerto quando entrambe le versioni devono rimanere nella libreria locale.

## AUP4

AUP4 esiste per uno scambio audio compatibile con Audacity. L'esportazione produce un rapporto di compatibilità che descrive le conversioni, gli effetti non disponibili e lo stato Soundscaper-only omesso.

AUP4 è solo audio. Il video viene omesso, e le preferenze del browser, la cronologia degli annullamenti, il routing del mixer e la libreria di progetti del browser non vengono trasferiti. Non utilizzare AUP4 come unica copia di backup di un progetto Soundscaper o Framescaper.

## Backup reso

Per lavori importanti, conservare entrambi:

1. Una copia del progetto Scape (`.sscape` o `.fscape`) per future modifiche.
2. Un file audio o video reso che può essere riprodotto senza l'editor.

Archivia questi file al di fuori della directory del browser o dei dati dell'applicazione.
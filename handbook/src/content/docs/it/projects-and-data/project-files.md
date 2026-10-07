---
title: "File del progetto"
description: "Scegli tra la libreria locale, i file del progetto Scape, AUP4 e i backup renderizzati."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"it"} -->

## Libreria locale del progetto

L'editor salva i progetti di lavoro nella sua libreria locale. In un browser, si tratta di archiviazione privata dell'origine; nell'edizione desktop è dati dell'applicazione. Questa è la comoda copia di lavoro, non l'unica copia che dovresti conservare.

## File di progetto Scape

Sul desktop, audio e video importati restano per impostazione predefinita riferimenti ai file originali. Quando riapri il progetto, conserva quei file nelle posizioni originali. La libreria locale memorizza anche le cache di editing. Registrazioni e media creati o elaborati vengono inclusi perché non hanno una copia originale esterna invariata.

Scegli **File → Gestione progetto → Consolida media** per includere i media referenziati nel file di progetto. Il consolidamento salva subito il progetto; scegli una destinazione nella finestra di salvataggio. Dopo il salvataggio, la copia consolidata può essere spostata o condivisa senza i file multimediali originali. Se un media non può essere consolidato o il salvataggio non riesce, l’editor segnala il problema.

Le esportazioni browser includono automaticamente i media. Prima di aprire nel browser un progetto desktop con riferimenti esterni, consolidalo sul desktop.


Utilizza **File → Esporta file progetto** per salvare il progetto di editing. Ogni prodotto scrive il proprio suffisso: Soundscaper salva `.sscape` e Framescaper salva `.fscape`, e la voce del menu indica quale si applica. Il formato dietro entrambi è lo stesso, quindi è la scelta appropriata quando è necessario preservare lo stato di editing multimodale.

Entrambi i prodotti aprono entrambi i suffissi. `.sscape`, `.fscape`, il riservato `.liscape` e i più vecchi file `.scape` esportati prima che i prodotti avessero i propri suffissi si aprono ovunque, e il salvataggio di uno da un prodotto diverso lo rinomina semplicemente - ad esempio, un file `Mix.sscape` salvato da Framescaper diventa `Mix.fscape`. Nulla del progetto cambia con il nome.

L'importazione o l'apertura di una copia Scape può incontrare un progetto esistente con lo stesso ID. Utilizza il flusso di lavoro di copia offerto quando entrambe le versioni devono rimanere nella libreria locale.

## Audacity AUP3 e AUP4

L’esportazione dei progetti Audacity è disponibile da **File → Esporta altro**. Scegli **Esporta AUP3** per il profilo di progetto Audacity 3.7.9 o **Esporta AUP4** per il profilo di scambio Audacity attuale. Ogni esportazione produce un rapporto di compatibilità che descrive conversioni, effetti non disponibili e stati esclusivi di Soundscaper omessi.

Entrambi i formati contengono solo audio. Il video viene omesso e le preferenze del browser, la cronologia degli annullamenti, il routing del mixer e la libreria progetti del browser non vengono trasferiti. Non usare nessuno dei due come unica copia di backup di un progetto Soundscaper o Framescaper.

## Adobe Audition SESX

Nell’edizione desktop, usa **File → Apri** per importare una sessione Adobe Audition `.sesx`. Mantieni i file audio referenziati nella struttura di cartelle relativa sotto la cartella della sessione oppure scegli una cartella media quando richiesto. L’importazione crea un nuovo progetto locale con tracce audio, clip, posizioni, tagli, dissolvenze semplici e impostazioni statiche del mixer supportati.

L’importazione SESX è unidirezionale. Effetti Audition, automazione, routing, video, marcatori, loop, stretching, dissolvenze incrociate collegate e curve di dissolvenza esatte non vengono trasferiti. Dopo l’importazione, apri **File → Rapporto di consegna** per verificare i media mancanti e gli altri contenuti omessi. Conserva il file SESX originale e i media per continuare a lavorare in Audition.

## Backup reso

Per lavori importanti, conservare entrambi:

1. Una copia del progetto Scape (`.sscape` o `.fscape`) per future modifiche.
2. Un file audio o video reso che può essere riprodotto senza l'editor.

Archivia questi file al di fuori della directory del browser o dei dati dell'applicazione.
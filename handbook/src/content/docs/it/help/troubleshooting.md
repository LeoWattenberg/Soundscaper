---
title: "Risoluzione dei problemi"
description: "Risolvi i problemi comuni di registrazione, archiviazione, importazione ed esportazione."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"it"} -->

## Manca un'input di registrazione

Controlla i permessi del microfono per il sistema operativo e il browser, quindi riapri il selettore dispositivi. Per la registrazione multitraccia, assicurati che ogni traccia armata abbia un'assegnazione di input disponibile.

## Un comando è disabilitato

Molti comandi dipendono dallo stato corrente. Seleziona il progetto, la traccia, il clip o l'intervallo di tempo richiesto e riprova. Una funzione può anche essere intenzionalmente limitata a Soundscaper o Framescaper.

## Un'importazione utilizza troppa memoria

La decodifica compressa e alcune operazioni di grandi dimensioni possono richiedere una memoria temporanea sostanziale, anche se l'audio del progetto archiviato è suddiviso in blocchi. Chiudi le schede o le applicazioni non correlate, riprova con una sorgente più piccola o utilizza l'edizione desktop quando appropriato.

## Un progetto è scomparso dal browser

Conferma di aver aperto lo stesso profilo del browser, origine e sito del prodotto. Soundscaper e Framescaper condividono la libreria sulla stessa `soundscaper.org`
origine, ma un altro dominio, profilo del browser o archivio sito cancellato ha una libreria diversa.

Se i dati del sito sono stati cancellati e non esiste un'esportazione del progetto Scape, l'editor non ha una copia cloud da ripristinare.

## AUP4 ha omesso parte del progetto

Leggi il rapporto di compatibilità. AUP4 trasporta lo stato di editing audio compatibile ma omette il video e può convertire o omettere effetti e stato di mixing esclusivo di Soundscaper.
Utilizza un file di progetto Scape — `.sscape` o `.fscape`, entrambi apribili in entrambi i prodotti — per il trasferimento completo del progetto.

## Un'export fallisce o non viene riprodotta

Riprova dopo aver confermato che l'intervallo selezionato contiene materiale riproducibile. Per audio o video compressi, verifica che gli asset di runtime possano essere caricati. Dopo un'export riuscita, testa il file effettivo in un altro player.

Per problemi non risolti, usa **Aiuto → Supporto** per contattare il manutentore e includi il prodotto, la piattaforma, la build del browser o desktop, i passaggi e l'errore esatto.

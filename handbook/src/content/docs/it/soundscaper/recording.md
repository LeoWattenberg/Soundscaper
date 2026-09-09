---
title: "Registra audio"
description: "Concedi all'editor l'autorizzazione di input, scegli i percorsi e proteggi una ripresa completata."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"it"} -->

## Preparare l'input

1. Apri i controlli del dispositivo di registrazione e scegli un input disponibile.
2. Consenti l'autorizzazione al microfono o alla cattura quando il browser lo richiede.
3. Attiva il monitoraggio dell'input se devi ispezionare il livello in entrata prima
   della registrazione.
4. Controlla il misuratore di registrazione e regola il dispositivo o il livello di input per evitare
   il clipping.

L'autorizzazione del browser è limitata al sito e al dispositivo. Se non appare alcun input,
verifica le autorizzazioni del sistema operativo e del browser.

## Registrare una o più tracce

Per una registrazione normale, utilizza il menu **Registra** o l'azione di registrazione del trasporto.

Per il routing multitrack, scegli **Visualizza → Abilita registrazione multitrack**, arma le
tracce che desideri registrare e assegna un input a ciascuna traccia armata. La registrazione
non inizierà se non è assegnato alcun input disponibile.

Soundscaper espone anche flussi di lavoro di registrazione attivati da tempo, punch/count-in, loop/take e attivati dal suono attraverso i suoi menu. Inizia con una ripresa normale prima di aggiungere
queste condizioni.

## Dopo la ripresa

Ferma la registrazione e riproduci il nuovo clip prima di continuare. Attendi che lo stato del progetto
segni che il salvataggio è completo. Per materiale irripetibile, esporta una
copia audio resa e un progetto `.sscape` anziché fare affidamento solo sulla
biblioteca locale.

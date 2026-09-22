---
title: "Elaborazione locale, modelli e plugin"
description: "Trova assistenza locale per attività specifiche e gestisci modelli e plugin negli editor desktop."
---
<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"it"} -->

L'assistenza locale funziona sul tuo dispositivo negli editor desktop Soundscaper e Framescaper. Seleziona i media, quindi scegli il compito dal suo menu. La finestra di dialogo mostra la selezione, le impostazioni del compito e se i suoi modelli sono installati.

I pacchetti desktop includono i motori di elaborazione nativi per i modelli locali pubblicati. Installa i pesi del modello tramite Model Manager, quindi esegui il compito sui media selezionati. Consulta la guida di ogni modello [qui](/reference/local-models/) per le sue piattaforme supportate, l'ingresso del menu e i requisiti.

## Trova un compito {#find-a-task}

| Menu | Compiti |
| --- | --- |
| Effetto → Rimozione e riparazione del rumore | Migliora il dialogo, riduci la riverberazione, pulisci i riempimenti e il silenzio |
| Effetto → Separazione della fonte | Separa Dialogo / Musica / Effetti |
| Analizza → Discorso | Transcrizione e didascalie, Identifica gli oratori, Segna reazioni |
| Analizza → Musica | Rileva battute e tempo |
| Analizza → Video | Segna tagli |
| Effetto → Effetti video | Riframing |
| Modifica | Crea momenti salienti |
| Genera | Genera testo editoriale |
| Strumenti → Ricerca | Ricerca indicizzata, Indicizza trascrizione, Indicizza video |

I compiti video appartengono a Framescaper. I comandi disponibili dipendono dall'esecuzione desktop e dalle capacità del prodotto. L'opzione del menu alfabetico degli effetti di Soundscaper ordina anche gli effetti di elaborazione locale per nome.

Scegli **Esegui localmente** per avviare l'elaborazione e rispondere alla richiesta di consenso locale. Puoi annullare durante l'elaborazione. Scegli **Rivedi il risultato**, seleziona i risultati che desideri e scegli **Applica selezionati**. Le modifiche accettate al progetto possono essere annullate. La chiusura di un compito non applica le sue proposte.

**Strumenti → Elaborazione locale avanzata** mantiene i selettori di operazioni e modelli individuali. I dettagli tecnici nelle finestre di dialogo dei compiti mostrano i passaggi sottostanti e le impostazioni esatte quando necessario.

## Gestisci modelli {#manage-models}

Apri **Strumenti → Gestore modelli**, o usa **Gestisci modelli** all'interno di un compito. Il collegamento del compito filtra l'elenco per le identità del modello compatibili; **Mostra tutti i modelli** rimuove tale restrizione. Cerca per nome o compito e filtra in base allo stato di installazione.

Installa esplicitamente i modelli. I download mostrano il progresso e possono essere annullati. Il ritorno a un compito preserva le sue impostazioni e aggiorna la disponibilità dei modelli; non avvia l'elaborazione. Espandi **Archiviazione e verifica** per riparazione, pulizia, spostamento dell'archiviazione, avvisi di licenza e installazione offline da una cartella.

Consulta le guide [dei singoli modelli](/reference/local-models/) per lo scopo, l'ingresso del menu, la dimensione del download, i requisiti, le limitazioni e i controlli di inferenza reali eseguiti dal pacchetto desktop nightly-with-tests di ogni modello pubblicato.

## Gestisci plugin e dispositivi {#manage-plugins-and-devices}

**Effetto → Gestore plugin** elenca i plugin audio in Soundscaper e i plugin OpenFX in Framescaper. Cerca o filtra l'elenco, quindi seleziona un plugin per le sue versioni, i controlli dei permessi e del recupero. **Scansione e impostazioni** contiene le impostazioni di scoperta. La gestione rimane accessibile anche quando l'elaborazione è disabilitata.

Usa i plugin audio tramite **Effetto → Plugin audio**. I comandi Aggiungi/Modifica effetto video di Framescaper rimangono sotto **Effetto → Effetti video**.

Apri **Modifica → Preferenze → Impostazioni audio** per i dispositivi audio nativi e i controlli di assistenza. **Media** contiene le impostazioni multimediali native; **Effetti** collega al Gestore plugin e contiene l'interruttore di scoperta dei plugin. I permessi e il recupero della quarantena dei plugin richiedono ancora azioni esplicite.

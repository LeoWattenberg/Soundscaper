---
title: "Elaborazione locale, modelli e plugin"
description: "Trova assistenza locale per attività specifiche e gestisci modelli e plugin negli editor desktop."
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"it"} -->

L'assistenza locale funziona sul tuo dispositivo negli editor desktop Soundscaper e Framescaper. Seleziona i media, quindi scegli il compito dal suo menu. La finestra di dialogo mostra la selezione, le impostazioni del compito e se i suoi modelli sono installati.

I pacchetti desktop non includono i motori di elaborazione nativi opzionali né i pesi dei modelli. Installa un modello tramite Gestione modelli per scaricare il motore e i pesi necessari, quindi esegui l’attività sui contenuti multimediali selezionati. La prima installazione richiede una connessione di rete; le elaborazioni successive avvengono localmente. Consulta la guida di ogni modello per piattaforme supportate, voce di menu e requisiti.

Consulta le [guide dei singoli modelli](/reference/local-models/).

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

Installa i modelli esplicitamente. La prima installazione scarica anche il runtime nativo condiviso mancante di cui il modello ha bisogno. I download mostrano l’avanzamento e possono essere annullati. Tornando a un’attività, le impostazioni vengono mantenute e la disponibilità dei modelli viene aggiornata; l’elaborazione non parte. Espandi **Archiviazione e verifica** per riparazione, pulizia, spostamento dello spazio di archiviazione, avvisi di licenza e installazione offline da una cartella. Anche un modello installato da file offline richiede il runtime corrispondente prima del primo utilizzo.

Consulta le guide [dei singoli modelli](/reference/local-models/) per lo scopo, l'ingresso del menu, la dimensione del download, i requisiti, le limitazioni e i controlli di inferenza reali eseguiti dal pacchetto desktop nightly-with-tests di ogni modello pubblicato.

## Gestisci plugin e dispositivi {#manage-plugins-and-devices}

**Effetto → Gestore plugin** elenca i plugin audio in Soundscaper e i plugin OpenFX in Framescaper. Cerca o filtra l'elenco, quindi seleziona un plugin per le sue versioni, i controlli dei permessi e del recupero. **Scansione e impostazioni** contiene le impostazioni di scoperta. La gestione rimane accessibile anche quando l'elaborazione è disabilitata.

Usa i plugin audio tramite **Effetto → Plugin audio**. I comandi Aggiungi/Modifica effetto video di Framescaper rimangono sotto **Effetto → Effetti video**.

Apri **Modifica → Preferenze → Impostazioni audio** per i dispositivi audio nativi e i controlli di assistenza. **Media** contiene le impostazioni multimediali native; **Effetti** collega al Gestore plugin e contiene l'interruttore di scoperta dei plugin. I permessi e il recupero della quarantena dei plugin richiedono ancora azioni esplicite.

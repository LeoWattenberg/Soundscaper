---
title: "Web o desktop"
description: "Comprendi come le edizioni del browser e del desktop impacchettate memorizzano i progetti e accedono ai file."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"it"} -->

Entrambe le edizioni elaborano i progetti localmente. La loro memorizzazione e l'accesso ai file differiscono.

## Editor web

L'edizione per browser memorizza progetti, registrazioni e media importati nella memoria locale del browser. Non carica un progetto su un account Soundscaper e non è richiesto alcun account.

Utilizza l'editor web quando desideri un accesso immediato senza installare un'app. Ricorda che la memorizzazione nel browser è soggetta a quote e regole di eliminazione del browser. La cancellazione dei dati del sito rimuove la libreria di progetti locale.

## Anteprima desktop

Le anteprime desktop pacchettizzate mantengono una libreria locale salvata automaticamente all'interno dell'applicazione desktop. Contengono l'ambiente di esecuzione dell'editor e le traduzioni rilasciate per l'editing offline.

I pacchetti desktop non sono firmati. macOS applica solo il sigillo ad-hoc senza identità che il suo caricatore richiede per eseguire Electron e i binari nativi; quel sigillo non effettua alcuna dichiarazione di editore o fiducia. Pertanto, Windows SmartScreen o macOS Gatekeeper possono visualizzare un avviso per sviluppatori sconosciuti per i pacchetti di anteprima e stabili.

L'apertura di un file `.aup4` importa un progetto indipendente nella libreria desktop. Le modifiche successive non riscrivono il file aperto. **Salva** aggiorna la copia della libreria; **Salva come** crea un nuovo file di interscambio Audacity.

## Telefoni e tablet

L'editor web mantiene il suo layout desktop su ogni schermo, ma al di sotto di 900px di larghezza (un telefono o un tablet tenuto in verticale) ripiega la barra degli strumenti in cassetti in modo che la timeline mantenga lo spazio:

- Il pulsante **Menu** in alto a sinistra apre un cassetto con il menu completo dell'applicazione, le schede del progetto, la barra delle azioni e la barra degli strumenti dei strumenti. Riproduzione, arresto, registrazione e ricerca rimangono nella barra. La scelta di un comando chiude il cassetto.
- Le intestazioni delle tracce scorrono sulle corsie dal gestore **Intestazioni tracce** nell'angolo in alto a sinistra della timeline o da **Visualizza › Intestazioni tracce**. Toccare le corsie o premere Esc le ripone nuovamente.
- L'introduzione sopra l'editor è collassata per impostazione predefinita su schermi stretti; **Mostra introduzione** la riporta.

**Modifica › Preferenze › Aspetto › Layout** consente di passare tra Automatico, Compatto e Desktop, in modo che una piccola finestra su un desktop possa mantenere la barra degli strumenti desktop e un tablet ampio possa optare per i cassetti.

## I progetti non si spostano automaticamente

Le librerie browser e desktop sono separate. Sposta un progetto deliberatamente:

- Utilizza un file di progetto Scape - `.sscape` da Soundscaper, `.fscape` da Framescaper - per l'intero progetto.
- Usa AUP4 quando hai specificamente bisogno di interscambio audio con Audacity.
- Esporta audio o video renderizzato come copia di riproduzione duratura.

Vedi [File di progetto](/projects-and-data/project-files/) prima di eliminare i dati del sito del browser o i dati dell'applicazione desktop.
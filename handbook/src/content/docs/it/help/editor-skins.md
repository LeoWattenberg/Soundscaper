---
title: "Skin dell'editor"
description: "Scegli una skin visiva o provane una temporaneamente tramite un URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"it"} -->

Le skin modificano i colori, i font, i bordi e gli sfondi decorativi dell'editor.
Sono disponibili in Soundscaper e Framescaper. Ogni prodotto memorizza la propria
taglia. Gli spazi di lavoro continuano a controllare la disposizione dei pannelli e degli strumenti.

## Scegli una skin {#choose-a-skin}

Apri **Modifica → Preferenze → Aspetto** e seleziona una skin:

- **Predefinita** mantiene il design originale dell'editor.
- **Sakura** combina fiori di ciliegio, accenti rosa e caratteri arrotondati.
- **Lilac** utilizza viola freddi e texture viola stratificate.
- **Techno** combina grafiche di circuiti blu con caratteri monospaziati.

Scegli **Chiaro**, **Scuro** o **Segui tema di sistema** separatamente. Ogni skin ha
tanto una versione chiara quanto una scura. Lo **Stile clip** rimane una scelta separata; la
paletta Colorful è coordinata con ogni skin mantenendo distinti i colori delle clip.

L'alto contrasto ha la priorità sulla decorazione della skin. Disattivando l'alto contrasto
si ripristina la skin selezionata. Il cambio di skin non modifica mai l'audio delle clip, il
del progetto o la disposizione dello spazio di lavoro.

## Prova una skin da un link {#try-a-skin-from-a-link}

Aggiungi `?useskin=sakura` a un URL dell'editor per anteprere temporaneamente Sakura. Usa
`default`, `sakura`, `lilac`, o `techno` come valore. Se l'URL ha già un
parametro di query, aggiungi `&useskin=sakura` invece. Un valore sconosciuto viene ignorato.

Un'anteprima tramite URL non sostituisce la skin salvata, anche se si modifica un'altra
preferenza. Il ricaricamento dell'URL di anteprima continua a mostrarla; la visita senza il
parametro utilizza la scelta salvata. Il parametro non seleziona chiaro o scuro.

In **Preferenze → Aspetto**, scegli **Mantieni questa skin** per salvare l'anteprima,
o **Termina anteprima** per tornare alla skin salvata. La selezione di qualsiasi skin salva
anche quella scelta e termina l'anteprima. Queste azioni rimuovono solo il parametro della skin
dall'URL corrente, senza ricaricare l'editor.

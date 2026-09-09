---
title: "Pulisci una registrazione vocale"
description: "Elimina il ronzio da una registrazione, riduci il rombo, porta il volume al livello dei podcast e esporta un MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"it"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

La maggior parte delle registrazioni fatte in casa necessitano delle stesse tre riparazioni: un rumore di fondo costante da rimuovere, un ronzio basso da filtrare e un livello da portare a uno standard. Questo tutorial esegue tutte e tre le operazioni su un esempio di tre secondi, la cui prima metà secondo è solo rumore ambientale, ed esporta il risultato come MP3.

:::tip[Cosa ti servirà]
- Scarica [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — una breve registrazione la cui prima metà secondo è rumore ambientale prima che inizi la voce.

Ogni passaggio qui sotto funziona su questi file esattamente come sono, quindi ciò che vedi dovrebbe corrispondere a ciò che dice il tutorial. Soundscaper funziona nel browser; non è necessario installare nulla.
:::

## Cosa imparerai

- Perché la Riduzione del rumore richiede un profilo e come crearlo.
- Cosa rimuove un filtro passa-alto e dove impostarlo per la voce.
- La differenza tra livello di picco e volume percepito, e come raggiungere un obiettivo di volume.
- Come esportare un MP3.

## Passaggi

1. Apri Soundscaper. Un nuovo progetto vuoto è pronto non appena viene caricato l'editor.
2. Scegli **File → Importa audio** e seleziona `guide-noisy-take.wav` — una breve registrazione la cui prima metà secondo è rumore ambientale prima che inizi la voce. Il file viene posizionato come clip sulla sua traccia.
3. Premi **Riproduci** per ascoltare, quindi **Ferma**.
   *Dovresti vedere:* Mezzo secondo di fruscio, seguito da un tono costante che rappresenta una voce, con il fruscio di sottofondo.
4. Trascina la riga di selezione sopra la clip, dall'inizio al 15% del totale, per selezionare solo il rumore iniziale. Il profilo deve contenere solo il rumore da rimuovere — nessuna voce.
5. Scegli **Effetto → Rimozione e riparazione rumore → Riduzione rumore** e premi **Ottieni profilo rumore**. La barra di stato indica che il profilo è pronto. Premi **Chiudi** per uscire dalla finestra di dialogo per ora.
6. Scegli **Seleziona → Seleziona tutto**. Il profilo viene mantenuto; ora l'effetto deve sapere cosa pulire.
7. Scegli **Effetto → Rimozione e riparazione rumore → Riduzione rumore**. Nella finestra di dialogo **Riduzione rumore**, imposta **Riduzione rumore** a `12`, quindi premi **Applica alla selezione**. Dodici decibel è un buon punto di partenza. Una quantità maggiore rimuove più rumore ma rende le voci cavernose.
   *Dovresti vedere:* L'introduzione è quasi piatta e il tono rimane inalterato.
8. Scegli **Effetto → Effetti legacy → Filtri classici**. Nella finestra di dialogo **Filtri classici**, seleziona **Passa-alto** come **Tipo di filtro** e imposta **Frequenza di taglio** a `100`, quindi premi **Applica alla selezione**. Tutto ciò che è al di sotto di 100 Hz — traffico, maneggiamento, aria condizionata — viene attenuato. La voce si trova ben al di sopra di questa frequenza.
9. Scegli **Effetto → Volume e compressione → Normalizzazione volume**. Nella finestra di dialogo **Normalizzazione volume**, imposta **Volume target** a `-16`, quindi premi **Applica alla selezione**. −16 LUFS è l'obiettivo comune per i podcast stereo. Il volume misurato indica quanto forte sembra l'intera registrazione, non quanto alti sono i picchi.
   *Dovresti vedere:* L'onda è più alta e la registrazione viene riprodotta a un livello confortevole.
10. Premi **Riproduci** per ascoltare, quindi **Ferma**.
   *Dovresti vedere:* Una registrazione pulita e uniforme con un'introduzione silenziosa.
11. Scegli **File → Esporta audio**, imposta **Formato** su **MP3** e premi **Esporta**. Il file viene scaricato non appena il rendering è completo e il suo link rimane nella finestra di dialogo. Il file viene codificato nel browser; nulla lascia il tuo computer.

## Passaggi successivi

- Applica queste tecniche alla tua registrazione utilizzando le guide pratiche: [Rimuovi il rumore di fondo](/guides/cleaning-up/remove-background-noise/), [Rimuovi il ronzio basso](/guides/cleaning-up/remove-low-rumble/) e [Normalizza il volume per un podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Controlla il risultato come farebbe una piattaforma: [Misura quanto è forte il tuo mix](/guides/analysis/measure-loudness/).

## Altri tutorial

[Il tuo primo progetto Soundscaper](/tutorials/your-first-project/) — Importa una registrazione, ascoltala, dividila, sfumala, esporta un file e salva il progetto.
[Metti la musica sotto una voce](/tutorials/put-music-under-a-voice/) — Sovrapponi due tracce, abbassa automaticamente una sotto l'altra, mixale e esportale.

## Riferimenti

- [Ogni parametro degli effetti utilizzati qui, con il suo valore predefinito e l'intervallo, si trova nel riferimento agli effetti audio.](/reference/generated/audio-effects/#parameters)
- [I formati di esportazione, i loro contenitori e i limiti di canale si trovano nel riferimento ai formati di esportazione.](/reference/generated/formats/)
- [Ogni comando del menu e la sua scorciatoia da tastiera si trova nel riferimento ai comandi e alle scorciatoie.](/reference/generated/commands/)

## Informazioni su questo tutorial

Questo tutorial viene riprodotto, passo dopo passo e su questi stessi file, contro ogni versione di Soundscaper nel browser suite (`tests/browser/soundscaper-tutorials.spec.js`). Se un passaggio smette di funzionare, la build fallisce fino a quando il tutorial non viene corretto, quindi ciò che leggi è ciò che fa l'editor.
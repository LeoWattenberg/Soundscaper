---
title: "Nettoyer un enregistrement audio"
description: "Éliminer le bourdonnement d'un enregistrement, réduire le grondement, le porter au niveau de volume des podcasts et exporter un MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"fr"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

La plupart des enregistrements faits à la maison nécessitent les trois mêmes réparations : un bruit de fond constant à éliminer, un grondement grave à filtrer et un niveau à augmenter jusqu'à une norme. Ce tutoriel effectue les trois sur un exemple de prise de trois secondes dont la première demi-seconde est uniquement du bruit ambiant, puis exporte le résultat au format MP3.

:::tip[Ce dont vous aurez besoin]
- Téléchargez [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — une courte prise dont la première demi-seconde est du bruit ambiant avant que la voix ne commence.

Chaque étape ci-dessous fonctionne sur ces fichiers exactement tels quels, donc ce que vous voyez devrait correspondre à ce que dit le tutoriel. Soundscaper fonctionne dans le navigateur ; aucune installation n'est nécessaire.
:::

## Ce que vous allez apprendre

- Pourquoi la Réduction du bruit nécessite un profil et comment le créer.
- Ce qu'un filtre passe-haut supprime et où le régler pour la parole.
- La différence entre le niveau de crête et la loudness, et comment atteindre une cible de loudness.
- Comment exporter un MP3.

## Étapes

1. Ouvrez Soundscaper. Un nouveau projet vide est prêt dès que l'éditeur se charge.
2. Choisissez **Fichier → Importer audio** et sélectionnez `guide-noisy-take.wav` — une courte prise dont la première demi-seconde est du bruit ambiant avant que la voix ne commence. Le fichier atterrit en tant que clip sur sa propre piste.
3. Appuyez sur **Lecture** pour écouter, puis sur **Arrêt**.
   *Vous devriez voir :* Une demi-seconde de souffle, puis un ton constant remplaçant une voix, avec le souffle en dessous.
4. Faites glisser la règle au-dessus du clip, du début à la marque des 15 %, pour sélectionner l'introduction de bruit uniquement. Le profil ne doit contenir que le bruit que vous souhaitez supprimer ; aucune voix du tout.
5. Choisissez **Effet → Réparation et suppression de bruit → Réduction du bruit** et appuyez sur **Obtenir le profil de bruit**. La ligne d'état indique que le profil est prêt. Appuyez sur **Fermer** pour quitter la boîte de dialogue pour l'instant.
6. Choisissez **Sélection → Tout sélectionner**. Le profil est conservé ; maintenant, l'effet doit savoir ce qu'il faut nettoyer.
7. Choisissez **Effet → Réparation et suppression de bruit → Réduction du bruit**. Dans la boîte de dialogue **Réduction du bruit**, définissez **Réduction du bruit** sur `12`, puis appuyez sur **Appliquer à la sélection**. Douze décibels sont un bon premier réglage. Plus vous en supprimez, plus le bruit est réduit, mais les voix sonnent creuses.
   *Vous devriez voir :* L'introduction est presque plate et le ton est inchangé.
8. Choisissez **Effet → Effets hérités → Filtres classiques**. Dans la boîte de dialogue **Filtres classiques**, choisissez **Passe-haut** pour **Type de filtre** et définissez **Fréquence de coupure** sur `100`, puis appuyez sur **Appliquer à la sélection**. Tout ce qui se trouve en dessous de 100 Hz — circulation, manipulation, climatisation — est atténué. La parole se situe bien au-dessus.
9. Choisissez **Effet → Volume et compression → Normalisation de la loudness**. Dans la boîte de dialogue **Normalisation de la loudness**, définissez **Loudness cible** sur `-16`, puis appuyez sur **Appliquer à la sélection**. −16 LUFS est la cible courante pour les podcasts stéréo. La loudness mesure à quel point l'ensemble de la prise semble forte, et non pas la hauteur de ses crêtes.
   *Vous devriez voir :* La forme d'onde est plus haute et la prise est jouée à un niveau confortable.
10. Appuyez sur **Lecture** pour écouter, puis sur **Arrêt**.
   *Vous devriez voir :* Une prise propre et plate avec une introduction silencieuse.
11. Choisissez **Fichier → Exporter audio**, définissez **Format** sur **MP3**, puis appuyez sur **Exporter**. Le fichier est téléchargé dès que le rendu est terminé, et son lien reste dans la boîte de dialogue. Le fichier est encodé dans le navigateur ; rien ne quitte votre ordinateur.

## Étapes suivantes

- Faites-le sur votre propre prise avec les guides pratiques : [Supprimer le bruit de fond](/guides/cleaning-up/remove-background-noise/), [Supprimer le grondement grave](/guides/cleaning-up/remove-low-rumble/) et [Normaliser la loudness pour un podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Vérifiez le résultat comme le ferait une plateforme : [Mesurer la loudness de votre mix](/guides/analysis/measure-loudness/).

## Autres tutoriels

[Votre premier projet Soundscaper](/tutorials/your-first-project/) — Importez un enregistrement, écoutez-le, divisez-le, estompez-le, exportez un fichier et enregistrez le projet.
[Mettre de la musique sous une voix](/tutorials/put-music-under-a-voice/) — Superposez deux pistes, faites passer l'une sous l'autre automatiquement, mélangez-les et exportez-les.

## Référence

- [Chaque paramètre des effets utilisés ici, avec sa valeur par défaut et sa plage, se trouve dans la référence des effets audio.](/reference/generated/audio-effects/#parameters)
- [Les formats d'exportation, leurs conteneurs et les limites de canaux sont dans la référence des formats d'exportation.](/reference/generated/formats/)
- [Chaque commande de menu et son raccourci clavier se trouve dans la référence des commandes et des raccourcis.](/reference/generated/commands/)

## À propos de ce tutoriel

Ce tutoriel est rejoué, étape par étape et sur ces fichiers très précis, contre chaque version de Soundscaper par la suite de navigateurs (`tests/browser/soundscaper-tutorials.spec.js`). Si une étape cesse de fonctionner, la version échoue jusqu'à ce que le tutoriel soit corrigé, donc ce que vous lisez est ce que fait l'éditeur.
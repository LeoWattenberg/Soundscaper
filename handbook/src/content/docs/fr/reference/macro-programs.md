---
title: "Programmes macro"
description: "L'API JavaScript sur laquelle s'exécute un programme macro, les limites dans lesquelles il s'exécute et le fichier dans lequel il circule."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"375c684211bdec9dbd3614c197bda423e24858a568ad5ae3c06ab06d7db2522f","targetLocale":"fr"} -->

Un programme macro est une macro écrite en JavaScript au lieu d'une liste d'étapes. 
Il s'exécute à l'intérieur de l'éditeur contre une petite API appelée `sound`, qui lui permet de lire 
le projet ouvert, de déplacer la sélection et d'appliquer les mêmes effets et commandes qu'une 
macro sous forme de liste d'étapes. Tout le reste, des fichiers au réseau en passant par vos 
autres projets, est hors de portée.

Les programmes sont une fonctionnalité de Soundscaper. Framescaper ne dispose pas de gestionnaire de macros.

## Où se trouvent les programmes

Sélectionnez **Outils → Gestionnaire de macros**. La boîte de dialogue répertorie les macros sous forme de liste d'étapes et, sous 
**Programmes**, les programmes que vous avez enregistrés. Appuyez sur **+ (Nouveau programme)** dans 
la section Programmes pour en créer un. La même barre d'outils propose **Importer programme**, 
**Exporter programme** et **Supprimer programme** pour le programme sélectionné. Le volet détaillé affiche son **Nom du programme**, le **Programme** texte, et un bouton **Exécuter le programme**. Le texte est enregistré au fur et à mesure que vous tapez ; il n'y a pas d'étape d'enregistrement distincte.

Un programme est stocké avec les paramètres de l'éditeur, et non à l'intérieur d'un projet, il est donc 
disponible dans chaque projet que vous ouvrez dans cet éditeur. Utilisez **Exporter programme** et 
**Importer programme** pour le transférer vers une autre machine ou une autre personne ; consultez 
[Partage de programmes](#sharing-programs) pour connaître les implications.

Le guide [Appliquer la même chaîne d'effets à chaque fois](/guides/effects/apply-the-same-effects-every-time/) 
aborde le côté liste d'étapes de la même boîte de dialogue.

## Écriture d'un programme

Un programme est le corps d'une fonction `async`, exécutée en mode strict. Cela signifie que vous 
pouvez `await` au niveau supérieur, déclarer des variables et des fonctions, et utiliser toutes 
les fonctionnalités ordinaires de la langue. L'objet `sound` est la seule connexion du programme 
à l'éditeur, et chaque appel à celui-ci retourne une promesse.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

L'onglet insère deux espaces dans le champ du programme. Appuyez sur Échap, puis sur Tab pour quitter
le champ.

### Ce qu'un programme peut utiliser

La bibliothèque standard JavaScript habituelle est présente : `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, les tableaux typés, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` et `queueMicrotask`. `console`
est également présent, et tout ce qui est écrit dedans se retrouve dans le journal du programme.

### Ce qu'un programme ne peut pas utiliser

Un programme s'exécute dans un worker dont les capacités ont été retirées avant la
première ligne. Aucune des suivantes n'existe à l'intérieur d'un programme : `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` et `setInterval`. La lecture de l'un d'entre eux donne `undefined`.

Un programme ne peut pas `import` un module; une importation statique `import` est une erreur de syntaxe sur la
ligne qui la contient. Tout ce dont le programme a besoin doit être dans le programme.

La limite de sécurité n'est pas les globaux manquants mais l'éditeur lui-même : il
répond uniquement aux appels répertoriés sur cette page et refuse tout le reste par nom,
quelconque le programme parvient à lui envoyer.

## Exécution d'un programme

Appuyez sur **Exécuter le programme**. Toute l'exécution est une entrée dans l'historique du projet, donc
un **Annuler** inverse tout ce que le programme a fait, quelles que soient les modifications apportées.
Si le programme génère une erreur, est annulé ou dépasse son délai, le projet est
rétabli exactement comme il était avant le début de l'exécution.

**Arrêter l'exécution** arrête un programme immédiatement. Un programme qui a été exécuté pendant deux
minutes est arrêté de la même manière, avec le message *La macro a fonctionné pendant plus de
120 secondes.*

Après l'exécution, le volet affiche le journal du programme, suivi de *Programme appliqué.*
lorsque l'exécution est terminée. Une exécution échouée affiche *Le programme a échoué à la ligne N:* et
le message d'erreur, où le numéro de ligne correspond à la ligne de votre programme qui
a généré une erreur.

### Quel audio une effet touche

Un effet appliqué par un programme s'exécute sur la sélection temporelle actuelle sur la
piste focalisée, qui est la piste dont vous avez dernierement cliqué sur l'en-tête ou dont vous avez
dernièrement sélectionné la séquence. Lorsqu'il n'y a pas de sélection temporelle mais qu'une séquence est sélectionnée, l'effet couvre cette séquence. Les appels de sélection d'un programme changent la plage temporelle et
le jeu de pistes sélectionnées, mais pas la piste en cours, donc une exécution traite
une piste à la fois. Si rien n'est focalisé ou si la sélection est vide, l'exécution échoue avec
le même message que celui du menu Effet.

## L'API `sound`

Chaque méthode ci-dessous retourne une promesse, sauf indication contraire. Attendez chaque appel
avant de passer au suivant ; un programme qui démarre plus de huit appels sans
les attendre voit le neuvième refusé.

### `sound.env`

Un objet simple décrivant l'exécution.

| Champ | Signification |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | La langue d'interface de l'éditeur, comme `"en"` ou `"de"`. |
| `seed` | La graine des nombres aléatoires de l'exécution. Nouvelle pour chaque exécution. |
| `startedAt` | L'heure murale du début de l'exécution, sous forme de chaîne ISO 8601. |
| `dryRun` | Toujours `false` pour le moment. Réservé. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` et `sound.log.debug(...values)` écrivent une ligne
chacune dans le journal de l'exécution. `console.log`, `console.info`, `console.warn`,
`console.error` et `console.debug` font de même. Les valeurs qui ne sont pas des chaînes sont
écrites sous forme de JSON. Ces méthodes ne retournent rien et n'ont pas besoin d'être attendues.

Un journal contient au plus 1 000 lignes ou 256 Ko, selon ce qui vient en premier, et chaque ligne
est coupée à 4 096 caractères. Les lignes au-delà sont supprimées et comptabilisées ; le décompte
est signalé comme un avertissement final.

### `sound.project`

La lecture du projet ne le modifie pas et ne compte pas dans le budget de modification de l'exécution.

`sound.project.snapshot()` retourne `{ sampleRate, tracks, selection }`, avec
`tracks` et `selection` comme les deux appels ci-dessous les retournent. `sampleRate` est
taux d'échantillonnage du projet en hertz, qui est ce à quoi chaque nombre de trames sur cette page est
mesuré.

`sound.project.tracks()` retourne un tableau de pistes dans l'ordre chronologique :

```json
{ "id": "track-…", "name": "Voice", "kind": "audio", "index": 0, "muted": false, "solo": false }
```

`sound.project.clips(trackId)` renvoie les clips sur une piste, ou sur toutes les pistes
lorsque `trackId` est omis :

```json
{ "id": "clip-…", "name": "Take 1", "startFrame": 0, "durationFrames": 480000 }
```

`sound.project.selection()` renvoie la sélection actuelle :

```json
{ "startFrame": 0, "endFrame": 96000, "trackIds": ["track-…"] }
```

### `sound.select`

Chaque appel de sélection compte comme un changement et retourne la sélection qu'il a produite, dans le format `sound.project.selection()`.

`sound.select.time(start, end, options)` définit la plage horaire en secondes. C'est la commande `SelectTime` d'Audacity, et `options.relativeTo` choisit à partir de quel bord chaque bord est mesuré. Les deux bords peuvent être aussi bas que -100 secondes.

| `relativeTo` | Bord de début | Bord de fin |
| --- | --- | --- |
| `'project-start'` (par défaut) | `start` secondes à partir du début du projet | `end` secondes à partir du début du projet |
| `'project'` | `start` secondes à partir du début du projet | `end` secondes après la fin du projet |
| `'project-end'` | `start` secondes avant la fin du projet | `end` secondes avant la fin du projet |
| `'selection-start'` | `start` secondes après le début de la sélection | `end` secondes après le début de la sélection |
| `'selection'` | `start` secondes après le début de la sélection | `end` secondes après la fin de la sélection |
| `'selection-end'` | `start` secondes avant la fin de la sélection | `end` secondes avant la fin de la sélection |

La fin du projet est la dernière trame atteinte par n'importe quel clip. Les pistes sélectionnées restent telles qu'elles.

`sound.select.frames(startFrame, endFrame, options)` définit la plage horaire en trames au taux d'échantillonnage du projet. `options.trackIds` désigne les pistes à sélectionner ; lorsqu'il est omis, les pistes déjà sélectionnées restent sélectionnées. La plage est limitée à la chronologie et les bords sont échangés si inversés.

`sound.select.tracks(options)` est la commande `SelectTracks` d'Audacity. Elle sélectionne les pistes dont l'index (compté à partir de 0) se trouve dans la plage allant de `options.track` (par défaut 0) sur `options.trackCount` pistes (par défaut 1). `options.mode` est `'set'` pour remplacer la sélection de pistes, `'add'` pour l'élargir, ou `'remove'` pour en retirer ces pistes. La plage horaire reste telle qu'elle.

`sound.select.frequencies(options)` est la commande `SelectFrequencies` d'Audacity. Elle définit la sélection spectrale à `options.low` et `options.high` en hertz ; un bord que vous omettez conserve sa valeur actuelle.

`sound.select.all()` sélectionne l'ensemble du projet sur chaque piste.
`sound.select.none()` efface la sélection.

### `sound.effect(type, params)`

Applique un effet sur la sélection actuelle, sur la piste focalisée. `type` est un ID d'effet provenant de [Effets qu'un programme peut appliquer](#effects-a-program-can-apply), et `params` est un objet des paramètres de cet effet. Les paramètres que vous omettez prennent les valeurs par défaut de l'effet ; les valeurs sont vérifiées par rapport aux plages dans la [référence des effets audio](/reference/generated/audio-effects/). Se résout en `null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Applique une chaîne d'effets sur la sélection actuelle en une seule passe, exactement comme une macro de liste d'étapes avec ces étapes. Chaque étape est `{ type, params }`, et la chaîne doit comporter au moins une étape. Se résout en `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Exécute l'une des commandes de macro Audacity répertoriées sous
[Commandes qu'un programme peut exécuter](#commands-a-program-can-run). Les quatre commandes de sélection
prennent les paramètres décrits là-bas ; les autres n'en prennent aucun. La sélection est résolue ensuite.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Exécute une macro de liste d'étapes enregistrée dans le même gestionnaire de macros, par son nom exact,
 y compris toutes les commandes de sélection qu'elle contient. Une macro enregistrée ne peut pas être elle-même un programme, donc les programmes ne s'imbriquent pas. Se résout en `null`; un nom inconnu est rejeté.

### Temps et aléatoire

Une exécution est reproductible : deux exécutions du même programme sur le même projet lisent
les mêmes données, car l'horloge et les nombres aléatoires ne sont pas ceux de la machine.

`Date.now()` et `new Date()` sans argument retournent une horloge virtuelle qui
démarre à 0 et avance d'une unité pour chaque appel au rédacteur, et de `ms` pour chaque `sound.wait(ms)`. `sound.wait` se résout immédiatement ; il n'y a aucun
 moyen pour un programme de faire une pause en temps réel, et cela n'est pas nécessaire, car chaque appel
 au rédacteur est terminé avant que sa promesse ne se résolve.

`Math.random()` et `sound.random()` sont le même générateur, initialisé à partir de
`sound.env.seed`. Enregistrez la graine si vous devez savoir quelle séquence une exécution a utilisée.

### Vérification de vos hypothèses

`sound.assert(condition, message)` lève une exception `message` lorsque `condition` est faux.
`sound.assertEqual(actual, expected, message)` compare les deux valeurs en tant que JSON
et lève une exception lorsqu'elles diffèrent, avec un message qui nomme les deux valeurs si vous n'en fournissez aucune. Comme une erreur levée met fin à l'exécution et annule tout ce qui la précède, une affirmation échouée laisse le projet inchangé. Aucune des deux méthodes ne retourne une promesse.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Valeurs transmises à l'éditeur

Chaque argument qu'un programme passe et chaque valeur qu'il reçoit est une donnée simple :
`null`, booléens, nombres finis, chaînes de caractères, tableaux et objets simples
de ces types. `NaN`, `Infinity`, fonctions, instances de classes, tableaux typés et `Date`
objets sont refusés avec une erreur, tout comme toute valeur supérieure à 1 MiB, imbriquée à plus de
12 niveaux de profondeur, ou contenant plus de 4 096 entrées dans un tableau ou un objet. Les
propriétés `undefined` sont ignorées.

## Limites

| Limite | Valeur |
| --- | --- |
| Longueur du programme | 256 Ko |
| Appels à l'éditeur par exécution | 4 096 |
| Modifications du projet par exécution (appels de sélection, effets, commandes) | 256 |
| Appels en attente d'une réponse simultanée | 8 |
| Temps d'exécution | 120 secondes |
| Une valeur transmise à l'éditeur ou en provenance de celui-ci | 1 MiB, 12 niveaux de profondeur, 4 096 entrées par tableau ou objet |
| Journal | 1 000 lignes ou 256 Ko ; 4 096 caractères par ligne |
| Programmes dans la bibliothèque | 128 |
| Nom du programme | 256 caractères |
| Fichier de programme importé | 1 MiB |

Une boucle qui sélectionne chaque clip et applique un effet utilise deux modifications par
clip, elle peut donc couvrir 128 clips avant que le budget ne soit épuisé.

## Erreurs

Un appel que l'éditeur refuse rejette sa promesse avec un `Error` dont la propriété `message`
explique la raison : une commande en dehors du vocabulaire, un effet sur une sélection vide,
un paramètre hors limite. L'erreur contient également un `code`, qui est
`MACRO_CALL_FAILED` à moins que l'éditeur n'ait fourni une raison plus spécifique. Un programme
pourrait attraper ces erreurs et continuer :

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Ce programme se termine et son journal indique *refusé : commande macro non prise en charge :
ExportWav.*

Une erreur que le programme ne capture pas met fin à l'exécution, annule le projet et est
affichée dans le volet avec la ligne d'où elle provient. Un programme qui ne peut pas être compilé
est signalé de la même manière avant que quoi que ce soit ne s'exécute.

## Effets qu'un programme peut appliquer {#effects-a-program-can-apply}

Voici les ID d'effets `sound.effect` et `sound.effects` acceptés, ainsi que
les clés de paramètres et leurs valeurs par défaut pour chacun. Les plages et les unités sont disponibles dans la
[référence des effets audio](/reference/generated/audio-effects/). Les plug-ins Nyquist ne peuvent pas être appliqués à partir d'un programme.

| Effet | ID d'effet | Paramètres et valeurs par défaut |
| --- | --- | --- |
| Amplifier | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Auto Duck | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Graves et aigus | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Changer la hauteur | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Changer la vitesse et la hauteur | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Changer le tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Filtres classiques | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Suppression des clics | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compresseur | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Délai | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distorsion | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Écho | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fondre in | `audacity-fade-in` | aucun |
| Fondre out | `audacity-fade-out` | aucun |
| Égalisation courbe | `audacity-filter-curve-eq` | `points` : un tableau de `{ frequency, gain }`, par défaut deux points plats à 20 Hz et 20 kHz ; `linearFrequencyScale: false` ; `filterLength: 8191` |
| Égalisation paramétrique 4 bandes | `eq` | `outputGain: 0` ; `bands` : quatre objets `{ id, enabled, type, frequency, gain, q, slope }`, en pointe à 100, 500, 2000 et 8000 Hz avec `gain: 0`, `q: 1`, `slope: 12` |
| Porte | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Égalisation graphique | `audacity-graphic-eq` | `gains` : 31 gains de bande en dB, tous à 0 ; `interpolation: 'bspline'` ; `filterLength: 8191` |
| Filtre passe-haut | `highpass` | `frequency: 80`, `q: 0.707` |
| Inverser | `audacity-invert` | aucun |
| Compresseur hérité | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiteur | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalisation de la sonorité | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filtre passe-bas | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Réduction du bruit | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normaliser | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Supprimer l'offset DC | `audacity-remove-dc-offset` | aucun |
| Réparer | `audacity-repair` | aucun |
| Répéter | `audacity-repeat` | `count: 1` |
| Réverbération | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Réverbération (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Inverser | `audacity-reverse` | aucun |
| Étirement glissant | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Tronquer le silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Gain d'utilité (révisé) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Deux effets nécessitent quelque chose qu'un programme ne peut pas fournir. La réduction du bruit nécessite un profil de bruit capturé dans le dialogue lui-même de l'effet, et l'Auto Duck a besoin d'une piste de contrôle en dessous de la piste ciblée.

## Commandes qu'un programme peut exécuter {#commands-a-program-can-run}

`sound.command` accepte les noms de commandes macro Audacity ci-dessous. Ce sont les mêmes noms qu'une macro de liste d'étapes peut contenir, donc un programme et une liste d'étapes ont exactement la même portée. Chaque commande exécute l'action d'édition que la [référence des commandes](/reference/generated/commands/) décrit.

### Commandes de sélection avec paramètres

| Commande | Paramètres |
| --- | --- |
| `SelectTime` | `start`, `end` en secondes; `relativeTo` comme pour `sound.select.time` |
| `SelectFrequencies` | `low`, `high` en hertz |
| `SelectTracks` | `track`, `trackCount` (0 à 100); `mode` de `'set'`, `'add'` ou `'remove'` |
| `Select` | N'importe quelle combinaison des trois ensembles ci-dessus |

Un paramètre que vous omettez laisse cette partie de la sélection inchangée, ce qui est également la façon dont Audacity les lit.

### Commandes sans paramètres

| Groupe | Commandes |
| --- | --- |
| Sélection | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Édition | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Pistes | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Étiquettes | `AddLabel` |
| Analyse | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Ce qui manque délibérément

`Undo` et `Redo` sont absents car une exécution est déjà une entrée d'historique et une étape qui parcourt l'historique dépasserait l'exécution dans vos propres modifications. Les commandes de transport et d'enregistrement sont absentes car un programme n'a rien à attendre et ne peut pas être annulé hors d'un enregistrement. L'ouverture, l'enregistrement, la fermeture, l'importation, l'exportation et les préférences sont absentes car la portée d'un programme est le seul projet ouvert lors de son démarrage. Les commandes qui n'ouvrent qu'une boîte de dialogue ou modifient la vue sont absentes car elles ne modifient rien dans le projet.

## Partage de programmes {#sharing-programs}

**Exporter le programme** écrit le programme sélectionné dans un fichier `.soundscapemacro`, et **Importer le programme** en lit un. Le fichier est en JSON plutôt qu'un simple fichier `.js`, donc rien sur l'ordinateur destinataire ne le confondra avec quelque chose à exécuter en dehors de l'éditeur:

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

L'importation conserve le texte et rien de plus. Un programme importé n'a pas de bouton **Exécuter le programme** ; à la place, la fenêtre affiche le programme, le fichier d'origine, une note sur ce que le programme peut faire au projet ouvert, et une case à cocher indiquant *J'ai lu ce programme et souhaite l'exécuter*. Cocher cette case active **Activer ce programme**, et seulement ensuite le programme peut s'exécuter.

Cette autorisation est valable pour le texte exact que vous avez lu. Si le programme change par la suite, que ce soit par édition ou par importation d'une nouvelle copie, la revue réapparaît jusqu'à ce que vous activiez le nouveau texte. Les programmes que vous écrivez vous-même dans le gestionnaire n'ont pas besoin d'être révisés.

## Exemples

Estomper chaque clip sur la première piste qui en contient. Cliquez sur l'en-tête de cette piste avant d'exécuter le programme, de sorte que l'effet s'applique à la piste que le programme est en train de lire :

```js
let target = null;
let clips = [];
for (const track of await sound.project.tracks()) {
  clips = await sound.project.clips(track.id);
  if (clips.length) {
    target = track;
    break;
  }
}
sound.assert(target, 'There are no clips to fade.');
for (const clip of clips) {
  await sound.select.frames(clip.startFrame, clip.startFrame + clip.durationFrames, {
    trackIds: [target.id],
  });
  await sound.effect('audacity-fade-in');
  sound.log.info(`Faded in ${clip.name} on ${target.name}`);
}
```

Signaler le projet sans le modifier :

```js
const { sampleRate, tracks } = await sound.project.snapshot();
for (const track of tracks) {
  const clips = await sound.project.clips(track.id);
  const frames = clips.reduce((total, clip) => total + clip.durationFrames, 0);
  sound.log.info(`${track.name}: ${clips.length} clip(s), ${(frames / sampleRate).toFixed(1)} s of audio`);
}
```

Exécutez une macro de liste d'étapes sauvegardée uniquement lorsque la sélection est suffisamment longue :

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## À propos de cette page

Chaque programme sur cette page, des extraits de code d'une ligne aux exemples travaillés,
est exécuté contre chaque version de Soundscaper par la suite de navigateurs
(`tests/browser/handbook-macro-program-examples.spec.js`), qui lit
les programmes à partir du texte de cette propre page. Un programme qui cesse de s'exécuter ou qui ne
produit plus ce que cette page indique qu'il produit, échoue la version jusqu'à ce que la page ou l'
editeur soit corrigé.

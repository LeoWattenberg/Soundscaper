---
title: "Programmes de macros"
description: "L'API JavaScript sur laquelle un programme de macros s'exécute, les limites dans lesquelles il fonctionne et le fichier dans lequel il est transmis."
sidebar:
  order: 7
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfeb48e77dc0013cc1f43bd584ae92a7196983e349631c0b75bfbca2ba0c542a","targetLocale":"fr"} -->

Un programme de macro est une macro écrite en JavaScript plutôt que sous forme de liste d'étapes.
Il s'exécute dans l'éditeur via une petite API appelée `sound`, qui lui permet de lire
le projet ouvert, de déplacer la sélection et d'appliquer les mêmes effets et commandes qu'une
macro en liste d'étapes. Tout le reste, des fichiers et du réseau à vos
autres projets, est hors de sa portée.

Les programmes sont une fonctionnalité de Soundscaper. Framescaper ne dispose pas de gestionnaire de macros.

## Où se trouvent les programmes

Choisissez **Outils → Gestionnaire de macros**. La boîte de dialogue répertorie les macros en liste d'étapes et, sous
**Programmes**, les programmes que vous avez enregistrés. **Nouveau programme** en crée un, et le
panneau de détails affiche son **Nom du programme**, le texte du **Programme** et un bouton **Exécuter le
programme**. Le texte est enregistré à mesure que vous tapez ; il n'y a pas d'étape d'enregistrement séparée.

Un programme est stocké avec les paramètres de l'éditeur, et non dans un projet, il est donc
disponible dans tous les projets que vous ouvrez dans cet éditeur. Utilisez **Exporter le programme** et
**Importer le programme** pour le transférer sur une autre machine ou à une autre personne ; voir
[Partage de programmes](#sharing-programs) pour en savoir plus sur ce que cela implique.

Le guide [Appliquer la même chaîne d'effets à chaque fois](/guides/effects/apply-the-same-effects-every-time/)
aborde le côté liste d'étapes de la même boîte de dialogue.

## Rédaction d'un programme

Un programme est le corps d'une fonction `async`, exécuté en mode strict. Cela signifie que vous
pouvez `await` au niveau supérieur, déclarer des variables et des fonctions, et utiliser toutes les
fonctionnalités ordinaires du langage. L'objet `sound` est la seule connexion du programme à
l'éditeur, et chaque appel sur celui-ci renvoie une promesse.

```js
// Normalize everything, then fade the last two seconds.
await sound.select.all();
await sound.effect('audacity-normalize', { peakDb: -1 });
await sound.select.time(2, 0, { relativeTo: 'selection-end' });
await sound.effect('audacity-fade-out');
```

Tab insère deux espaces dans le champ programme. Appuyez sur Échap puis sur Tab pour quitter le champ.

### Ce qu'un programme peut utiliser

La bibliothèque standard JavaScript habituelle est présente : `Object`, `Array`, `Map`,
`Set`, `Math`, `JSON`, `RegExp`, `Promise`, les tableaux typés, `Intl`,
`TextEncoder`, `TextDecoder`, `structuredClone` et `queueMicrotask`. `console`
est également présent, et tout ce qui y est écrit apparaît dans le journal du programme.

### Ce qu'un programme ne peut pas utiliser

Un programme s'exécute dans un worker dont les capacités ont été retirées avant l'exécution de la première ligne. Aucun des éléments suivants n'existe à l'intérieur d'un programme : `fetch`,
`XMLHttpRequest`, `WebSocket`, `indexedDB`, `caches`, `crypto`, `navigator`,
`location`, `Worker`, `WebAssembly`, `SharedArrayBuffer`, `Atomics`, `eval`,
`setTimeout` et `setInterval`. La lecture de l'un d'entre eux renvoie `undefined`.

Un programme ne peut pas `import` un module ; un `import` statique est une erreur de syntaxe sur la
ligne qui le contient. Tout ce dont le programme a besoin doit être inclus dans le programme.

La frontière de sécurité n'est pas constituée des globales manquantes, mais de l'éditeur lui-même : il
ne répond qu'aux appels répertoriés sur cette page et refuse tout le reste par nom,
peu importe ce qu'un programme parvient à lui envoyer.

## Exécution d'un programme

Appuyez sur **Exécuter le programme**. L'exécution complète constitue une seule entrée dans l'historique du projet, de sorte
qu'un seul **Annuler** inverse tout ce que le programme a fait, quel que soit le nombre de modifications apportées.
Si le programme lève une exception, est annulé ou dépasse son délai d'exécution, le projet est
restauré exactement dans l'état qui prévalait avant le début de l'exécution.

**Annuler l'exécution** arrête immédiatement un programme. Un programme qui s'est exécuté pendant deux
minutes est arrêté de la même manière, avec le message *La macro s'est exécutée pendant plus de
120 secondes.*

Après l'exécution, le volet affiche le journal du programme, suivi de *Programme appliqué.*
lorsque l'exécution est terminée. Une exécution échouée affiche *Le programme a échoué à la ligne N :*
et le message d'erreur, où le numéro de ligne correspond à la ligne de votre programme qui a
levé l'exception.

### Quel audio une effet touche

Un effet appliqué par un programme s'exécute sur la sélection temporelle actuelle de la
piste focalisée, c'est-à-dire la piste dont l'en-tête a été cliqué en dernier ou dont le clip
a été sélectionné en dernier. S'il n'y a pas de sélection temporelle mais qu'un clip est sélectionné, l'
effet couvre ce clip. Les appels de sélection d'un programme modifient la plage temporelle et
l'ensemble des pistes sélectionnées, mais pas la piste focalisée, de sorte qu'une exécution traite
une seule piste. Si rien n'est focalisé ou si la sélection est vide, l'exécution échoue avec
le même message que celui fourni par le menu Effet.

## L'API `sound`

Chaque méthode ci-dessous renvoie une promesse, sauf indication contraire. Attendez chaque appel
avant d'effectuer le suivant ; un programme qui lance plus de huit appels sans les attendre voit le neuvième refusé.

### `sound.env`

Un objet simple décrivant l'exécution.

| Champ | Signification |
| --- | --- |
| `productId` | `"soundscaper"`. |
| `locale` | La langue de l'interface de l'éditeur, par exemple `"en"` ou `"de"`. |
| `seed` | La graine à partir de laquelle les nombres aléatoires de l'exécution sont générés. Nouvelle à chaque exécution. |
| `startedAt` | L'heure réelle du début de l'exécution, sous forme de chaîne ISO 8601. |
| `dryRun` | Toujours `false` pour le moment. Réservé. |

### `sound.log`

`sound.log.info(...values)`, `sound.log.warn(...values)`,
`sound.log.error(...values)` et `sound.log.debug(...values)` écrivent chacun une ligne
dans le journal de l'exécution. `console.log`, `console.info`, `console.warn`,
`console.error` et `console.debug` font de même. Les valeurs qui ne sont pas des chaînes sont
écrites en JSON. Ces méthodes ne renvoient rien et n'ont pas besoin d'être attendues.

Un journal contient au maximum 1 000 lignes ou 256 Ko, selon ce qui survient en premier, et chaque ligne
est tronquée à 4 096 caractères. Les lignes au-delà de cette limite sont supprimées et comptées ; le nombre
est signalé sous forme d'un avertissement final.

### `sound.project`

La lecture du projet ne le modifie jamais et ne compte pas dans le budget de modifications de l'exécution.

`sound.project.snapshot()` renvoie `{ sampleRate, tracks, selection }`, avec
`tracks` et `selection` tels que les deux appels ci-dessous les renvoient. `sampleRate` est le
taux d'échantillonnage du projet en hertz, ce qui est l'unité dans laquelle tous les nombres de trames sur cette page sont
mesurés.

`sound.project.tracks()` renvoie un tableau de pistes dans l'ordre de la chronologie :

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

Chaque appel de sélection compte comme une modification et renvoie la sélection produite,
dans le format renvoyé par `sound.project.selection()`.

`sound.select.time(start, end, options)` définit la plage temporelle en secondes. C'est
la commande `SelectTime` d'Audacity, et `options.relativeTo` choisit le point de référence à partir duquel chaque
bord est mesuré. Les deux bords peuvent descendre jusqu'à -100 secondes.

| `relativeTo` | Bord de début | Bord de fin |
| --- | --- | --- |
| `'project-start'` (par défaut) | `start` secondes depuis le début du projet | `end` secondes depuis le début du projet |
| `'project'` | `start` secondes depuis le début du projet | `end` secondes après la fin du projet |
| `'project-end'` | `start` secondes avant la fin du projet | `end` secondes avant la fin du projet |
| `'selection-start'` | `start` secondes après le début de la sélection | `end` secondes après le début de la sélection |
| `'selection'` | `start` secondes après le début de la sélection | `end` secondes après la fin de la sélection |
| `'selection-end'` | `start` secondes avant la fin de la sélection | `end` secondes avant la fin de la sélection |

La fin du projet est la dernière image atteinte par n'importe quel clip. Les pistes sélectionnées restent
inchangées.

`sound.select.frames(startFrame, endFrame, options)` définit la plage temporelle en
images au taux d'échantillonnage du projet. `options.trackIds` nomme les pistes à
sélectionner ; lorsqu'il est omis, les pistes déjà sélectionnées restent sélectionnées.
La plage est limitée à la chronologie et les bords sont inversés si l'ordre est inversé.

`sound.select.tracks(options)` est la commande `SelectTracks` d'Audacity. Elle sélectionne
les pistes dont l'index (compté à partir de 0) est dans la plage allant de `options.track`
(par défaut 0) couvrant `options.trackCount` pistes (par défaut 1). `options.mode` est
`'set'` pour remplacer la sélection de pistes, `'add'` pour l'élargir, ou `'remove'` pour
retirer ces pistes de la sélection. La plage temporelle reste inchangée.

`sound.select.frequencies(options)` est la commande `SelectFrequencies` d'Audacity.
Elle définit la sélection spectrale à `options.low` et `options.high` en hertz ;
un bord omis conserve sa valeur actuelle.

`sound.select.all()` sélectionne l'intégralité du projet sur chaque piste.
`sound.select.none()` efface la sélection.

### `sound.effect(type, params)`

Applique un effet sur la sélection actuelle, sur la piste active. `type` est
un identifiant d'effet issu de [Effets qu'un programme peut appliquer](#effects-a-program-can-apply),
et `params` est un objet contenant les paramètres de cet effet. Les paramètres omis prennent
les valeurs par défaut de l'effet ; les valeurs sont vérifiées par rapport aux plages définies dans la
[référence des effets audio](/reference/generated/audio-effects/). Résout en
`null`.

```js
await sound.effect('audacity-amplify', { gainDb: -3 });
```

### `sound.effects(steps)`

Applique une chaîne d'effets sur la sélection actuelle en une seule passe, exactement comme une macro de liste d'étapes avec ces étapes le ferait. Chaque étape est `{ type, params }`, et la chaîne nécessite au moins une étape. Résout en `null`.

```js
await sound.effects([
  { type: 'audacity-remove-dc-offset' },
  { type: 'audacity-normalize', params: { peakDb: -3 } },
  { type: 'audacity-legacy-compressor', params: { thresholdDb: -18, ratio: 3 } },
]);
```

### `sound.command(name, params)`

Exécute l'une des commandes de macro d'Audacity répertoriées sous
[Commandes qu'un programme peut exécuter](#commands-a-program-can-run). Les quatre commandes de sélection prennent les paramètres décrits à cet endroit ; les autres n'en prennent aucun. Résout à la sélection par la suite.

```js
await sound.command('SelectTime', { start: 0, end: 5 });
await sound.command('Trim');
```

### `sound.runSaved(name)`

Exécute une macro de liste d'étapes enregistrée dans le même gestionnaire de macros, par son nom exact,
y compris toutes les commandes de sélection qu'elle contient. Une macro enregistrée ne peut pas être un
programme, donc les programmes ne sont pas imbriqués. Résout en `null` ; un nom inconnu est rejeté.

### Temps et aléatoire

Une exécution est reproductible : deux exécutions du même programme sur le même projet lisent
les mêmes données, car l'horloge et les nombres aléatoires ne sont pas ceux de la machine.

`Date.now()` et `new Date()` sans arguments renvoient une horloge virtuelle qui
démarre à 0 et avance d'une unité pour chaque appel répondu à l'éditeur, et de
`ms` pour chaque `sound.wait(ms)`. `sound.wait` se résout immédiatement ; il n'y a
pas de moyen pour un programme de se mettre en pause pour un temps réel, et ce n'est pas nécessaire, car chaque appel
à l'éditeur se termine avant que sa promesse ne se résolve.

`Math.random()` et `sound.random()` sont le même générateur, initialisé à partir de
`sound.env.seed`. Enregistrez la graine si vous avez besoin de savoir quelle séquence une exécution a utilisée.

### Vérification de vos hypothèses

`sound.assert(condition, message)` lève `message` lorsque `condition` est faux.
`sound.assertEqual(actual, expected, message)` compare les deux valeurs en tant que JSON
et lève une exception lorsqu'elles diffèrent, avec un message qui nomme les deux valeurs si vous n'en
fournissez aucune. Comme une erreur levée met fin à l'exécution et annule tout ce qui l'a précédée, une
assertion échouée laisse le projet intact. Aucune des deux méthodes ne renvoie une promesse.

```js
const tracks = await sound.project.tracks();
sound.assert(tracks.length > 0, 'Import a recording first.');
await sound.command('SelectAll');
const selection = await sound.project.selection();
sound.assertEqual(selection.trackIds.length, tracks.length, 'Select all should cover every track.');
```

## Valeurs transmises à l'éditeur

Chaque argument transmis par un programme et chaque valeur qu'il reçoit sont des données simples :
`null`, booléens, nombres finis, chaînes de caractères, ainsi que des tableaux et des objets simples composés de
ces éléments. `NaN`, `Infinity`, fonctions, instances de classes, tableaux typés et `Date`
objets sont refusés avec une erreur, de même que toute valeur supérieure à 1 Mio, imbriquée à plus de
12 niveaux de profondeur, ou contenant plus de 4 096 entrées dans un tableau ou un objet.
Les propriétés `undefined` sont supprimées.

## Limites

| Limite | Valeur |
| --- | --- |
| Longueur du programme | 256 Kio |
| Appels à l'éditeur par exécution | 4 096 |
| Modifications du projet par exécution (appels de sélection, effets, commandes) | 256 |
| Appels en attente de réponse simultanés | 8 |
| Temps d'exécution | 120 secondes |
| Une valeur transmise à ou depuis l'éditeur | 1 Mio, 12 niveaux de profondeur, 4 096 entrées par tableau ou objet |
| Journal | 1 000 lignes ou 256 Kio ; 4 096 caractères par ligne |
| Programmes dans la bibliothèque | 128 |
| Nom du programme | 256 caractères |
| Fichier de programme importé | 1 Mio |

Une boucle qui sélectionne chaque clip et applique un effet consomme deux modifications par
clip, elle peut donc couvrir 128 clips avant l'épuisement du budget.

## Erreurs

Un appel refusé par l'éditeur rejette sa promesse avec un `Error` dont le `message`
indique la raison : une commande hors du vocabulaire, un effet sur une sélection vide,
un paramètre hors plage. L'erreur contient également un `code`, qui est
`MACRO_CALL_FAILED` sauf si l'éditeur en fournit un plus spécifique. Un programme
peut les intercepter et continuer :

```js
try {
  await sound.command('ExportWav');
} catch (error) {
  sound.log.warn(`refused: ${error.message}`);
}
```

Ce programme s'achève, et son journal indique *refused: Unsupported macro command:
ExportWav.*

Une erreur que le programme ne capture pas met fin à l'exécution, annule les modifications du projet et est affichée dans le panneau avec la ligne d'origine. Un programme qui ne peut pas être compilé est signalé de la même manière avant toute exécution.

## Effets qu'un programme peut appliquer {#effects-a-program-can-apply}

Voici les identifiants d'effets acceptés par `sound.effect` et `sound.effects`, avec les clés de paramètres que chacun accepte et leurs valeurs par défaut. Les plages et les unités sont dans la
[référence des effets audio](/reference/generated/audio-effects/). Les plug-ins Nyquist ne peuvent pas être appliqués depuis un programme.

| Effet | Identifiant d'effet | Paramètres et valeurs par défaut |
| --- | --- | --- |
| Amplifier | `audacity-amplify` | `gainDb: 0`, `allowClipping: false` |
| Atténuation automatique | `audacity-auto-duck` | `duckAmountDb: -12`, `innerFadeDown: 0`, `innerFadeUp: 0`, `outerFadeDown: 0.5`, `outerFadeUp: 0.5`, `thresholdDb: -30`, `maximumPause: 1` |
| Basses et aigus | `audacity-bass-treble` | `bassDb: 0`, `trebleDb: 0`, `volumeDb: 0` |
| Bitcrusher | `bitcrusher` | `bitDepth: 8`, `downsampling: 1`, `dither: 'none'`, `interpolation: 'sample-hold'`, `mix: 100` |
| Modifier la hauteur | `audacity-change-pitch` | `semitones: 0`, `preserveFormants: true` |
| Modifier la vitesse et la hauteur | `audacity-change-speed-pitch` | `speedPercent: 0` |
| Modifier le tempo | `audacity-change-tempo` | `tempoPercent: 0` |
| Filtres classiques | `audacity-classic-filters` | `family: 'butterworth'`, `direction: 'lowpass'`, `order: 1`, `cutoffHz: 1000`, `passbandRippleDb: 1`, `stopbandAttenuationDb: 30` |
| Suppression des clics | `audacity-click-removal` | `threshold: 200`, `maximumWidth: 20` |
| Compresseur | `compressor` | `threshold: -24`, `knee: 30`, `ratio: 4`, `attack: 0.003`, `release: 0.25`, `makeupGain: 0` |
| Compresseur (Audacity) | `audacity-compressor` | `thresholdDb: -10`, `makeupGainDb: 0`, `kneeWidthDb: 5`, `ratio: 10`, `lookaheadMs: 1`, `attackMs: 30`, `releaseMs: 150` |
| Délai | `delay` | `time: 0.25`, `feedback: 0.3`, `mix: 0.2` |
| Distorsion | `audacity-distortion` | `mode: 'hard-clipping'`, `dcBlock: false`, `thresholdDb: -6`, `noiseFloorDb: -70`, `parameter1: 50`, `parameter2: 50`, `repeats: 1` |
| Écho | `audacity-echo` | `delaySeconds: 1`, `decay: 0.5` |
| Fondu d'entrée | `audacity-fade-in` | aucun |
| Fondu de sortie | `audacity-fade-out` | aucun |
| Égaliseur par courbe de filtre | `audacity-filter-curve-eq` | `points` : un tableau de `{ frequency, gain }`, par défaut deux points plats à 20 Hz et 20 kHz ; `linearFrequencyScale: false` ; `filterLength: 8191` |
| Égaliseur paramétrique à quatre bandes | `eq` | `outputGain: 0` ; `bands` : quatre objets `{ id, enabled, type, frequency, gain, q, slope }`, avec des pics à 100, 500, 2000 et 8000 Hz avec `gain: 0`, `q: 1`, `slope: 12` |
| Porte | `gate` | `threshold: -50`, `attack: 0.005`, `hold: 0.05`, `release: 0.1`, `rangeDb: -80` |
| Égaliseur graphique | `audacity-graphic-eq` | `gains` : gains de 31 bandes en dB, tous à 0 ; `interpolation: 'bspline'` ; `filterLength: 8191` |
| Filtre passe-haut | `highpass` | `frequency: 80`, `q: 0.707` |
| Inverser | `audacity-invert` | aucun |
| Compresseur hérité | `audacity-legacy-compressor` | `thresholdDb: -12`, `noiseFloorDb: -40`, `ratio: 2`, `attackSeconds: 0.2`, `releaseSeconds: 1`, `normalize: true`, `usePeak: false` |
| Limiteur | `limiter` | `ceiling: -1`, `lookahead: 0.005`, `release: 0.1` |
| Limiteur (Audacity) | `audacity-limiter` | `thresholdDb: -5`, `makeupTargetDb: -1`, `kneeWidthDb: 2`, `lookaheadMs: 1`, `releaseMs: 20` |
| Normalisation de la loudness | `audacity-loudness-normalization` | `mode: 'lufs'`, `targetLufs: -23`, `targetRmsDb: -20`, `stereoIndependent: false`, `dualMono: true` |
| Filtre passe-bas | `lowpass` | `frequency: 18000`, `q: 0.707` |
| Réduction de bruit | `audacity-noise-reduction` | `reductionDb: 6`, `sensitivity: 6`, `frequencySmoothingBands: 6`, `output: 'reduce'` |
| Normaliser | `audacity-normalize` | `peakDb: -1`, `removeDc: true`, `applyGain: true`, `stereoIndependent: false` |
| Paulstretch | `audacity-paulstretch` | `stretchFactor: 10`, `timeResolution: 0.25` |
| Phaser | `audacity-phaser` | `stages: 2`, `dryWet: 128`, `frequency: 0.4`, `phaseDegrees: 0`, `depth: 100`, `feedbackPercent: 0`, `outputGainDb: -6` |
| Suppression du décalage DC | `audacity-remove-dc-offset` | aucun |
| Réparation | `audacity-repair` | aucun |
| Répéter | `audacity-repeat` | `count: 1` |
| Réverbération | `reverb` | `mix: 0.2`, `decay: 2`, `preDelay: 0.01` |
| Réverbération (Audacity) | `audacity-reverb` | `roomSize: 75`, `preDelay: 10`, `reverberance: 50`, `damping: 50`, `toneLow: 100`, `toneHigh: 100`, `wetGainDb: -6`, `dryGainDb: 0`, `stereoWidth: 100`, `wetOnly: false` |
| Inverser | `audacity-reverse` | aucune |
| Étirement glissant | `audacity-sliding-stretch` | `startTempoPercent: 0`, `endTempoPercent: 0`, `startPitchSemitones: 0`, `endPitchSemitones: 0`, `preserveFormants: true` |
| Tronquer le silence | `audacity-truncate-silence` | `thresholdDb: -20`, `action: 'truncate'`, `minimumSilence: 0.5`, `truncateTo: 0.5`, `compressPercent: 50`, `independent: false` |
| Gain utilitaire (Revue) | `reviewed-utility-gain` | `gain: 1` |
| Wahwah | `audacity-wahwah` | `frequency: 1.5`, `phaseDegrees: 0`, `depthPercent: 70`, `resonance: 2.5`, `frequencyOffsetPercent: 30`, `outputGainDb: -6` |

Deux effets nécessitent quelque chose qu'un programme ne peut pas fournir. La réduction de bruit a besoin d'un profil de bruit capturé dans la boîte de dialogue de l'effet lui-même, et le duckage automatique a besoin d'une piste de contrôle située sous la piste active.

## Commandes qu'un programme peut exécuter {#commands-a-program-can-run}

`sound.command` accepte les noms de commandes de macros Audacity ci-dessous. Ce sont les mêmes noms qu'une macro de liste d'étapes peut contenir, de sorte qu'un programme et une liste d'étapes ont exactement la même portée. Chaque commande exécute l'action de l'éditeur que la [référence des commandes](/reference/generated/commands/) décrit.

### Commandes de sélection avec paramètres

| Commande | Paramètres |
| --- | --- |
| `SelectTime` | `start`, `end` en secondes ; `relativeTo` comme pour `sound.select.time` |
| `SelectFrequencies` | `low`, `high` en hertz |
| `SelectTracks` | `track`, `trackCount` (0 à 100) ; `mode` de `'set'`, `'add'` ou `'remove'` |
| `Select` | Toute combinaison des trois ensembles ci-dessus |

Un paramètre que vous omettez laisse cette partie de la sélection inchangée, ce qui est la façon dont Audacity les interprète également.

### Commandes sans paramètres

| Groupe | Commandes |
| --- | --- |
| Sélection | `SelectAll`, `SelectNone`, `SelCursorStoredCursor`, `SelTrackStartToEnd`, `SelCursorToTrackEnd`, `SelPrevClip`, `SelNextClip`, `ZeroCross` |
| Édition | `Cut`, `Copy`, `Paste`, `Delete`, `Duplicate`, `Split`, `SplitNew`, `Join`, `Disjoin`, `Trim`, `Silence`, `SplitCut`, `SplitDelete` |
| Pistes | `NewMonoTrack`, `NewStereoTrack`, `NewLabelTrack`, `RemoveTracks`, `MixAndRender`, `SortByName`, `SortByTime` |
| Étiquettes | `AddLabel` |
| Analyse | `FindClipping`, `ContrastAnalyser`, `PlotSpectrum`, `RepeatLastEffect` |

### Ce qui est délibérément absent

`Undo` et `Redo` sont absents car une exécution est déjà une entrée de l'historique et une étape qui parcourait l'historique irait au-delà de l'exécution jusqu'à vos propres modifications. Les commandes de transport et d'enregistrement sont absentes car un programme n'a rien à attendre et ne peut pas être annulé à partir d'un enregistrement. L'ouverture, l'enregistrement, la fermeture, l'importation, l'exportation et les préférences sont absentes car la portée d'un programme est le projet unique qui était ouvert au moment de son démarrage. Les commandes qui n'ouvrent qu'une boîte de dialogue ou modifient l'affichage sont absentes car elles ne modifient rien dans le projet.

## Partage de programmes {#sharing-programs}

**Exporter le programme** écrit le programme sélectionné dans un fichier `.soundscapemacro`, et **Importer le programme** en lit un. Le fichier est au format JSON plutôt qu'un fichier `.js` brut, de sorte que rien sur l'ordinateur récepteur ne le confondra avec quelque chose à exécuter en dehors de l'éditeur :

```json
{
	"schemaVersion": 1,
	"kind": "script",
	"engine": "soundscaper-macro-js/1",
	"name": "Episode finish",
	"source": "await sound.select.all();\nawait sound.effect('audacity-normalize');\n"
}
```

L'importation stocke le texte et rien d'autre. Un programme importé n'a pas de bouton **Exécuter le programme** ; à la place, le volet affiche le programme, le fichier d'origine, une note sur ce qu'un programme peut faire au projet ouvert, et une case à cocher indiquant *J'ai lu ce programme et je souhaite l'exécuter.* La cocher active **Activer ce programme**, et seulement alors le programme peut s'exécuter.

Cette autorisation concerne le texte exact que vous avez lu. Si le programme est modifié par la suite, que vous le modifiiez vous-même ou que vous importiez une copie plus récente par-dessus, la revue apparaît à nouveau jusqu'à ce que vous activiez le nouveau texte. Les programmes que vous rédigez vous-même dans le gestionnaire n'ont pas besoin de revue.

## Exemples

Fondu enchaîné sur chaque clip de la première piste qui en contient. Cliquez sur l'en-tête de cette piste avant l'exécution, afin que l'effet s'applique à la piste que le programme lit :

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

Exécuter une macro de liste d'étapes enregistrée uniquement lorsque la sélection est suffisamment longue :

```js
const { startFrame, endFrame } = await sound.project.selection();
const { sampleRate } = await sound.project.snapshot();
sound.assert((endFrame - startFrame) / sampleRate >= 30, 'Select at least thirty seconds.');
await sound.runSaved('Episode finish');
```

## À propos de cette page

Chaque programme de cette page, des extraits d'une ligne aux exemples détaillés,
est exécuté sur chaque version de Soundscaper par la suite de tests du navigateur
(`tests/browser/handbook-macro-program-examples.spec.js`), qui lit les programmes directement dans le texte de cette page. Un programme qui cesse de se terminer, ou qui cesse de produire ce que cette page indique qu'il produit, fait échouer la version jusqu'à ce que la page ou l'éditeur soit corrigé.

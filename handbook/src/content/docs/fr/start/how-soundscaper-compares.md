---
title: "Comparaison de Soundscaper"
description: "Comparez Soundscaper avec Audacity 4 et Adobe Audition en matière d'enregistrement, d'édition, de mixage, de livraison et d'interchange."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"5b9d7c73cc9a759d623469a935b0c57325920832ea7775ef89dee9cdede4a17f","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5b9d7c73cc9a759d623469a935b0c57325920832ea7775ef89dee9cdede4a17f","targetLocale":"fr"} -->

Soundscaper réimplémente Audacity 4 sur le web et ajoute une couche de production par-dessus. Adobe Audition est l'outil commercial de post-production auquel les deux sont généralement comparés. Cette page compare les trois afin que vous puissiez déterminer lequel remplit déjà la tâche que vous avez à accomplir.

## Comment lire cette page

Chaque cellule indique **Oui**, **Partiel** ou **Non**, suivie du détail qui la qualifie.

**Partiel** couvre trois situations différentes, et la note précise laquelle s'applique : la fonctionnalité existe mais est plus restreinte qu'ailleurs, elle existe mais dépend d'un élément que vous devez fournir, ou elle n'est accessible qu'en contournant une absence.

Les lignes décrivent des fonctionnalités, et non des commandes de menu. Pour l'inventaire exact des commandes, voir [Commandes et raccourcis](/reference/generated/commands/), et pour ce que chaque produit permet, voir
[Fonctionnalités du produit](/reference/generated/product-capabilities/).

### Origine de ces affirmations

- Les lignes **Soundscaper** proviennent de ce dépôt : les profils de fonctionnalités du produit, le manifeste d'actions d'exécution et le registre des formats d'exportation.
  Plusieurs chemins natifs de bureau sont implémentés mais restent conditionnés à des charges utiles signées de la machine ; ces lignes l'indiquent.
- Les lignes **Audacity 4** proviennent de l'inventaire amont épinglé dans ce
  dépôt, `4.0.0` à l'engagement `4c177d43`. Une fonctionnalité que l'amont
  enregistre mais laisse désactivée ou commentée hors du menu est
  enregistrée comme telle, et une fonctionnalité sans enregistrement dans la version épinglée est
  signalée comme absente de cette version plutôt que comme définitivement absente.
- Les lignes **Audition** proviennent de la documentation publiée par Adobe pour la version
  actuelle. Elles ne sont pas vérifiées contre une version en cours d'exécution.

## Plateforme et termes

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licence | Oui — AGPL-3.0-only | Oui — GPL, open source | Non — propriétaire et fermé |
| Coût | Oui — gratuit | Oui — gratuit | Non — abonnement Creative Cloud |
| Fonctionne dans un navigateur | Oui — Chromium, Firefox et WebKit | Non — bureau uniquement | Non — bureau uniquement |
| Versions bureau | Oui — Windows et Linux sur x64 et ARM64, macOS sur ARM64 | Oui — Windows, macOS, Linux | Partiel — Windows et macOS, pas de Linux |
| Fonctionne sans compte | Oui — aucun compte n'existe | Oui — connexion uniquement pour audio.com | Non — abonnement avec compte connecté requis |
| Stockage de projets cloud | Non — exclu par la conception local-first | Oui — sauvegarde et partage via audio.com | Partiel — fichiers Creative Cloud, les sessions ne se synchronisent pas |
| Exigences système | Oui — fonctionne partout où un navigateur actuel fonctionne | Partiel — considérablement augmentées par rapport à Audacity 3 | Partiel — classe de station de travail professionnelle |

## Modèle de projet et de session

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Format de projet natif | Oui — `.sscape`, une archive portable sans perte | Oui — `.aup4` | Oui — `.sesx` |
| Ouvre les projets Audacity | Oui — importation et exportation AUP4 | Oui — natif | Non |
| Chronologie de clips non destructive | Oui | Oui | Oui — éditeur multitrack |
| Éditeur de fichier unique dédié | Partiel — l'édition d'échantillons se fait dans la chronologie | Partiel — les modifications s'appliquent en place dans la chronologie | Oui — éditeur de forme d'onde |
| Contenu mono et stéréo sur une seule piste | Oui — une piste contient l'un ou l'autre | Non — une piste est mono ou stéréo | Non — le format de canal est fixe par piste |
| Dossiers de pistes imbriqués | Oui — profondeur illimitée, annulable, avec routage | Non | Partiel — uniquement des bus de sous-mélange, pas de pistes dossier |
| Bac à projets | Oui — organise les fichiers et sert de presse-papiers | Non | Partiel — le panneau Fichiers liste les fichiers ouverts |
| Sauvegarde automatique et récupération après crash | Oui — sauvegarde automatique, verrous et enveloppes de récupération | Oui | Oui |
| Marqueurs et régions nommées | Oui — de premier ordre, avec navigation et comportement en cascade | Partiel — pistes d'étiquettes | Oui — marqueurs et plages |
| Cartes de tempo et de signature | Oui — cartes ordonnées résolues avec précision à l'échantelle | Partiel — un tempo et une signature par projet | Partiel — un tempo par session |

## Enregistrement

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Enregistrement multitrack | Oui — plusieurs sources à la fois | Partiel — un seul périphérique d'entrée à la fois | Oui — interfaces multi-entrées et multicanal |
| Micro et audio du bureau ensemble | Oui — intégré | Non | Partiel — nécessite un périphérique de boucle de l'OS |
| Enregistrement chronométré | Oui | Oui | Non |
| Enregistrement activé par le son | Oui — avec un seuil réglable | Oui — avec un seuil réglable | Non |
| Comptage avant la prise | Oui — conscient de la carte de tempo, gère le mètre composé | Partiel — enregistrement d'introduction | Partiel — pré-roulement dans le cadre du punch and roll |
| Enregistrement en punch | Oui — une seule transaction, capture par défaut et routée | Non | Oui — punch and roll |
| Enregistrement en boucle dans les prises | Oui — une voie par passage, ajoutée au même groupe | Non | Partiel — prises sur un seul clip, choisies dans une liste |
| Comping de prises | Oui — audition, promotion, édition des régions de comp, aplatissement en une seule modification annulable | Non | Non — pas d'éditeur de comp |
| Surveillance et mesure des entrées | Oui | Oui | Oui |

## Édition de la chronologie

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Variantes d'édition en cascade | Oui — par clip, par piste et toutes les pistes, lors de la coupe et de la suppression | Oui — les mêmes trois, lors de la coupe et de la suppression | Partiel — suppression en cascade sur une sélection ou un espace |
| Découpage, fusion et découpage aux silences | Oui | Oui | Partiel — découpage et rognage, pas de fusion de clips |
| Groupes de clips | Oui | Oui | Oui |
| Gain de clip | Oui | Oui | Oui |
| Hauteur et vitesse par clip | Oui — ajuster, rendre ou réinitialiser | Oui — ajuster, rendre ou réinitialiser | Partiel — l'étirement reste modifiable, la hauteur est un effet |
| Suivi des changements de tempo | Oui — les clips s'étirent lorsque la carte se déplace | Oui | Non |
| Quantification et groove sensibles aux battements | Oui — cartes de warp avec force de groove ajustable | Non | Non |
| Aimantation aux zéros de passage | Oui | Oui | Oui |
| Dessin au niveau de l'échantillon | Oui | Partiel — aucune action de dessin enregistrée dans la version épinglée | Oui — dans l'éditeur de forme d'onde |
| Édition uniquement au clavier | Oui — chaque primitive d'édition a une action de navigation | Oui — chaque primitive d'édition a une action de navigation | Partiel — raccourcis étendus, certains panneaux nécessitent la souris |

## Travail spectral et restauration

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vue spectrogramme | Oui — avec réglages par piste | Oui — avec réglages par piste | Oui — affichages de fréquence et de hauteur |
| Sélection bornée en fréquence | Oui | Oui | Oui — lasso et sélection libre |
| Pinceau spectral | Oui | Oui | Oui — pinceau et retouche locale |
| Supprimer ou amplifier une région spectrale | Oui — les deux en tant qu'actions directes | Oui — les deux en tant qu'actions directes | Partiel — appliquer un effet à la sélection |
| Réparation de dommages courts | Oui — Réparation | Oui — Réparation | Oui — Auto Heal et Spot Healing Brush |
| Réduction du bruit large bande | Oui — avec un profil capturé | Oui — avec un profil capturé | Oui — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Dé-réverbération | Non | Non | Oui — DeReverb |
| Outils pour clics, ronflements et sibilances | Partiel — uniquement Click Removal | Partiel — uniquement Click Removal | Oui — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Panneau de diagnostic | Partiel — Find Clipping en tant qu'analyseur | Partiel — Find Clipping en tant qu'analyseur | Oui — diagnostics avec réparation par problème |

## Effets et plug-ins

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suite d'effets intégrée | Oui — les 30 effets Audacity, les plug-ins Nyquist intégrés et les effets de première partie sans équivalent amont, tels que le bitcrusher | Oui — la même collection intégrée de 30 effets | Oui — environ cinquante, y compris la dynamique multibande |
| Rack d'effets en temps réel par piste | Oui — un ensemble en temps réel plus large que l'amont | Oui | Oui — seize emplacements par clip, piste et maître |
| Égaliseur paramétrique | Oui — un nouvel égaliseur paramétrique avec bandes automatisables | Partiel — Filter Curve et Graphic EQ | Oui — filtres paramétriques, graphiques et FFT |
| Préréglages d'effets | Oui — appliquer, enregistrer, importer, exporter | Oui — appliquer, enregistrer, importer, exporter | Oui |
| Macros et chaînes par lots | Oui — bibliothèque de macros enregistrées avec modèles | Non — la version épinglée commente le menu Macros | Oui — Favorites et Batch Process |
| Formats de plug-ins tiers | Partiel — VST3, CLAP, AU et LV2 sur bureau derrière consentement et confinement, aucun dans le navigateur | Oui — VST3, AU, LV2 et Nyquist, avec un gestionnaire de plug-ins | Partiel — VST3 et AU sur macOS, pas de CLAP ou LV2 |
| Scripting Nyquist | Oui — plug-ins intégrés et invite Nyquist | Oui — plug-ins intégrés et invite Nyquist | Non |
| Paquets d'effets sandboxés | Partiel — paquets WebAssembly examinés, un est livré et les externes sont confinés | Non | Non |
| Instruments virtuels | Non — après la 1.0 | Non | Non |

## Mixage, routage et automatisation

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixeur avec bandes de canaux | Oui | Partiel — contrôles de piste et une piste maître | Oui |
| Bus et sous-mixages | Oui — imbriqués, avec validation de cycle | Non | Oui — pistes bus |
| Envois | Oui — pré et post-fader, plusieurs affectations | Non | Oui — pré et post-fader |
| Groupes VCA | Oui | Non | Non |
| Entrée de sidechain | Oui | Non | Oui — via les envois |
| Mixages de cue et de salle de contrôle | Oui | Non | Non |
| Compensation de délai des plug-ins | Oui — lecture, monitoring, bus, sidechains, rendu et figeage | Partiel — non exposé dans les sources épinglées | Oui |
| Voies d'automatisation | Oui — gain, panoramique, sourdine, envois, bus et paramètres de plug-in | Non — pas de voies et pas d'outil d'enveloppe dans la version épinglée | Oui — volume, panoramique et paramètres d'effet |
| Modes d'automatisation | Oui — lecture, rognage, toucher, verrouillage et écriture | Non | Partiel — lecture, écriture, verrouillage et toucher, pas de rognage |
| Formes de courbe | Oui — ligne, maintien et courbe | Non | Oui — linéaire et spline |
| Figeage de piste | Oui — figer, défiger et commettre sans perdre l'état | Non | Partiel — rebond vers une nouvelle piste |

## Mesure et analyse

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mètre de loudness | Oui — style EBU R 128, avec historique | Non — un effet Loudness Normalization mais pas de mètre | Oui — Loudness Radar selon ITU-R BS.1770 |
| Mètre de phase et de corrélation | Oui | Non | Oui — mètre de phase et analyse |
| Mesure surround | Oui | Non | Partiel — jusqu'à 5.1 |
| Tracé du spectre | Oui — Plot Spectrum | Partiel — enregistré, mais la version épinglée le commente hors du menu Analyze | Oui — Frequency Analysis |
| Clipping et RMS dans la forme d'onde | Oui — les deux, basculés par projet | Oui — les deux, basculés par projet | Partiel — indicateurs de clip, RMS dans Amplitude Statistics |
| Contraste d'intelligibilité de la parole | Oui — analyseur Contrast | Partiel — enregistré, mais la version épinglée le commente hors du menu Analyze | Non |

## Canaux et audio immersif

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canaux par fichier | Oui — jusqu'à 32 pour les formats PCM | Partiel — pistes mono et stéréo | Oui — jusqu'à 32 dans l'éditeur d'onde |
| Mixage surround | Oui — lits jusqu'à 7.1.4 | Non | Partiel — jusqu'à 5.1 |
| Audio par objets | Oui — objets en plus des lits | Non | Non |
| Création et passage ADM | Oui — BW64/ADM avec contrôles de conformité | Non | Non |
| Rendu binaural | Oui — un modèle binaural nommé | Non | Partiel — binauraliseur pour ambisonics |
| Ambisonics | Non | Non | Oui — premier ordre, avec un panoramiseur VR |

## Export et livraison

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Sortie sans perte | Oui — WAV, AIFF, BWF et BW64 écrits nativement | Oui — WAV, AIFF et FLAC | Oui — WAV, AIFF, FLAC et plus encore |
| Sortie avec perte | Partiel — MP3, AAC, Opus, Vorbis, MP2, FLAC et WavPack, tous via le runtime FFmpeg | Partiel — MP3 intégré, le reste via une installation FFmpeg optionnelle | Oui — intégré |
| Paramètres d'encodeur personnalisés | Oui — une cible FFmpeg personnalisée | Oui — une cible FFmpeg personnalisée | Oui — options par format |
| File d'attente d'export | Oui — pause, annulation, nouvelle tentative et réorganisation | Non — un export à la fois | Partiel — Traitement par lots sans contrôle de file d'attente |
| Stems et alternatives en une seule passe | Oui — mis en file d'attente avec le mix | Non | Partiel — un mixdown par stem |
| Livraison par région | Oui — séquences de mastering avec métadonnées par région, espaces et fondu | Partiel — export de libellés, pas d'export multi-fichiers dans la version épinglée | Oui — export de marqueurs vers des fichiers séparés |
| Normalisation de la loudness à l'export | Oui — fait partie du plan de livraison | Partiel — exécuter l'effet d'abord | Oui — Match Loudness |
| Dither et mapping des canaux | Oui — contrôles explicites | Partiel — dither dans les préférences | Oui — contrôles explicites |
| Rapport de livraison | Oui — détaillé par tâche | Non | Non |
| La file de rendu survit à un redémarrage | Oui — sur bureau, redémarrage depuis le zéro octet avec un journal de crash | Non | Non |

## Interopérabilité avec d'autres outils

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Projets Audacity | Oui — AUP4 en entrée et en sortie, avec un rapport d'omissions | Oui — natif | Non |
| EDL | Partiel — export de classe CMX3600, pas d'import | Non | Non |
| OpenTimelineIO | Partiel — export uniquement | Non | Non |
| FCPXML | Partiel — export uniquement | Non | Oui — import et export |
| DAWproject | Oui — import et export, avec un rapport d'échange | Non | Non |
| OMF | Non | Non | Partiel — import et export |
| Aller-retour avec un éditeur vidéo | Partiel — transmet le même projet à Framescaper sans copier les médias | Non | Oui — Dynamic Link avec Premiere Pro |
| Échange de libellés et de marqueurs | Oui — import et export | Oui — import et export | Oui — listes de marqueurs |

## Vidéo

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Import vidéo pour référence | Oui — sur la timeline, avec audio lié | Non | Partiel — une piste vidéo, aperçu uniquement |
| Édition de la timeline vidéo | Partiel — édition de base, la surface complète est Framescaper | Non | Non |
| Export vidéo | Oui — MP4 et WebM via le runtime FFmpeg | Non | Non — audio uniquement |
| Compositing, étalonnage et effets | Partiel — dans Framescaper, sur le même projet | Non | Non |

## Assistance par machine

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Amélioration de la parole | Partiel — bureau uniquement, une fois la charge utile du modèle installée | Non | Oui — Enhance Speech |
| Transcription et diarisation | Partiel — bureau uniquement, modèles opt-in | Non | Non — les transcriptions sont dans Premiere Pro |
| Séparation de source en stems | Partiel — bureau uniquement, modèles opt-in | Non | Non |
| Ducking automatique | Oui — effet Auto Duck | Oui — effet Auto Duck | Oui — ducking Essential Sound |
| Détection de beat et de shot | Partiel — bureau uniquement, modèles opt-in | Non | Partiel — Remix retimes la musique automatiquement |
| Fonctionne entièrement sur votre machine | Oui — l'inférence est uniquement sur bureau et hors ligne après installation | Oui — aucune inférence du tout | Partiel — certaines fonctionnalités sont traitées dans le cloud d'Adobe |
| Les modèles sont optionnels et supprimables | Oui — téléchargés séparément, épinglés par digest, supprimables | Oui — rien à installer | Non — intégrés à l'application |

## Ce que les différences représentent

Audacity 4 est un éditeur en une seule passe. Il n'a pas de bus, pas d'envois, pas
de pistes d'automatisation et pas de macros dans la version épinglée. Soundscaper conserve ce
modèle d'édition et ajoute la couche de mixage, d'automatisation et de livraison par-dessus,
ainsi que l'enregistrement, la vidéo et l'interopérabilité que Audacity n'essaie pas de faire.

Audition reste en tête en profondeur de restauration, en aller-retours avec Premiere Pro et en
ambisonics. Là où Soundscaper est en tête, c'est la livraison immersive, la gestion de projet et
le fait qu'il fonctionne dans un navigateur sur du matériel que ni l'un ni l'autre ne prend en charge.

Si vous travaillez déjà dans Audacity, voir
[fichiers de projet et interopérabilité avec Audacity](/projects-and-data/project-files/) pour
comment transférer un projet.

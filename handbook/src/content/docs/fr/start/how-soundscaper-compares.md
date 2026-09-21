---
title: "Comment Soundscaper se compare"
description: "Comparez Soundscaper avec Audacity 4 et Adobe Audition en termes d'enregistrement, de montage, de mixage, de livraison et d'échange."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"fr"} -->

Soundscaper réimplémente Audacity 4 sur le web et y ajoute une couche de production. Adobe Audition est l'outil commercial de post-production auquel les deux sont généralement comparés. Cette page compare les trois pour vous aider à déterminer lequel répond déjà à vos besoins.

## Comment lire cette page

Chaque cellule indique **Oui**, **Partiel** ou **Non**, suivi d'un détail qui le justifie.

**Partiel** couvre trois situations différentes, et la note précise laquelle s'applique : la fonctionnalité existe mais est plus limitée qu'ailleurs, elle existe mais dépend de quelque chose que vous devez fournir, ou elle n'est accessible qu'en contournant une absence.

Les lignes décrivent des fonctionnalités, pas des commandes de menu. Pour la liste exacte des commandes, voir [Commandes et raccourcis](/reference/generated/commands/), et pour les fonctionnalités offertes par chaque produit, voir [Fonctionnalités des produits](/reference/generated/product-capabilities/).

### Origine des affirmations

- Les lignes **Soundscaper** proviennent de ce dépôt : les profils de capacités des produits, le manifeste d'actions d'exécution et le registre des formats d'exportation. Les charges utiles natives de bureau sont générées par le CI du dépôt ou l'emballage de la cible. Un package n'est activé qu'après mise en scène et vérification du résultat exact correspondant ; ces lignes indiquent quand une charge utile est encore requise.
- Les lignes **Audacity 4** proviennent de l'inventaire en amont épinglé dans ce dépôt, `4.0.0` au commit `4c177d43`. Une fonctionnalité que l'amont enregistre mais laisse désactivée ou commente hors menu est enregistrée comme telle, et une fonctionnalité sans enregistrement dans la version épinglée est signalée comme absente de cette version plutôt que comme définitivement absente.
- Les lignes **Audition** proviennent de la documentation publiée par Adobe pour la version actuelle. Elles ne sont pas vérifiées sur une version exécutable.

## Plateforme et termes

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licence | Oui — AGPL-3.0-only | Oui — GPL, open source | Non — propriétaire et fermé |
| Coût | Oui — gratuit | Oui — gratuit | Non — abonnement Creative Cloud |
| S'exécute dans un navigateur | Oui — Chromium, Firefox et WebKit | Non — uniquement bureau | Non — uniquement bureau |
| Versions bureau | Oui — Windows et Linux sur x64 et ARM64, macOS sur ARM64 | Oui — Windows, macOS, Linux | Partiel — Windows et macOS, pas de Linux |
| Fonctionne sans compte | Oui — aucun compte n'existe | Oui — connexion uniquement pour audio.com | Non — connexion requise avec abonnement |
| Stockage de projets dans le cloud | Non — exclu par la conception axée sur le local | Oui — sauvegarde et partage via audio.com | Partiel — fichiers Creative Cloud, les sessions ne sont pas synchronisées |
| Exigences système | Oui — s'exécute partout où un navigateur actuel s'exécute | Partiel — augmentées de manière significative par rapport à Audacity 3 | Partiel — classe de poste de travail professionnel |

## Modèle de projet et de session

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Format de projet natif | Oui — `.sscape`, une archive portable sans perte | Oui — `.aup4` | Oui — `.sesx` |
| Ouvre les projets Audacity | Oui — importation et exportation AUP4 | Oui — natif | Non |
| Chronologie de clip non destructive | Oui | Oui | Oui — éditeur multitrack |
| Éditeur de fichier unique | Partiel — l'édition d'échantillon se fait dans la chronologie | Partiel — les modifications s'appliquent en place dans la chronologie | Oui — éditeur de forme d'onde |
| Contenu mono et stéréo sur une piste | Oui — une piste contient soit l'un soit l'autre | Non — une piste est mono ou stéréo | Non — le format de canal est fixe par piste |
| Dossiers de pistes imbriqués | Oui — à n'importe quelle profondeur, annulable, avec routage | Non | Partiel — bus de sous-mixage uniquement, pas de pistes de dossier |
| Bin de projet | Oui — organise les fichiers et fait office de presse-papiers | Non | Partiel — le panneau Fichiers liste les fichiers ouverts |
| Autosave et récupération en cas de plantage | Oui — autosave, verrous et enveloppes de récupération | Oui | Oui |
| Marqueurs et régions nommées | Oui — de première classe, avec navigation et comportement de balayage | Partiel — pistes d'étiquette | Oui — marqueurs et plages |
| Cartes de tempo et de signature temporelle | Oui — cartes ordonnées résolues avec précision d'échantillon | Partiel — un tempo et une signature de projet | Partiel — un tempo de session |

## Enregistrement

| Fonctionnalité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Enregistrement multitrack | Oui — plusieurs sources à la fois | Partiel — un périphérique d'entrée à la fois | Oui — interfaces multi-entrées et multicanaux |
| Microphone et audio de bureau ensemble | Oui — intégré | Non | Partiel — nécessite un périphérique de bouclage du système d'exploitation |
| Enregistrement chronométré | Oui | Oui | Non |
| Enregistrement activé par le son | Oui — avec un seuil réglable | Oui — avec un seuil réglable | Non |
| Compte à rebours avant la prise | Oui — conscient de la carte de tempo, gère les mètres composés | Partiel — enregistrement de lead-in | Partiel — pré-roll dans le cadre du punch and roll |
| Enregistrement punch | Oui — une transaction, capture par défaut et routée | Non | Oui — punch and roll |
| Enregistrement en boucle dans des prises | Oui — une voie par passage, appendée au même groupe | Non | Partiel — prises sur un clip, choisies dans une liste |
| Comping de prise | Oui — audition, promouvoir, éditer les régions de comp, aplatir en une seule édition annulable | Non | Non — pas d'éditeur de comp |
| Surveillance et métrage d'entrée | Oui | Oui | Oui |

## Édition de la chronologie

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Variants d'édition en cascade | Oui — par clip, par piste et pour toutes les pistes, lors de la coupe et de la suppression | Oui — les trois mêmes, lors de la coupe et de la suppression | Partiel — suppression en cascade sur une sélection ou un vide |
| Diviser, joindre et diviser aux silences | Oui | Oui | Partiel — diviser et rognage, pas de jointure de clip |
| Groupes de clips | Oui | Oui | Oui |
| Gain de clip | Oui | Oui | Oui |
| Vitesse et hauteur par clip | Oui — ajuster, rendre ou réinitialiser | Oui — ajuster, rendre ou réinitialiser | Partiel — l'étirement reste éditable, la hauteur est un effet |
| Suivre les changements de tempo | Oui — les clips s'étirent lorsque la carte bouge | Oui | Non |
| Quantification et groove sensibles aux pulsations | Oui — cartes de guerre avec force de groove ajustable | Non | Non |
| Accrochage aux passages à zéro | Oui | Oui | Oui |
| Dessin au niveau de l'échantillon | Oui | Partiel — aucune action de dessin enregistrée dans la version épinglée | Oui — dans l'éditeur de forme d'onde |
| Édition uniquement au clavier | Oui — chaque primitive d'édition a une action de navigation | Oui — chaque primitive d'édition a une action de navigation | Partiel — raccourcis étendus, certains panneaux nécessitent la souris |

## Travail et restauration spectrale

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vue spectrogramme | Oui — avec paramètres par piste | Oui — avec paramètres par piste | Oui — affichages de la fréquence et de la hauteur |
| Sélection limitée en fréquence | Oui | Oui | Oui — sélection en forme de losange et lasso |
| Pinceau spectral | Oui | Oui | Oui — pinceau et brosse de réparation ponctuelle |
| Supprimer ou amplifier une région spectrale | Oui — les deux comme actions directes | Oui — les deux comme actions directes | Partiel — appliquer un effet à la sélection |
| Réparation des dommages courts | Oui — Réparer | Oui — Réparer | Oui — Auto Heal et Spot Healing Brush |
| Réduction du bruit large bande | Oui — avec un profil capturé | Oui — avec un profil capturé | Oui — Réduction du bruit, Réduction du bruit adaptative, DeNoise |
| Désreverbe | Non | Non | Oui — DeReverb |
| Outils pour les clics, le bourdonnement et les sibilances | Partiel — Suppression des clics seulement | Partiel — Suppression des clics seulement | Oui — DeClicker, DeHummer, DeEsser, Élimination des clics/pops |
| Panneau de diagnostic | Partiel — Analyseur de clipping | Partiel — Analyseur de clipping | Oui — diagnostics avec réparation par problème |

## Effets et plug-ins

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Suite d'effets intégrée | Oui — les 30 effets Audacity, les plug-ins Nyquist intégrés et les effets premiers sans équivalent en amont, tels que le broyeur de bits | Oui — la même collection intégrée de 30 effets | Oui — environ cinquante, y compris les dynamiques en bandes multiples |
| Rack d'effets en temps réel par piste | Oui — un ensemble plus large en temps réel que celui en amont | Oui | Oui — seize emplacements par clip, piste et maître |
| Égaliseur paramétrique | Oui — un nouvel égaliseur paramétrique avec bandes automatisables | Partiel — Courbe de filtre et Égaliseur graphique | Oui — égaliseur paramétrique, graphique et FFT |
| Présets d'effets | Oui — appliquer, enregistrer, importer, exporter | Oui — appliquer, enregistrer, importer, exporter | Oui |
| Macros et chaînes par lots | Oui — bibliothèque de macros enregistrées avec des modèles | Non — le menu Macros est commenté dans la version épinglée | Oui — Favoris et Traitement par lots |
| Formats de plug-in tiers | Partiel — effets VST3, CLAP, AU, LV2 et LADSPA Linux, ainsi que les analyseurs Vamp sur le bureau derrière le consentement et l'enfermement ; aucun dans le navigateur | Oui — VST3, AU, LV2 et Nyquist, avec un gestionnaire de plug-ins | Partiel — VST3 et AU sur macOS, pas de CLAP ou LV2 |
| Scripting Nyquist | Oui — plug-ins intégrés et invite Nyquist | Oui — plug-ins intégrés et invite Nyquist | Non |
| Packages d'effets sandboxés | Partiel — packages WebAssembly examinés, un est livré et les externes sont clôturés | Non | Non |
| Instruments virtuels | Non — après 1.0 | Non | Non |

## Mixage, routage et automatisation

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixeur avec bandes de canaux | Oui | Partiel — contrôles de piste et une piste maître | Oui |
| Buses et sous-mixages | Oui — imbriqués, avec validation du cycle | Non | Oui — pistes de bus |
| Envois | Oui — pré et post-fader, multiples affectations | Non | Oui — pré et post-fader |
| Groupes VCA | Oui | Non | Non |
| Entrée en chaîne latérale | Oui | Non | Oui — via les envois |
| Mélanges de surveillance et de contrôle | Oui | Non | Non |
| Compensation de retard des plug-ins | Oui — lecture, surveillance, bus, chaînes latérales, rendu et gel | Partiel — non exposé dans les sources épinglées | Oui |
| Voies d'automatisation | Oui — gain, panoramique, mute, envois, bus et paramètres de plug-in | Non — pas de voies ni d'outil d'enveloppe dans la version épinglée | Oui — volume, panoramique et paramètres d'effet |
| Modes d'automatisation | Oui — lire, rognage, toucher, verrouiller et écrire | Non | Partiel — lire, écrire, verrouiller et toucher, pas de rognage |
| Formes de courbe | Oui — ligne, maintien et courbe | Non | Oui — linéaire et spline |
| Gel de piste | Oui — geler, dégeler et valider sans perdre l'état | Non | Partiel — rebondir vers une nouvelle piste |

## Mesures et analyse

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mètre de puissance sonore | Oui — style EBU R 128, avec historique | Non — un effet de normalisation de la puissance sonore mais pas de mètre | Oui — Radar de puissance sonore selon ITU-R BS.1770 |
| Mètre de phase et de corrélation | Oui | Non | Oui — mètre de phase et analyse |
| Mesures surround | Oui | Non | Partiel — jusqu'à 5.1 |
| Tracé du spectre | Oui — Tracer le spectre | Partiel — enregistré, mais la version épinglée commente sa sortie du menu Analyser | Oui — Analyse de fréquence |
| Clipping et RMS dans la forme d'onde | Oui — les deux, basculés par projet | Oui — les deux, basculés par projet | Partiel — indicateurs de clipping, RMS dans les statistiques d'amplitude |
| Contraste d'intelligibilité de la parole | Oui — Analyseur de contraste | Partiel — enregistré, mais la version épinglée commente sa sortie du menu Analyser | Non |

## Canaux et audio immersif

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Canaux par fichier | Oui — jusqu'à 32 pour les formats PCM | Partiel — pistes mono et stéréo | Oui — jusqu'à 32 dans l'éditeur de formes d'onde |
| Mixage surround | Oui — lits jusqu'à 7.1.4 | Non | Partiel — jusqu'à 5.1 |
| Audio basé sur les objets | Oui — objets avec lits | Non | Non |
| Auteur ADM et passage | Oui — BW64/ADM avec vérifications de conformité | Non | Non |
| Rendu binaural | Oui — un modèle binaural nommé | Non | Partiel — binauriseur pour les ambisons |
| Ambisonics | Non | Non | Oui — premier ordre, avec un panneur VR |

## Exportation et livraison

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Sortie sans perte | Oui — WAV, AIFF, BWF et BW64 écrits nativement | Oui — WAV, AIFF et FLAC | Oui — WAV, AIFF, FLAC et plus |
| Sortie avec perte | Partiel — MP3, AAC, Opus, Vorbis, MP2, FLAC et WavPack, tous via le runtime FFmpeg | Partiel — MP3 intégré, le reste via une installation FFmpeg optionnelle | Oui — intégré |
| Paramètres de codeur personnalisés | Oui — une cible FFmpeg personnalisée | Oui — une cible FFmpeg personnalisée | Oui — options par format |
| File d'attente d'exportation | Oui — pause, annulation, nouvelle tentative et réordonnancement | Non — une exportation à la fois | Partiel — Traitement par lots sans contrôle de file d'attente |
| Livraison de tiges et d'alternatives en une seule passe | Oui — mises en file d'attente avec le mix | Non | Partiel — un mixage par tige |
| Livraison région par région | Oui — séquences de mastering avec métadonnées, vides et fondues par région | Partiel — étiquettes d'exportation, pas d'exportation multi-fichiers dans la version épinglée | Oui — exportation de marqueurs vers des fichiers séparés |
| Normalisation de la loudness à l'exportation | Oui — partie du plan de livraison | Partiel — exécutez d'abord l'effet | Oui — Correspondance de la loudness |
| Dither et mappage des canaux | Oui — contrôles explicites | Partiel — dither dans les préférences | Oui — contrôles explicites |
| Rapport de livraison | Oui — détaillé par travail | Non | Non |
| File d'attente de rendu survivant à un redémarrage | Oui — sur le bureau, redémarre à partir de l'octet zéro avec un journal de plantage | Non | Non |

## Échange avec d'autres outils

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Projets Audacity | Oui — AUP4 entrée et sortie, avec un rapport d'omission | Oui — natif | Non |
| EDL | Partiel — exportation CMX3600-class, pas d'importation | Non | Non |
| OpenTimelineIO | Partiel — exportation uniquement | Non | Non |
| FCPXML | Partiel — exportation uniquement | Non | Oui — importation et exportation |
| DAWproject | Oui — importation et exportation, avec un rapport d'échange | Non | Non |
| OMF | Non | Non | Partiel — importation et exportation |
| Allers-retours avec un éditeur vidéo | Partiel — transmet le même projet à Framescaper sans copier les médias | Non | Oui — Liaison dynamique avec Premiere Pro |
| Échange de labels et de marqueurs | Oui — importation et exportation | Oui — importation et exportation | Oui — listes de marqueurs |

## Vidéo

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Importer une vidéo pour référence | Oui — sur la ligne de temps, avec audio lié | Non | Partiel — une piste vidéo, aperçu uniquement |
| Édition de la ligne de temps vidéo | Partiel — édition de base, la surface complète est Framescaper | Non | Non |
| Exportation vidéo | Oui — MP4 et WebM via le runtime FFmpeg | Non | Non — uniquement audio |
| Composition, notation et effets | Partiel — dans Framescaper, sur le même projet | Non | Non |

## Assistance machine

| Capacité | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Amélioration de la parole | Partiel — uniquement sur bureau, une fois la charge utile du modèle installée | Non | Oui — Améliorer la parole |
| Transcription et diarisation | Partiel — uniquement sur bureau, modèles opt-in | Non | Non — les transcriptions vivent dans Premiere Pro |
| Séparation des sources en tiges | Partiel — uniquement sur bureau, modèles opt-in | Non | Non |
| Canardage automatique | Oui — effet Auto Duck | Oui — effet Auto Duck | Oui — canardage Essential Sound |
| Détection de battements et de plans | Partiel — uniquement sur bureau, modèles opt-in | Non | Partiel — Remix retemps la musique automatiquement |
| S'exécute entièrement sur votre machine | Oui — l'inférence est uniquement sur bureau et hors ligne après installation | Oui — pas d'inférence du tout | Partiel — certaines fonctionnalités traitent dans le cloud d'Adobe |
| Les modèles sont optionnels et supprimables | Oui — téléchargés séparément, épinglés, supprimables | Oui — rien à installer | Non — fourni avec l'application |

## Ce que les différences signifient

Audacity 4 est un éditeur à passe unique. Il n'a pas de bus, pas d'envois,
pas de voies d'automatisation et pas de macros dans la version épinglée. Soundscaper conserve
ce modèle d'édition et ajoute la couche de mixage, d'automatisation et de livraison
par-dessus, plus le travail d'enregistrement, de vidéo et d'échange que Audacity ne tente pas.

Audition reste en tête en termes de profondeur de restauration, d'allers-retours avec Premiere Pro,
et d'ambisons. Là où Soundscaper prend l'avantage, c'est sur la livraison immersive,
la gestion des projets et le fait qu'il s'exécute dans un navigateur sur du matériel
que ni l'un ni l'autre ne prend en charge.

Si vous travaillez déjà avec Audacity, consultez
[fichiers de projet et échange Audacity](/projects-and-data/project-files/) pour
comment transférer un projet.

---
title: "Comparaison de Soundscaper"
description: "Comparez Soundscaper Web et Desktop avec Audacity 4 et Adobe Audition pour l’enregistrement, le montage, le mixage, la livraison et les échanges."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"fr"} -->

Soundscaper réimplémente Audacity 4 pour le Web et y ajoute une couche de production. Adobe Audition est l’outil commercial de postproduction auquel les deux sont généralement comparés. Cette page compare Soundscaper Web et Desktop, Audacity 4 et Audition pour vous aider à déterminer quelle édition répond déjà à vos besoins.

## Comment lire cette page

Chaque cellule commence par un symbole en couleur, suivi de la précision correspondante :

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — pris en charge ou applicable
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — portée limitée, dépendant de la plateforme ou nécessitant un contournement
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — indisponible ou sans objet

Lisez les remarques avec les symboles. L’installation facultative d’un plug-in, d’un modèle ou d’un codec ne rend pas à elle seule une fonction prise en charge sur Desktop limitée ; la remarque précise ce qu’il faut installer. Web et Desktop ont des colonnes distinctes : une restriction du navigateur ne diminue donc pas l’évaluation de Desktop.

Les lignes décrivent des fonctionnalités, pas des commandes de menu. Pour la liste exacte des commandes, voir [Commandes et raccourcis](/reference/generated/commands/), et pour les fonctionnalités offertes par chaque produit, voir [Fonctionnalités des produits](/reference/generated/product-capabilities/).

### Origine des affirmations

- Les lignes **Soundscaper** proviennent de ce dépôt : les profils de capacités des produits, le manifeste des actions d’exécution, le registre des formats d’exportation et les contrôles de prise en charge des codecs du navigateur et du bureau.
  Les charges utiles natives de bureau sont générées par la CI du dépôt ou par l’empaquetage de la cible. Un package n’en active une qu’après préparation et vérification du résultat correspondant exact ; ces lignes indiquent quand une charge utile reste nécessaire.
- Les lignes **Audacity 4** partent de l’inventaire amont épinglé dans ce dépôt, `4.0.0` au commit `4c177d43`, et comprennent les changements visibles pour l’utilisateur jusqu’à la [version officielle `4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt), au commit `d82386ce`. Une fonction enregistrée par l’amont mais désactivée ou commentée hors du menu est notée comme telle. Si elle n’est enregistrée ni dans l’inventaire audité ni dans les notes de version, elle est signalée comme absente de cet ensemble, et non comme définitivement absente. Le dessin des échantillons, les enveloppes de gain de clip et l’importation des anciens projets sont également documentés dans le [journal officiel des changements 4.0](https://www.audacityteam.org/changelog/) et le [manuel du gain de clip](https://www.audacityteam.org/manual/clips/clip-gain/).
- Les lignes **Audition** proviennent de la documentation publiée par Adobe pour la version actuelle. Elles ne sont pas vérifiées sur une version exécutable.

## Plateforme et termes

| Fonctionnalité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licence | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, open source | / — propriétaire et fermé |
| Coût | + — gratuit | + — gratuit | + — gratuit | / — abonnement Creative Cloud |
| S'exécute dans un navigateur | + — Chromium, Firefox et WebKit | / — application empaquetée | / — uniquement bureau | / — uniquement bureau |
| Versions bureau | / — utilisez la version Web | + — Windows et Linux sur x64 et ARM64, macOS sur ARM64 | + — Windows (installateur ou version portable), macOS, Linux | ~ — Windows et macOS, pas de Linux |
| Fonctionne sans compte | + — aucun compte n'existe | + — aucun compte n'existe | + — connexion uniquement pour audio.com | / — connexion requise avec abonnement |
| Stockage de projets dans le cloud | / — exclu par la conception axée sur le local | / — exclu par la conception axée sur le local | + — sauvegarde et partage via audio.com | ~ — fichiers Creative Cloud, les sessions ne sont pas synchronisées |
| Exigences système | + — s'exécute partout où un navigateur actuel s'exécute | + — Windows, Linux ou macOS sur les architectures de bureau prises en charge | ~ — augmentées de manière significative par rapport à Audacity 3 | ~ — classe de poste de travail professionnel |

## Modèle de projet et de session

| Fonctionnalité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Format de projet natif | + — `.sscape`, une archive portable sans perte | + — `.sscape`, une archive portable sans perte | + — `.aup4` | + — `.sesx` |
| Ouvre les projets Audacity | + — importation AUP, AUP3 et AUP4 ; exportation AUP3 et AUP4 | + — importation AUP, AUP3 et AUP4 ; exportation AUP3 et AUP4 | + — importation AUP, AUP3 et AUP4 ; exportation AUP4, pas d’exportation AUP3 | / |
| Chronologie de clip non destructive | + | + | + | + — éditeur multitrack |
| Éditeur de fichier unique | + — éditeur de forme d’onde source dans les propriétés du clip | + — éditeur de forme d’onde source dans les propriétés du clip | ~ — les modifications s'appliquent en place dans la chronologie | + — éditeur de forme d'onde |
| Contenu mono et stéréo sur une piste | + — une piste contient soit l'un soit l'autre | + — une piste contient soit l'un soit l'autre | / — une piste est mono ou stéréo | / — le format de canal est fixe par piste |
| Dossiers de pistes imbriqués | + — à n'importe quelle profondeur, annulable, avec routage | + — à n'importe quelle profondeur, annulable, avec routage | / | ~ — bus de sous-mixage uniquement, pas de pistes de dossier |
| Bin de projet | + — organise les fichiers et fait office de presse-papiers | + — organise les fichiers et fait office de presse-papiers | / | ~ — le panneau Fichiers liste les fichiers ouverts |
| Autosave et récupération en cas de plantage | + — autosave, verrous et enveloppes de récupération | + — autosave, verrous et enveloppes de récupération | + | + |
| Marqueurs et régions nommées | + — de première classe, avec navigation et comportement de balayage | + — de première classe, avec navigation et comportement de balayage | ~ — pistes d'étiquette | + — marqueurs et plages |
| Cartes de tempo et de signature temporelle | + — cartes ordonnées résolues avec précision d'échantillon | + — cartes ordonnées résolues avec précision d'échantillon | ~ — un tempo et une signature de projet | ~ — un tempo de session |

## Enregistrement

| Fonctionnalité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Enregistrement multitrack | + — plusieurs sources à la fois | + — plusieurs sources à la fois | ~ — un périphérique d'entrée à la fois | + — interfaces multi-entrées et multicanaux |
| Microphone et audio de bureau ensemble | ~ — intégré lorsque le navigateur et le système d’exploitation exposent l’audio de l’écran | + — microphone et bouclage audio du bureau sous Windows ; les autres systèmes utilisent une entrée de bouclage | / | ~ — nécessite un périphérique de bouclage du système d'exploitation |
| Enregistrement chronométré | + | + | + | / |
| Enregistrement activé par le son | + — avec un seuil réglable | + — avec un seuil réglable | + — avec un seuil réglable | / |
| Compte à rebours avant la prise | + — conscient de la carte de tempo, gère les mètres composés | + — conscient de la carte de tempo, gère les mètres composés | ~ — enregistrement de lead-in | ~ — pré-roll dans le cadre du punch and roll |
| Enregistrement punch | + — une transaction, capture par défaut et routée | + — une transaction, capture par défaut et routée | / | + — punch and roll |
| Enregistrement en boucle dans des prises | + — une voie par passage, appendée au même groupe | + — une voie par passage, appendée au même groupe | / | ~ — prises sur un clip, choisies dans une liste |
| Comping de prise | + — audition, promouvoir, éditer les régions de comp, aplatir en une seule édition annulable | + — audition, promouvoir, éditer les régions de comp, aplatir en une seule édition annulable | / | / — pas d'éditeur de comp |
| Surveillance et métrage d'entrée | + | + | + | + |

## Édition de la chronologie

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Variants d'édition en cascade | + — par clip, par piste et pour toutes les pistes, lors de la coupe et de la suppression | + — par clip, par piste et pour toutes les pistes, lors de la coupe et de la suppression | + — les trois mêmes, lors de la coupe et de la suppression | ~ — suppression en cascade sur une sélection ou un vide |
| Diviser, joindre et diviser aux silences | + | + | + | ~ — diviser et rognage, pas de jointure de clip |
| Groupes de clips | + | + | + | + |
| Gain de clip | + | + | + | + |
| Vitesse et hauteur par clip | + — ajuster, rendre ou réinitialiser | + — ajuster, rendre ou réinitialiser | + — ajuster, rendre ou réinitialiser | ~ — l'étirement reste éditable, la hauteur est un effet |
| Suivre les changements de tempo | + — les clips s'étirent lorsque la carte bouge | + — les clips s'étirent lorsque la carte bouge | + | / |
| Quantification et groove sensibles aux pulsations | + — cartes de guerre avec force de groove ajustable | + — cartes de guerre avec force de groove ajustable | / | / |
| Accrochage aux passages à zéro | + | + | + | + |
| Dessin au niveau de l'échantillon | + | + | + — disponible avec un zoom jusqu’aux échantillons individuels | + — dans l'éditeur de forme d'onde |
| Édition uniquement au clavier | + — chaque primitive d'édition a une action de navigation | + — chaque primitive d'édition a une action de navigation | + — les actions d’édition, la ligne de temps et les règles verticales des pistes se parcourent au clavier | ~ — raccourcis étendus, certains panneaux nécessitent la souris |

## Travail et restauration spectrale

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Vue spectrogramme | + — avec paramètres par piste | + — avec paramètres par piste | + — avec paramètres par piste | + — affichages de la fréquence et de la hauteur |
| Sélection limitée en fréquence | + | + | + | + — sélection en forme de losange et lasso |
| Pinceau spectral | + | + | + | + — pinceau et brosse de réparation ponctuelle |
| Supprimer ou amplifier une région spectrale | + — les deux comme actions directes | + — les deux comme actions directes | + — les deux comme actions directes | ~ — appliquer un effet à la sélection |
| Réparation des dommages courts | + — Réparer | + — Réparer | + — Réparer | + — Auto Heal et Spot Healing Brush |
| Réduction du bruit large bande | + — avec un profil capturé | + — avec un profil capturé | + — avec un profil capturé | + — Réduction du bruit, Réduction du bruit adaptative, DeNoise |
| Désreverbe | / — assistance sur ordinateur uniquement | + — Réduire la réverbération, avec modèle et moteur facultatifs installés | / | + — DeReverb |
| Outils pour les clics, le bourdonnement et les sibilances | ~ — suppression des clics et désesseur ; pas de suppresseur de bourdonnement dédié | ~ — suppression des clics et désesseur ; pas de suppresseur de bourdonnement dédié | ~ — Suppression des clics seulement | + — DeClicker, DeHummer, DeEsser, Élimination des clics/pops |
| Panneau de diagnostic | ~ — Analyseur de clipping | ~ — Analyseur de clipping | ~ — Analyseur de clipping | + — diagnostics avec réparation par problème |

## Effets et plug-ins

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Suite d'effets intégrée | + — effets dérivés d’Audacity, plug-ins Nyquist inclus et effets propres comme Bitcrusher et De-esser | + — effets dérivés d’Audacity, plug-ins Nyquist inclus et effets propres comme Bitcrusher et De-esser | + — 30 effets intégrés dans la version épinglée | + — environ cinquante, y compris les dynamiques en bandes multiples |
| Rack d'effets en temps réel par piste | + — un ensemble plus large en temps réel que celui en amont | + — un ensemble plus large en temps réel que celui en amont | + | + — seize emplacements par clip, piste et maître |
| Égaliseur paramétrique | + — un nouvel égaliseur paramétrique avec bandes automatisables | + — un nouvel égaliseur paramétrique avec bandes automatisables | ~ — Courbe de filtre et Égaliseur graphique | + — égaliseur paramétrique, graphique et FFT |
| Présets d'effets | + — appliquer, enregistrer, importer, exporter | + — appliquer, enregistrer, importer, exporter | + — appliquer, enregistrer, importer, exporter | + |
| Macros et chaînes par lots | + — bibliothèque de macros enregistrées avec des modèles | + — bibliothèque de macros enregistrées avec des modèles | / — le menu Macros est commenté dans la version épinglée | + — Favoris et Traitement par lots |
| Formats de plug-in tiers | / — les plug-ins natifs nécessitent la version Desktop | + — VST3, CLAP, AU, LV2, LADSPA sous Linux et Vamp ; dépend de la plateforme, avec consentement et confinement | + — VST3, AU, LV2 et Nyquist, avec un gestionnaire de plug-ins | ~ — VST3 et AU sur macOS, pas de CLAP ou LV2 |
| Scripting Nyquist | + — plug-ins intégrés et invite Nyquist | + — plug-ins intégrés et invite Nyquist | + — plug-ins intégrés et invite Nyquist | / |
| Packages d'effets sandboxés | ~ — packages WebAssembly examinés, un est livré et les externes sont clôturés | ~ — packages WebAssembly examinés, un est livré et les externes sont clôturés | / | / |
| Instruments virtuels | / | / | / | / |

## Mixage, routage et automatisation

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixeur avec bandes de canaux | + | + | ~ — contrôles de piste et une piste maître | + |
| Buses et sous-mixages | + — imbriqués, avec validation du cycle | + — imbriqués, avec validation du cycle | / | + — pistes de bus |
| Envois | + — pré et post-fader, multiples affectations | + — pré et post-fader, multiples affectations | / | + — pré et post-fader |
| Groupes VCA | + | + | / | / |
| Entrée en chaîne latérale | + | + | / | + — via les envois |
| Mélanges de surveillance et de contrôle | + | + | / | / |
| Compensation de retard des plug-ins | + — lecture, surveillance, bus, chaînes latérales, rendu et gel | + — lecture, surveillance, bus, chaînes latérales, rendu et gel | ~ — non exposé dans les sources épinglées | + |
| Voies d'automatisation | + — gain, panoramique, mute, envois, bus et paramètres de plug-in | + — gain, panoramique, mute, envois, bus et paramètres de plug-in | ~ — enveloppes de gain de clip ; aucune piste d’automatisation de piste ou d’effet | + — volume, panoramique et paramètres d'effet |
| Modes d'automatisation | + — lire, rognage, toucher, verrouiller et écrire | + — lire, rognage, toucher, verrouiller et écrire | / | ~ — lire, écrire, verrouiller et toucher, pas de rognage |
| Formes de courbe | + — ligne, maintien et courbe | + — ligne, maintien et courbe | ~ — enveloppes de gain de clip uniquement | + — linéaire et spline |
| Gel de piste | + — geler, dégeler et valider sans perdre l'état | + — geler, dégeler et valider sans perdre l'état | / | ~ — rebondir vers une nouvelle piste |

## Mesures et analyse

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mètre de puissance sonore | + — style EBU R 128, avec historique | + — style EBU R 128, avec historique | / — un effet de normalisation de la puissance sonore mais pas de mètre | + — Radar de puissance sonore selon ITU-R BS.1770 |
| Mètre de phase et de corrélation | + | + | / | + — mètre de phase et analyse |
| Mesures surround | + | + | / | ~ — jusqu'à 5.1 |
| Tracé du spectre | + — Tracer le spectre | + — Tracer le spectre | ~ — enregistré, mais la version épinglée commente sa sortie du menu Analyser | + — Analyse de fréquence |
| Clipping et RMS dans la forme d'onde | + — commandes au niveau du projet, avec remplacement RMS par piste | + — commandes au niveau du projet, avec remplacement RMS par piste | + — les deux, basculés par projet | ~ — indicateurs de clipping, RMS dans les statistiques d'amplitude |
| Contraste d'intelligibilité de la parole | + — Analyseur de contraste | + — Analyseur de contraste | ~ — enregistré, mais la version épinglée commente sa sortie du menu Analyser | / |

Dans Soundscaper, ouvrez le menu **Visualisation de piste** d’une piste pour activer ou désactiver **Demi-onde** ou **Afficher le RMS dans la forme d’onde**. La vue par défaut, les fréquences de coupure à 3 bandes et les paramètres du spectrogramme se trouvent dans **Édition → Préférences → Affichage des pistes**.

## Canaux et audio immersif

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Canaux par fichier | + — jusqu'à 32 pour les formats PCM | + — jusqu'à 32 pour les formats PCM | ~ — pistes mono et stéréo | + — jusqu'à 32 dans l'éditeur de formes d'onde |
| Mixage surround | + — lits jusqu'à 7.1.4 | + — lits jusqu'à 7.1.4 | / | ~ — jusqu'à 5.1 |
| Audio basé sur les objets | + — objets avec lits | + — objets avec lits | / | / |
| Auteur ADM et passage | + — BW64/ADM avec vérifications de conformité | + — BW64/ADM avec vérifications de conformité | / | / |
| Rendu binaural | + — un modèle binaural nommé | + — un modèle binaural nommé | / | ~ — binauriseur pour les ambisons |
| Ambisonics | / | / | / | + — premier ordre, avec un panneur VR |

## Exportation et livraison

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Sortie sans perte | + — WAV, AIFF, BWF et BW64 natifs ; FLAC et WavPack via des codecs dédiés | + — WAV, AIFF, BWF et BW64 natifs ; FLAC et WavPack via des codecs dédiés | + — WAV, AIFF et FLAC | + — WAV, AIFF, FLAC et plus |
| Sortie avec perte | ~ — MP3, MP2, Opus et Ogg Vorbis ; AAC dépend du navigateur | + — MP3, MP2, Opus, Ogg Vorbis et AAC via les fournisseurs de codecs pris en charge, y compris FFmpeg configuré | + — MP3, Opus et Ogg Vorbis ; autres formats via FFmpeg facultatif | ~ — MP2, MP3 et Ogg Vorbis ; davantage via Adobe Media Encoder, sans cible FFmpeg générale |
| Paramètres de codeur personnalisés | ~ — réglages propres à chaque format ; les arguments FFmpeg personnalisés ne sont pas disponibles | ~ — réglages propres à chaque format ; les arguments FFmpeg personnalisés ne sont pas disponibles | + — une cible FFmpeg personnalisée | + — options par format |
| File d'attente d'exportation | + — pause, annulation, nouvelle tentative et réordonnancement | + — pause, annulation, nouvelle tentative et réordonnancement | / — Exporter plusieurs est une seule opération séquentielle, pas une file de travaux | ~ — Traitement par lots sans contrôle de file d'attente |
| Livraison de tiges et d'alternatives en une seule passe | + — mises en file d'attente avec le mix | + — mises en file d'attente avec le mix | ~ — Exporter plusieurs écrit chaque piste séparément, mais ne met pas en file le mixage et les rendus alternatifs ensemble | ~ — un mixage par tige |
| Livraison région par région | + — séquences de mastering avec métadonnées, vides et fondues par région | + — séquences de mastering avec métadonnées, vides et fondues par région | + — Exporter plusieurs écrit chaque région étiquetée dans son propre fichier | + — exportation de marqueurs vers des fichiers séparés |
| Normalisation de la loudness à l'exportation | + — partie du plan de livraison | + — partie du plan de livraison | ~ — exécutez d'abord l'effet | + — Correspondance de la loudness |
| Dither et mappage des canaux | + — contrôles explicites | + — contrôles explicites | ~ — dither dans les préférences | + — contrôles explicites |
| Rapport de livraison | + — détaillé par travail | + — détaillé par travail | / | / |
| File d'attente de rendu survivant à un redémarrage | / — la reprise persistante des rendus nécessite Desktop | + — reprend depuis l’octet zéro après redémarrage, avec un journal de plantage | / | / |

Soundscaper Desktop peut utiliser FFmpeg configuré pour les formats d’exportation pris en charge ; l’éditeur actuel ne donne accès ni à des arguments FFmpeg arbitraires ni à tous les encodeurs FFmpeg. Consultez [Formats d’exportation](/reference/generated/formats/) pour les cibles enregistrées. Le [workflow d’exportation](https://www.audacityteam.org/manual/getting-started/export-your-audio/) d’Audacity ajoute des formats par l’installation facultative de FFmpeg. Audition propose un ensemble fixe d’écrivains de fichiers et un [transfert vers Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Échange avec d'autres outils

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Projets Audacity | + — importation AUP, AUP3 et AUP4 ; exportation AUP3 et AUP4 avec rapport de compatibilité | + — importation AUP, AUP3 et AUP4 ; exportation AUP3 et AUP4 avec rapport de compatibilité | + — importation AUP, AUP3 et AUP4 ; exportation AUP4, pas d’exportation AUP3 | / |
| Sessions Audition | / — l’importation SESX nécessite Desktop | ~ — importation audio `.sesx` avec rapport des éléments omis ; pas d’exportation | / — pas d’importation SESX dans la version épinglée | + — natif |
| EDL | ~ — exportation CMX3600-class, pas d'importation | ~ — exportation CMX3600-class, pas d'importation | / | / |
| OpenTimelineIO | ~ — exportation uniquement | ~ — exportation uniquement | / | / |
| FCPXML | ~ — exportation uniquement | ~ — exportation uniquement | / | + — importation et exportation |
| DAWproject | + — importation et exportation, avec un rapport d'échange | + — importation et exportation, avec un rapport d'échange | / | / |
| OMF | / | / | / | ~ — importation et exportation |
| Allers-retours avec un éditeur vidéo | ~ — transmet le même projet à Framescaper sans copier les médias | ~ — transmet le même projet à Framescaper sans copier les médias | / | + — Liaison dynamique avec Premiere Pro |
| Échange de labels et de marqueurs | + — importation et exportation | + — importation et exportation | + — importation et exportation | + — listes de marqueurs |

Pour les fichiers `.sesx` provenant d’Audition, consultez [Fichiers de projet](/projects-and-data/project-files/) afin de savoir quels réglages audio sont transférés dans Soundscaper et ce que le rapport signale comme omis.

## Vidéo

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Importer une vidéo pour référence | + — sur la ligne de temps, avec audio lié | + — sur la ligne de temps, avec audio lié | / | ~ — une piste vidéo, aperçu uniquement |
| Édition de la ligne de temps vidéo | ~ — édition de base, la surface complète est Framescaper | ~ — édition de base, la surface complète est Framescaper | / | / |
| Exportation vidéo | ~ — MP4 et WebM lorsque WebCodecs du navigateur prend en charge les codecs requis | + — MP4 et WebM avec un fournisseur de codecs de bureau vérifié | / | / — uniquement audio |
| Composition, notation et effets | ~ — dans Framescaper, sur le même projet | ~ — dans Framescaper, sur le même projet | / | / |

## Assistance machine

L’assistance Desktop est disponible après l’installation de poids de modèle facultatifs et d’un moteur natif correspondant ; ces workflows ne sont pas disponibles dans Web. Le gestionnaire de modèles installe les deux. Consultez [Assistance locale](/reference/generated/local-assistance/) pour connaître les workflows et modèles disponibles.

| Capacité | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Amélioration de la parole | / — assistance sur ordinateur uniquement | + — avec modèle et moteur facultatifs installés | / | + — Améliorer la parole |
| Transcription et diarisation | / — assistance sur ordinateur uniquement | + — avec modèles et moteurs facultatifs installés | / | / — les transcriptions vivent dans Premiere Pro |
| Séparation des sources en tiges | / — assistance sur ordinateur uniquement | + — avec modèle et moteur facultatifs installés | / | / |
| Canardage automatique | + — effet Auto Duck | + — effet Auto Duck | + — effet Auto Duck | + — canardage Essential Sound |
| Détection de battements et de plans | / — la détection des temps nécessite Desktop ; la détection de plans est dans Framescaper | ~ — détection des temps avec modèle facultatif ; la détection de plans est dans Framescaper | / | ~ — Remix retemps la musique automatiquement |
| S'exécute entièrement sur votre machine | + — traitement local dans le navigateur ; aucune inférence de modèle | + — traitement local et inférence hors ligne après installation du modèle | + — pas d'inférence du tout | ~ — certaines fonctionnalités traitent dans le cloud d'Adobe |
| Les modèles sont optionnels et supprimables | / — aucune installation de modèle dans la version Web | + — téléchargés séparément, épinglés, supprimables | + — rien à installer | / — fourni avec l'application |

## Ce que les différences signifient

Audacity 4 est un éditeur à passe unique. Dans la version épinglée, il n’a ni bus, ni départs, ni pistes d’automatisation pour les pistes ou les effets, ni macros. Ses enveloppes de gain de clip permettent d’automatiser le volume à l’intérieur d’un clip. Soundscaper conserve ce modèle de montage et y ajoute l’automatisation des pistes et des effets, le mixage et la livraison, ainsi que l’enregistrement, la vidéo et les échanges qu’Audacity ne tente pas de prendre en charge.

Audition reste en tête en termes de profondeur de restauration, d'allers-retours avec Premiere Pro,
et d'ambisons. Là où Soundscaper prend l'avantage, c'est sur la livraison immersive,
la gestion des projets et le fait qu'il s'exécute dans un navigateur sur du matériel
que ni l'un ni l'autre ne prend en charge.

Si vous travaillez déjà avec Audacity, consultez
[fichiers de projet et échange Audacity](/projects-and-data/project-files/) pour
comment transférer un projet.

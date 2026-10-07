---
title: "Importation et exportation"
description: "Distinguez les médias sources, les fichiers de projet, les fichiers d'échange et les livrables rendus."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"fr"} -->

Soundscaper utilise différents types de fichiers pour différentes tâches.

## Médias sources

Utilisez **Fichier → Importer** pour l'audio, la vidéo et les étiquettes. L'indice actuel de l'éditeur répertorie
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF et WebM ; des conteneurs vidéo supplémentaires sont pris en charge par la voie d'importation vidéo. La disponibilité peut dépendre
du produit actif et de l'exécution.

L'importation de médias ajoute une source appartenant au projet. Elle ne fait pas du fichier original
votre document de projet éditable.

Les exportations audio compressées et les importations dans le navigateur prennent en charge jusqu’à une heure ou 1 Go
(1 000 000 000 octets de fichier), selon la limite atteinte en premier. La sélection de fichiers sur ordinateur et l’importation d’audio compressé n’ont pas de plafond fixe de taille ou de durée avant la limite des entiers sûrs. Les tâches longues lisent, encodent et enregistrent par blocs ; les grandes exportations du navigateur nécessitent un stockage de fichiers privé à l’origine et suffisamment d’espace libre. Les grandes importations nécessitent assez d’espace local pour l’audio décodé. La structure du format, la prise en charge du décodeur et l’espace disponible peuvent toutefois limiter une importation.

Le niveau du navigateur couvre MP3, MP2, FLAC, WavPack, Opus et Ogg Vorbis. La prise en charge du navigateur AAC/M4A dépend du codec du navigateur. Les exportations de streaming de bureau couvrent
les six formats intégrés, avec FLAC 24 bits et WavPack sans perte float32. Les importations sur ordinateur dépendent de la disponibilité du décodeur ; les sources MP2 volumineuses utilisent le décodeur par paquets, tandis que les sources MP2 plus petites utilisent le niveau de compatibilité utilitaire.

Une tâche active affiche une barre de progression même lorsque **Affichage → Barre d'état** est masqué. Choisissez **Annuler** à côté de la barre pour arrêter une importation ou une exportation audio.

## Fichiers de projet éditable

- Scape (`.sscape` depuis Soundscaper, `.fscape` depuis Framescaper, et l'un ou l'autre pouvant être ouvert dans les deux) est le format de projet portable à pleine fidélité partagé par Soundscaper
et Framescaper.
- AUP3 et AUP4 permettent l’échange audio avec Audacity. Choisissez AUP3 pour le profil de projet Audacity 3.7.9 ou AUP4 pour le profil d’échange actuel. Aucun des deux n’est une sauvegarde complète d’un projet Soundscaper multimédia ; consultez le rapport de compatibilité après l’export.
- Les sessions Adobe Audition SESX (`.sesx`) peuvent être ouvertes dans l’édition de bureau pour créer un projet local à partir de leurs fichiers audio référencés. Conservez la session et les médias d’origine ; l’export SESX n’est pas disponible.

Consultez [Fichiers de projet](/projects-and-data/project-files/) pour les conséquences
de chaque choix.

## Livraisons rendues

Les exportations audio créent des fichiers destinés à l'écoute, à la publication ou à un traitement ultérieur. Les exportations vidéo créent des livraisons MP4 ou WebM. Un fichier rendu ne
retient pas la chronologie éditable, le routage, les effets ou l'historique du projet.

Consultez la section [référence](/reference/) pour les tableaux de formats générés et
capacités de produits.

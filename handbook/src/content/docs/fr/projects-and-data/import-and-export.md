---
title: "Importation et exportation"
description: "Distinguez les médias sources, les fichiers de projet, les fichiers d'échange et les livrables rendus."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"fr"} -->

Soundscaper utilise différents types de fichiers pour différentes tâches.

## Médias sources

Utilisez **Fichier → Importer** pour l'audio, la vidéo et les étiquettes. L'indice actuel de l'éditeur répertorie
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF et WebM ; des conteneurs vidéo supplémentaires sont pris en charge par la voie d'importation vidéo. La disponibilité peut dépendre
du produit actif et de l'exécution.

L'importation de médias ajoute une source appartenant au projet. Elle ne fait pas du fichier original
votre document de projet éditable.

Les importations et exportations d'audio compressé prennent en charge jusqu'à une heure ou 1 Go
(1 000 000 000 octets de fichier), selon la limite atteinte en premier. Un fichier stéréo 48 kHz d'une heure est pris en charge lorsqu'il respecte cette limite de fichier. Les longues tâches lisent, codent
et enregistrent par morceaux ; les exportations de navigateurs volumineuses nécessitent un stockage de fichiers privé d'origine et suffisamment d'espace libre. Les importations volumineuses nécessitent un stockage local persistant
pour l'audio décodé. Les formats PCM conservent leurs limites distinctes.

Le niveau du navigateur couvre MP3, MP2, FLAC, WavPack, Opus et Ogg Vorbis. La prise en charge du navigateur AAC/M4A dépend du codec du navigateur. Les exportations de streaming de bureau couvrent
les six formats intégrés, avec FLAC 24 bits et WavPack sans perte float32. Les importations de bureau dépendent de la disponibilité du décodeur natif ; MP2 utilise le niveau de compatibilité utilitaire
plus petit. Les fournisseurs AAC et de compatibilité de bureau conservent leurs
limites distinctes.

Une tâche active affiche une barre de progression même lorsque **Affichage → Barre d'état** est masqué. Choisissez **Annuler** à côté de la barre pour arrêter une importation ou une exportation audio.

## Fichiers de projet éditable

- Scape (`.sscape` depuis Soundscaper, `.fscape` depuis Framescaper, et l'un ou l'autre pouvant être ouvert dans les deux) est le format de projet portable à pleine fidélité partagé par Soundscaper
et Framescaper.
- AUP4 est un échange audio uniquement avec Audacity. Il ne s'agit pas d'une sauvegarde complète d'un
projet multimédia Soundscaper.

Consultez [Fichiers de projet](/projects-and-data/project-files/) pour les conséquences
de chaque choix.

## Livraisons rendues

Les exportations audio créent des fichiers destinés à l'écoute, à la publication ou à un traitement ultérieur. Les exportations vidéo créent des livraisons MP4 ou WebM. Un fichier rendu ne
retient pas la chronologie éditable, le routage, les effets ou l'historique du projet.

Consultez la section [référence](/reference/) pour les tableaux de formats générés et
capacités de produits.

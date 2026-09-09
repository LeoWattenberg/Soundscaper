---
title: "Importation et exportation"
description: "Distinguez les médias sources, les fichiers de projet, les fichiers d'échange et les livrables rendus."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd6f45277d29c1bf8e2d17b2265b46483362e3c945300ee8420ac6676ca7d878","targetLocale":"fr"} -->

Soundscaper utilise différents types de fichiers pour différentes tâches.

## Médias sources

Utilisez **Fichier → Importer** pour l'audio, la vidéo et les étiquettes. L'indice de l'éditeur actuel liste
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF et WebM ; des conteneurs vidéo supplémentaires sont pris en charge par le chemin d'importation vidéo. La disponibilité peut dépendre
du produit actif et de l'exécution.

L'importation de médias ajoute une source appartenant au projet. Elle ne fait pas du fichier original
votre document de projet éditable.

## Fichiers de projet éditables

- Scape (`.sscape` depuis Soundscaper, `.fscape` depuis Framescaper, et l'un ou l'autre ouvrable dans les deux) est le format de projet portable, à pleine fidélité partagé par Soundscaper
  et Framescaper.
- AUP4 est un échange audio uniquement avec Audacity. Ce n'est pas une sauvegarde complète d'un
  projet multimédia Soundscaper.

Consultez [Fichiers de projet](/projects-and-data/project-files/) pour les conséquences
de chaque choix.

## Livraisons rendues

Les exportations audio créent des fichiers destinés à l'écoute, à la publication ou à un traitement ultérieur. Les exportations vidéo créent des livraisons MP4 ou WebM. Un fichier rendu
ne conserve pas la chronologie éditable, le routage, les effets ou l'historique du projet.

Consultez la section [référence](/reference/) pour les tableaux de formats générés et
capacités des produits.

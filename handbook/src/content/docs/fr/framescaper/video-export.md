---
title: "Exporter la vidéo"
description: "Valider la séquence composée et créer une livraison en MP4 ou WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"9225d2aa1e6da43167a90718eea5097dd9f9d42790aaee2795a3d7d74452b72e","targetLocale":"fr"} -->

## Avant l'exportation

- Parcourez la séquence complète et chaque limite de montage.
- Vérifiez que les pistes visibles et en mode solo produisent l'image souhaitée.
- Assurez-vous que l'audio lié reste synchronisé.
- Confirmez la plage d'exportation et si les sous-titres ou l'audio doivent être inclus.

## Créer le fichier

Ouvrez la boîte de dialogue d'exportation et sélectionnez un format vidéo. Framescaper prend en charge la livraison MP4 et
WebM via le runtime vidéo configuré. Choisissez les dimensions,
le taux d'images par seconde et les autres options appropriées pour la destination.

Le codage vidéo est plus gourmand en ressources que la lecture ordinaire de la chronologie.
Gardez l'éditeur ouvert jusqu'à ce que l'exportation signale sa complétion.

## Vérifier la livraison

Ouvrez le fichier exporté dans un lecteur séparé. Vérifiez sa durée, les premières et dernières
images, l'orientation de l'image, la synchronisation audio et les sous-titres attendus.

La vidéo rendue ne peut pas remplacer le projet éditable. Exportez également une copie `.fscape`
lorsque vous devez conserver la chronologie et les médias du projet.

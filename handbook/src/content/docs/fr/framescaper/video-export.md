---
title: "Exporter la vidéo"
description: "Valider la séquence composée et créer une livraison en MP4 ou WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"fr"} -->

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

## Exporter séparément les clips audio {#export-audio-clips}

Choisissez **Fichier → Exporter la vidéo**, sélectionnez un format audio tel que **WAV**, puis définissez **Sortie** sur **Clips individuels (séparés par clip)**. L’export télécharge une archive contenant un fichier pour chaque clip audio. Les clips vidéo sont exclus ; chaque fichier audio ne contient que son clip, avec ses coupes et modifications.

Les fichiers commencent au début audible du clip, sans remplissage jusqu’à sa position dans le projet ni queue d’effet. Les préfixes numérotés distinguent les clips portant le même nom.

Les effets de piste sont inclus ; les effets principaux, la sourdine et le solo n’ont aucun effet sur cet export. Consultez le flux audio commun dans [Exporter les clips en fichiers séparés](/soundscaper/edit-mix-and-export/#export-clips).

## Vérifier la livraison

Ouvrez le fichier exporté dans un lecteur séparé. Vérifiez sa durée, les premières et dernières
images, l'orientation de l'image, la synchronisation audio et les sous-titres attendus.

La vidéo rendue ne peut pas remplacer le projet éditable. Exportez également une copie `.fscape`
lorsque vous devez conserver la chronologie et les médias du projet.

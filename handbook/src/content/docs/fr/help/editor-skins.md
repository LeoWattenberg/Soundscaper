---
title: "Thèmes de l'éditeur"
description: "Choisissez un thème visuel ou essayez-en un temporairement via une URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"fr"} -->

Les skins modifient les couleurs, les polices, les bordures et les arrière-plans décoratifs de l'éditeur.
Ils sont disponibles dans Soundscaper et Framescaper. Chaque produit mémorise son
propre choix. Les espaces de travail continuent de contrôler l'agencement des panneaux et des outils.

## Choisir une skin {#choose-a-skin}

Ouvrez **Édition → Préférences → Apparence** et sélectionnez une skin :

- **Par défaut** conserve la conception originale de l'éditeur.
- **Sakura** combine des fleurs de cerisier, des accents roses et une typographie arrondie.
- **Lilac** utilise des violets froids et des textures violettes superposées.
- **Techno** combine des graphiques de circuits bleus avec une typographie monospace.

Choisissez **Clair**, **Sombre** ou **Suivre le thème du système** séparément. Chaque skin a
des versions claire et sombre. Le **Style de clip** reste un choix distinct ; la
palette Colorful est coordonnée avec chaque skin tout en conservant les couleurs des clips distinctes.

Le contraste élevé prime sur la décoration de la skin. Désactiver le contraste élevé
restaure la skin sélectionnée. Changer de skin ne modifie jamais l'audio des clips, le contenu du
projet ou la disposition de l'espace de travail.

## Essayer une skin via un lien {#try-a-skin-from-a-link}

Ajoutez `?useskin=sakura` à une URL d'éditeur pour prévisualiser temporairement Sakura. Utilisez
`default`, `sakura`, `lilac`, ou `techno` comme valeur. Si l'URL a déjà un
paramètre de requête, ajoutez `&useskin=sakura` à la place. Une valeur inconnue est ignorée.

Une prévisualisation d'URL ne remplace pas votre skin enregistrée, même si vous modifiez une autre
préférence. Recharger l'URL de prévisualisation maintient la prévisualisation ; accéder sans le
paramètre utilise votre choix enregistré. Le paramètre ne choisit pas clair ou sombre.

Dans **Préférences → Apparence**, choisissez **Conserver cette skin** pour enregistrer la prévisualisation,
ou **Terminer la prévisualisation** pour revenir à votre skin enregistrée. Sélectionner n'importe quelle skin enregistre
également ce choix et met fin à la prévisualisation. Ces actions suppriment uniquement le paramètre de skin
de l'URL actuelle, sans recharger l'éditeur.

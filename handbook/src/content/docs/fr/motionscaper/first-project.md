---
title: "Votre premier projet Motion"
description: "Créez une composition, animez un calque et exportez un projet enregistré."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"fr"} -->

## Créer et ajouter un calque {#create-and-add-a-layer}

1. Choisissez **Fichier → Nouvelle composition** et saisissez un titre, des dimensions,
   une fréquence d’images et une durée en images.
2. Choisissez **Calque → Nouveau texte** ou **Calque → Nouvelle couleur unie**.
   Choisissez la composition cible lorsque le projet contient plusieurs compositions.
3. Ouvrez **Calque → Texte et apparence** pour modifier un calque de texte existant
   ou les remplissages et contours d’une forme. Les polices importées ici sont conservées avec le projet.

Utilisez **Fichier → Importer des médias** pour les sources d’image, de vidéo ou
d’audio. Un import dépassant les limites actuelles du décodeur ou de la mémoire
est refusé avec une explication ; le fichier source d’origine reste intact.

## Animer et prévisualiser {#animate-and-preview}

Ouvrez **Calque → Propriétés et images clés** pour choisir une propriété de calque
et ajouter des clés à des positions d’image exactes. Les commandes de courbe
changent l’interpolation ; le montage spatial modifie les trajectoires de position.
**Affichage → Chronologie** ouvre les commandes de synchronisation, d’ordre,
de groupement et de zone de travail des calques.

Ouvrez **Affichage → Canevas de composition** pour sélectionner et déplacer un
calque 2D statique. Le carré le redimensionne et le cercle le fait pivoter autour
de son ancrage défini. Chaque glissement terminé est une étape d’annulation ;
Échap annule un glissement. Les transformations animées et pilotées par expression
restent dans Propriétés et images clés.

Ouvrez **Affichage → Aperçu de composition** pour vous déplacer dans la composition
ou la lire. L’aperçu utilise les médias source conservés. Les réglages de scène
non pris en charge ou invalides produisent une erreur plutôt qu’une image de
substitution. Fermez l’aperçu pour libérer ses ressources de rendu actives.

## Enregistrer une copie portable {#save-a-portable-copy}

Choisissez **Fichier → Enregistrer** pour publier la révision actuelle, puis
**Fichier → Enregistrer une copie** pour télécharger une archive `.mscape`.
L’archive inclut le projet et les médias d’origine nécessaires à sa réouverture.
Ouvrez-la avec **Fichier → Ouvrir** sur un autre appareil ou depuis une nouvelle
bibliothèque de navigateur.

## Rendu {#render}

Choisissez **Fichier → Rendu**. Sélectionnez une composition, un format de sortie
et une plage d’images. L’image de fin est exclue : les images 0 à 29 utilisent
la plage de `0` à `30`. Une zone de travail fractionnaire sélectionne les instants
d’échantillonnage entiers qu’elle contient ; une zone sans échantillon de sortie
doit être modifiée avant le rendu.

Utilisez **Séquence PNG transparente (.tar)** pour l’alpha. Extrayez l’archive
TAR pour obtenir les images PNG normales et les métadonnées temporelles.
MP4 et WebM utilisent la couleur de fond choisie dans la boîte de dialogue.
Le rendu fixe la révision soumise pour que les modifications ultérieures ne
changent pas une sortie déjà en cours. Fermer la boîte de dialogue de rendu
laisse sa tâche active. **Fichier → File de rendu** affiche la progression,
l’annulation, la nouvelle tentative de la révision soumise et les téléchargements
terminés. Fermer l’éditeur annule les tâches inachevées.

Revenez au [manuel Motionscaper](/motionscaper/).

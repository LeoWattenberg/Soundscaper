---
title: "Web ou bureau"
description: "Comprendre comment les éditions de navigateur et de bureau empaquetées stockent les projets et accèdent aux fichiers."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"fr"} -->

Les deux éditions traitent les projets localement. Leur stockage et l'accès aux fichiers diffèrent.

## Éditeur web

L'édition navigateur stocke les projets, les enregistrements et les médias importés dans le stockage privé d'origine du navigateur. Il ne télécharge pas de projet sur un compte Soundscaper et aucun compte n'est requis.

Utilisez l'éditeur web lorsque vous souhaitez un accès immédiat sans installer d'application. N'oubliez pas que le stockage du navigateur reste soumis aux règles de quota et d'éviction du navigateur. La suppression des données du site supprime la bibliothèque de projets locaux.

## Aperçu de bureau

Les aperçus de bureau empaquetés conservent une bibliothèque locale autosauvée à l'intérieur de l'application de bureau. Ils regroupent le runtime de l'éditeur et les traductions publiées pour l'édition hors ligne.

Les packages de bureau sont non signés. macOS applique uniquement le sceau de code ad-hoc sans identité dont son chargeur a besoin pour exécuter Electron et les binaires natifs ; ce sceau ne fait aucune revendication de confiance ou d'éditeur. Par conséquent, Windows SmartScreen ou macOS Gatekeeper peuvent afficher un avertissement d'éditeur inconnu pour les packages d'aperçu et stables.

L'ouverture d'un fichier `.aup4` importe un projet indépendant dans la bibliothèque de bureau. Les modifications ultérieures ne réécrivent pas le fichier ouvert. **Enregistrer** met à jour la copie de la bibliothèque ; **Enregistrer sous** crée un nouveau fichier d'échange Audacity.

## Téléphones et tablettes

L'éditeur web conserve sa mise en page de bureau sur tous les écrans, mais en dessous de 900px de largeur (un téléphone ou une tablette tenue verticalement), il replie la barre d'outils dans des tiroirs pour que la chronologie conserve l'espace :

- Le bouton **Menu** en haut à gauche ouvre un tiroir avec le menu complet de l'application, les onglets de projet, la barre d'action et la barre d'outils des outils. Lecture, arrêt, enregistrement et recherche restent dans la barre. Le choix d'une commande ferme le tiroir.
- Les en-têtes de piste glissent sur les voies depuis le gestionnaire d'en-têtes de piste dans le coin supérieur gauche de la chronologie, ou depuis **Affichage › En-têtes de piste**. Appuyer sur les voies ou sur la touche Échap les range à nouveau.
- L'introduction au-dessus de l'éditeur est repliée par défaut sur les écrans étroits ; **Afficher l'introduction** la fait réapparaître.

**Édition › Préférences › Apparence › Mise en page** permet de basculer entre Automatique, Compact et Bureau, de sorte qu'une petite fenêtre sur un bureau peut conserver la barre d'outils de bureau et une tablette large peut opter pour les tiroirs.

## Les projets ne bougent pas automatiquement

Les bibliothèques de navigateurs et de bureaux sont séparées. Déplacez un projet délibérément :

- Utilisez un fichier de projet Soundscaper - `.sscape`, Framescaper - `.fscape` pour l'ensemble du projet.
- Utilisez AUP4 lorsque vous avez spécifiquement besoin d'un échange audio avec Audacity.
- Exportez l'audio ou la vidéo rendu(e) comme copie de lecture durable.

Consultez [Fichiers de projet](/projects-and-data/project-files/) avant de supprimer les données du site du navigateur ou les données de l'application de bureau.
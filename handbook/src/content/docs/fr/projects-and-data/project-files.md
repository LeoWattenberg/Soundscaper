---
title: "Fichiers de projet"
description: "Choisissez entre la bibliothèque locale, les fichiers de projet Scape, AUP4 et les sauvegardes rendues."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"fr"} -->

## Bibliothèque locale du projet

L'éditeur enregistre les projets en cours dans sa bibliothèque locale. Dans un navigateur, il s'agit d'un stockage privé d'origine ; dans l'édition de bureau, il s'agit de données d'application. Il s'agit de la copie de travail pratique, et non de la seule copie que vous devriez conserver.

## Fichiers de projet Scape

Utilisez **Fichier → Exporter le fichier du projet** pour un projet portable sans perte. Chaque produit écrit son propre suffixe : Soundscaper enregistre `.sscape` et Framescaper enregistre `.fscape`, et l'entrée du menu porte le nom de celui qui s'applique. Le format derrière les deux est le même, c'est donc le choix approprié lorsque vous devez préserver l'état d'édition multimédia.

L'un ou l'autre produit ouvre l'un ou l'autre suffixe. `.sscape`, `.fscape`, le `.liscape` réservé et les fichiers plus anciens `.scape` exportés avant que les produits n'aient leurs propres suffixes s'ouvrent partout, et l'enregistrement d'un d'entre eux à partir d'un produit différent le renomme simplement - par exemple, un `Mix.sscape` enregistré à partir de Framescaper devient `Mix.fscape`. Rien dans le projet ne change avec le nom.

L'importation ou l'ouverture d'une copie Scape peut rencontrer un projet existant avec le même ID. Utilisez le flux de copie proposé lorsque les deux versions doivent rester dans la bibliothèque locale.

## AUP4

AUP4 existe pour un échange audio compatible avec Audacity. L'exportation produit un rapport de compatibilité décrivant les conversions, les effets indisponibles et l'état Soundscaper-only omis.

AUP4 est uniquement audio. La vidéo est omise, et les préférences du navigateur, l'historique d'annulation, le routage du mixeur et la bibliothèque de projets du navigateur ne sont pas transférés. N'utilisez pas AUP4 comme seule sauvegarde d'un projet Soundscaper ou Framescaper.

## Sauvegarde rendue

Pour un travail important, conservez les deux éléments suivants :

1. Une copie du projet Scape (`.sscape` ou `.fscape`) pour une future édition.
2. Un fichier audio ou vidéo rendu qui peut être joué sans l'éditeur.

Conservez ces fichiers en dehors du répertoire de données du navigateur ou de l'application.
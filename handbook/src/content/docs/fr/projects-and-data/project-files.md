---
title: "Fichiers de projet"
description: "Choisissez entre la bibliothèque locale, les fichiers Scape, l’échange Audacity, l’import SESX et les sauvegardes rendues."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"fr"} -->

## Bibliothèque locale du projet

L'éditeur enregistre les projets en cours dans sa bibliothèque locale. Dans un navigateur, il s'agit d'un stockage privé d'origine ; dans l'édition de bureau, il s'agit de données d'application. Il s'agit de la copie de travail pratique, et non de la seule copie que vous devriez conserver.

## Fichiers de projet Scape

Utilisez **Fichier → Exporter le fichier du projet** pour enregistrer le projet de montage. Chaque produit écrit son propre suffixe : Soundscaper enregistre `.sscape` et Framescaper enregistre `.fscape`, et l'entrée du menu porte le nom de celui qui s'applique. Le format derrière les deux est le même, c'est donc le choix approprié lorsque vous devez préserver l'état d'édition multimédia.

Sur ordinateur, les fichiers audio et vidéo importés restent par défaut des références vers leurs fichiers d’origine. Conservez-les à leur emplacement d’origine lorsque vous rouvrez le projet. La bibliothèque locale conserve également des caches de montage. Les enregistrements et les médias générés ou traités sont intégrés, car ils n’ont pas d’original externe inchangé.

Choisissez **Fichier → Gestion du projet → Consolider les médias** pour intégrer les médias référencés dans le fichier du projet. La consolidation enregistre immédiatement le projet ; choisissez une destination dans la boîte de dialogue d’enregistrement. Une fois enregistré, le projet consolidé peut être déplacé ou partagé sans les fichiers médias d’origine. Si des médias ne peuvent pas être consolidés ou si l’enregistrement échoue, l’éditeur signale le problème.

Les exportations du navigateur intègrent automatiquement leurs médias. Avant d’ouvrir dans un navigateur un projet de bureau avec des références externes, consolidez-le sur ordinateur.

L'un ou l'autre produit ouvre l'un ou l'autre suffixe. `.sscape`, `.fscape`, le `.liscape` réservé et les fichiers plus anciens `.scape` exportés avant que les produits n'aient leurs propres suffixes s'ouvrent partout, et l'enregistrement d'un d'entre eux à partir d'un produit différent le renomme simplement - par exemple, un `Mix.sscape` enregistré à partir de Framescaper devient `Mix.fscape`. Rien dans le projet ne change avec le nom.

L'importation ou l'ouverture d'une copie Scape peut rencontrer un projet existant avec le même ID. Utilisez le flux de copie proposé lorsque les deux versions doivent rester dans la bibliothèque locale.

## Audacity AUP3 et AUP4

L’exportation d’un projet Audacity est disponible dans **Fichier → Exporter autre**. Choisissez **Exporter AUP3** pour le profil de projet Audacity 3.7.9 ou **Exporter AUP4** pour le profil d’échange Audacity actuel. Chaque export produit un rapport de compatibilité qui décrit les conversions, les effets indisponibles et les éléments propres à Soundscaper omis.

Les deux formats sont uniquement audio. La vidéo est omise, de même que les préférences du navigateur, l’historique d’annulation, le routage du mixeur et la bibliothèque de projets du navigateur. N’utilisez aucun des deux comme seule sauvegarde d’un projet Soundscaper ou Framescaper.

## Adobe Audition SESX

Dans l’édition de bureau, utilisez **Fichier → Ouvrir** pour importer une session Adobe Audition `.sesx`. Conservez les fichiers audio référencés dans leur arborescence relative sous le dossier de la session, ou choisissez un dossier média lorsque vous y êtes invité. L’importation crée un nouveau projet local avec les pistes audio, les clips, leur placement, les coupes, les fondus simples et les réglages statiques de mixage pris en charge.

L’import SESX est à sens unique. Les effets Audition, l’automatisation, le routage, la vidéo, les marqueurs, les boucles, l’étirement, les fondus enchaînés liés et les courbes exactes de fondu ne sont pas transférés. Après l’importation, ouvrez **Fichier → Rapport de livraison** pour vérifier les médias manquants et les autres éléments omis. Conservez le fichier SESX et les médias d’origine pour poursuivre le travail dans Audition.

## Sauvegarde rendue

Pour un travail important, conservez les deux éléments suivants :

1. Une copie du projet Scape (`.sscape` ou `.fscape`) pour une future édition.
2. Un fichier audio ou vidéo rendu qui peut être joué sans l'éditeur.

Conservez ces fichiers en dehors du répertoire de données du navigateur ou de l'application.
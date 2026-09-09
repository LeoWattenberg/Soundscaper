---
title: "Stockage, sauvegardes et confidentialité"
description: "Comprendre le stockage local-first et protéger les projets contre la perte de navigateur ou d'appareil."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"fr"} -->

## Ce que signifie l'approche locale en premier

Les projets, les enregistrements et les médias importés sont traités et stockés sur votre
appareil. L'éditeur ne nécessite pas de compte ou de synchronisation de projets vers un
service Soundscaper.

Sur le web, l'audio et les médias utilisent le système de fichiers d'origine privé du navigateur lorsque
cela est possible, avec des replis sur IndexedDB. Soundscaper demande un stockage persistant,
mais le navigateur décide d'accorder ou non l'accès.

## Ce qui peut supprimer un projet

- La suppression des données du site efface la bibliothèque de projets locale du navigateur.
- Les contextes de navigateur privés ou restreints peuvent se replier sur la mémoire temporaire.
- Les quotas et les politiques d'expulsion du navigateur restent autoritaires.
- La suppression manuelle des données de l'application de bureau retire sa bibliothèque locale.
- Une défaillance de l'appareil ou du stockage peut supprimer toutes les copies locales sur cet appareil.

La désinstallation d'une version empaquetée de l'application de bureau est conçue pour préserver sa bibliothèque, mais
cela ne constitue pas une stratégie de sauvegarde.

## Routine de sauvegarde

À des étapes utiles et avant de vider ou de migrer le stockage:

1. Attendez que la sauvegarde locale soit terminée.
2. Exportez un fichier de projet Scape (`.sscape` ou `.fscape`).
3. Exportez et lisez une livraison rendue.
4. Copiez les deux vers un stockage en dehors des données locales de l'éditeur.

Utilisez également AUP4 lorsque l'interopérabilité avec Audacity est nécessaire, en complément de
la copie du projet Scape, et non à sa place.

## Confidentialité du site de documentation

Ce manuel est servi sous forme de fichiers statiques et utilise la recherche locale du navigateur. Le site V1
ne ajoute pas de service d'analyse ou de backend AI/search.

La politique complète de confidentialité de [Soundscaper et Framescaper](https://soundscaper.org/privacy/en/)
couvre également la livraison de l'application, les autorisations d'appareil, les téléchargements optionnels,
les vérifications de mise à jour de bureau et les connexions Framescaper Web VCR.
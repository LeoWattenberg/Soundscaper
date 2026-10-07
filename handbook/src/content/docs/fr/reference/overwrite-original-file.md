---
title: "Remplacer un fichier importé sur ordinateur"
description: "Enregistrez le projet modifié sur le fichier multimédia d’origine dans Soundscaper ou Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"fr"} -->

Dans les versions Electron de Soundscaper et Framescaper, **Fichier → Remplacer le nom du fichier** exporte le projet entièrement modifié vers le fichier multimédia importé à l’origine. La commande reprend les paramètres d’exportation pris en charge par le fichier d’origine et enregistre immédiatement, sans ouvrir la boîte de dialogue d’exportation ni le sélecteur de fichiers. L’audio conserve son format source, sa fréquence d’échantillonnage et son nombre de canaux. Les vidéos MP4 et WebM prises en charge conservent leur conteneur source, leurs dimensions et leur fréquence d’images.

Importez un fichier multimédia avec **Fichier → Importer**, effectuez vos modifications, puis choisissez **Fichier → Remplacer le nom du fichier**. Vous pouvez répéter l’opération après d’autres modifications. Une sélection temporelle ne limite pas le remplacement : le projet entier est toujours rendu. Le projet conserve ses médias importés et son historique de modification.

La commande est indisponible si le projet ne possède aucun fichier d’origine pris en charge, si plusieurs fichiers d’origine ont été importés, ou pendant une importation, un enregistrement ou un traitement. Les versions navigateur utilisent la boîte de dialogue d’exportation habituelle.

Dans Soundscaper, choisissez **Fichier → Exporter l’audio**, ou dans Framescaper **Fichier → Exporter la vidéo**, pour sélectionner une autre destination ou modifier les paramètres de livraison. Le remplacement écrase le contenu du fichier d’origine ; conservez une copie séparée si vous avez besoin de l’enregistrement non modifié.

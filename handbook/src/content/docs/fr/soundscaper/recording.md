---
title: "Enregistrer l'audio"
description: "Accorder la permission d'entrée à l'éditeur, choisir les chemins et protéger une prise terminée."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"fr"} -->

## Préparer l'entrée

1. Ouvrez les contrôles de l'appareil d'enregistrement et choisissez une entrée disponible.
2. Autorisez la permission du microphone ou de la capture lorsque le navigateur le demande.
3. Activez la surveillance de l'entrée si vous devez inspecter le niveau entrant avant
   l'enregistrement.
4. Vérifiez le compteur d'enregistrement et ajustez le niveau de l'appareil ou de l'entrée pour éviter
   la saturation.

La permission du navigateur est limitée au site et à l'appareil. Si aucune entrée n'apparaît,
revoyez à la fois les permissions du système d'exploitation et celles du navigateur.

## Enregistrer une ou plusieurs pistes

Pour un enregistrement normal, utilisez le menu **Enregistrer** ou l'action d'enregistrement de la console de transport.

Pour le routage multipiste, choisissez **Affichage → Activer l'enregistrement multipiste**, arméez
les pistes que vous souhaitez enregistrer et affectez une entrée à chaque piste armée. L'enregistrement
ne démarrera pas si aucune entrée disponible n'est affectée.

Soundscaper expose également des flux de travail d'enregistrement chronométrés, punch/count-in, loop/take, et activés par le son
via ses menus. Commencez par un enregistrement normal avant d'ajouter
ces conditions.

## Après l'enregistrement

Arrêtez l'enregistrement et écoutez le nouvel extrait avant de continuer. Attendez que le statut du projet
indique que l'enregistrement est terminé. Pour un matériau irremplaçable, exportez une copie audio rendue et un projet `.sscape` plutôt que de vous fier uniquement à la
bibliothèque locale.

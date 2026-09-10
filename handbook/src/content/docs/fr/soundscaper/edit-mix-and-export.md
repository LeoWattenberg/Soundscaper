---
title: "Éditer, mélanger et exporter"
description: "Organiser les clips, équilibrer les pistes, appliquer des effets et créer un fichier de livraison."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","targetLocale":"fr"} -->

## Organiser les clips

Sélectionnez des clips ou une plage temporelle avant de choisir une commande d'édition. L'opération « Split » crée une limite d'édition à la position du curseur de lecture. Les variantes « Gap-preserving » et « ripple » déterminent si le matériel ultérieur reste en place ou se déplace pour combler la zone supprimée.

Utilisez les dossiers de pistes, les groupes de clips et le Project Bin pour organiser les projets de grande envergure.

### Ajuster les fondues des clips {#clip-fades}

Sélectionnez un clip audio pour révéler de petites poignées triangulaires le long du haut de son onde, juste en dessous de l'en-tête du clip.
Faites glisser le triangle de gauche vers l'intérieur pour un fondu d'entrée, ou le triangle de droite vers l'intérieur pour un fondu de sortie. L'onde change à mesure que vous faites glisser, et la zone au-dessus de la courbe de fondu devient plus sombre. Les triangles suivent les limites de fondu ; faire glisser l'un d'eux vers son coin supprime ce fondu. Seul le clip que vous faites glisser est modifié, même si plusieurs clips sont sélectionnés.

Les poignées disparaissent lorsque vous désélectionnez le clip, mais l'onde en fondu et l'ombrage restent visibles. Ces fondues préservent l'audio d'origine et restent ajustables après l'enregistrement et la réouverture du projet. Relâchez pour valider un fondu, ou appuyez sur **Échap** pendant le glissement pour annuler. **Annuler** inverse un glissement complet. La lecture et l'exportation utilisent les paramètres de fondu validés.

Avec un clip sélectionné et focalisé, appuyez sur **Tab** pour accéder à ses poignées de fondu. Les touches fléchées ajustent la durée par incréments de 10 millisecondes, ou de 100 millisecondes avec **Maj**. **Début** supprime le fondu ; **Fin** l'étend sur l'ensemble du clip.
Pour une saisie numérique, choisissez **Édition → Clips audio → Propriétés du clip** et utilisez **Fondues**.

## Construire le mixage

Utilisez les contrôles de gain de piste, de panoramique, de sourdine et de solo pour équilibrer le projet. Le panneau Mixer expose le même état du projet dans une disposition orientée mixage. Les effets en temps réel restent ajustables ; les opérations destructives ou rendues créent des modifications du projet qui peuvent être annulées tant que l'historique est disponible.

Utilisez le compteur de lecture et l'analyse de la sonorité pour inspecter le résultat. Évitez de considérer une cible de compteur comme un substitut à l'écoute de l'exportation complète.

### Réduire la sibilance {#reduce-sibilance}

Choisissez **Effet → Suppression et réparation du bruit → Dé-esser**. Réglez **Fréquence** près de la partie agressive de la voix, puis abaissez **Seuil** jusqu'à ce que les sibilantes s'adoucissent.
**Réduction maximale** limite la coupure ; commencez autour de 6 à 9 dB. Une **Attaque** plus courte capte le début d'une consonne, tandis que **Relâchement** contrôle la rapidité avec laquelle les hautes fréquences se rétablissent. Seule la bande supérieure est réduite.

### Compresser des bandes de fréquences séparées {#multiband-compression}

Choisissez **Effet → Volume et compression → Compresseur multibande**. Les deux filtres passe-haut divisent le signal en bandes basses, moyennes et hautes. Chaque bande a son propre seuil, sa propre ratio et son propre gain de sortie. Une ratio de 1 laisse la dynamique de cette bande inchangée. L'attaque et le relâchement s'appliquent aux trois bandes. Les filtres ont des pentes douces et chevauchantes de 6 dB/octave ; avec toutes les ratios à 1 et les gains de bande à 0 dB, le signal d'origine passe sans modification.

Les deux effets lient leurs canaux pour préserver l'équilibre stéréo et sont également disponibles dans les racks d'effets de piste et maîtres. Les paramètres du rack sont enregistrés avec le projet et peuvent être ajustés pendant la lecture. **Appliquer à la sélection** rend l'effet dans l'audio sélectionné et prend en charge l'annulation. L'automatisation de la chronologie n'est pas disponible pour ces deux effets.

## Exportation

Choisissez **Fichier → Exporter l'audio** pour une livraison mixée ou **Exporter l'audio sélectionné** si seule une sélection doit être rendue. Soundscaper peut également exporter les tiges et les étiquettes.

Les formats compressés utilisent le runtime FFmpeg. Les formats exacts et la disponibilité conditionnelle sont répertoriés dans la [référence des formats générée](/reference/).

Jouez le fichier exporté dans une autre application avant de livrer ou de supprimer le matériel source.

Pour le travail vidéo — composition d'une séquence, effets vidéo et livraison MP4 ou WebM — confiez le projet à [Framescaper](/framescaper/) et consultez
[exporter la vidéo](/framescaper/video-export/).

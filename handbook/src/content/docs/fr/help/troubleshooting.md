---
title: "Dépannage"
description: "Résoudre les problèmes courants de capture, de stockage, d'importation et d'exportation."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"fr"} -->

## Une entrée d'enregistrement est manquante

Vérifiez les autorisations du microphone du système d'exploitation et du navigateur, puis rouvrez le
sélecteur d'appareil. Pour l'enregistrement multitrack, assurez-vous que chaque piste armée dispose d'une
affectation d'entrée disponible.

## Une commande est désactivée

De nombreuses commandes dépendent de l'état actuel. Sélectionnez le projet, la piste, le
clip ou la plage de temps requise et réessayez. Une fonctionnalité peut également être limitée
intentionnellement à Soundscaper ou Framescaper.

## Un import utilise trop de mémoire

Le décodage compressé et certaines opérations de grande taille peuvent nécessiter une mémoire
temporaire importante, même si l'audio du projet stocké est découpé en blocs. Fermez les onglets ou
applications non liés, réessayez avec une source plus petite ou utilisez l'édition de bureau le cas
échéant.

## Un projet a disparu du navigateur

Confirmez que vous avez ouvert le même profil de navigateur, l'origine et le site du produit.
Soundscaper et Framescaper partagent la bibliothèque sur la même `soundscaper.org`
origine, mais un autre domaine, profil de navigateur ou magasin de site effacé a une
bibliothèque différente.

Si les données du site ont été effacées et qu'aucune exportation de projet Scape n'existe, l'éditeur n'a pas de copie
cloud à restaurer.

## AUP4 a omis une partie du projet

Lisez le rapport de compatibilité. AUP4 transporte l'état d'édition audio compatible mais
omet la vidéo et peut convertir ou omettre les effets et l'état de mixage exclusif à Soundscaper.
Utilisez un fichier de projet Scape — `.sscape` ou `.fscape`, qui s'ouvrent tous deux dans l'un ou l'autre produit — pour un transfert complet du projet.

## Un export échoue ou ne se lit pas

Réessayez après avoir confirmé que la plage sélectionnée contient du matériel lisible. Pour
l'audio ou la vidéo compressés, vérifiez que les actifs d'exécution peuvent être chargés. Après un
export réussi, testez le fichier réel dans un autre lecteur.

Pour les problèmes non résolus, utilisez **Aide → Assistance** pour contacter le mainteneur et
incluez le produit, la plateforme, la version navigateur ou bureau, les étapes et l'erreur exacte.

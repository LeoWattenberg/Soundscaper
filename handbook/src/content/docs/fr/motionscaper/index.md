---
title: "Motionscaper"
description: "Créez des compositions animées et conservez localement des projets d’animation modifiables."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"fr"} -->

Motionscaper est l’éditeur d’animations graphiques de la famille Scaper. Un projet
contient des compositions, des calques, des animations et des médias conservés.
L’extension de son fichier de projet est `.mscape`.

Il s’agit d’une version de développement. Travaillez sur une copie des sources
importantes et gardez les archives de projet exportées avec votre bibliothèque de travail.

## Commencer une composition {#start-a-composition}

Choisissez **Fichier → Nouvelle composition**. Le menu **Calque** ouvre les outils
de texte, de forme, d’animation, de composition, de suivi, d’expression et de scène
3D. **Affichage → Aperçu de composition** ouvre la lecture ; les nouvelles surfaces
de montage apparaissent lorsque vous les choisissez dans un menu.

Choisissez **Affichage → Canevas de composition** pour sélectionner, déplacer,
redimensionner ou faire pivoter les calques par des transformations 2D statiques.
Les transformations animées restent modifiables dans les outils de propriétés et
de chronologie.

Dans **Affichage → Chronologie**, sélectionnez des calques existants pour les
renommer, les activer, les désactiver ou les retirer. Le renommage préserve les
références de propriétés et l’animation. Retirer un calque conserve ses médias
d’origine ; incluez ses calques dépendants ou détachez d’abord leurs liens.
**Annuler** restaure les calques retirés. Un calque de métrage sélectionné propose
aussi une case audio lorsque sa source conservée contient de l’audio.

Suivez [votre premier projet Motion](/motionscaper/first-project/) pour créer,
animer, enregistrer et rendre une composition.

## Enregistrer et livrer {#save-and-deliver}

**Fichier → Enregistrer** publie une révision enregistrée. **Enregistrer une copie**
exporte l’instantané actuel sous forme d’archive `.mscape` sans publier de nouvelle
révision enregistrée. Les médias et polices d’origine importés accompagnent
l’archive. La **Bibliothèque de projets** ouvre les projets conservés sur cet appareil.

**Fichier → Rendu** propose des images PNG transparentes dans une archive TAR,
une vidéo MP4 ou WebM opaque et ProRes 4444 lorsque l’encodeur de bureau est
disponible. Les séquences PNG excluent l’audio. La vidéo du navigateur conserve
l’audio défini lorsque son encodeur prend en charge le format demandé. Le ProRes
natif indique la précision effective des couleurs et de l’alpha dans la boîte de
dialogue de rendu. **Fichier → File de rendu** garde les tâches disponibles après
la fermeture de la boîte de dialogue et les changements de projet. Elle conserve
jusqu’à huit tâches et 128 MiB de téléchargements navigateur ; chaque
téléchargement est limité à 64 MiB. Choisissez une destination fichier en continu
pour les sorties plus grandes et retirez les tâches terminées pour libérer les
téléchargements conservés. Si le nettoyage d’une sortie native échoue, utilisez
**Réessayer le nettoyage de la sortie** dans cette file. La tâche garde sa
destination jusqu’à la réussite du nettoyage ; vous pouvez alors la retirer ou
réessayer la révision soumise avec une nouvelle destination.

## Lier à Framescaper {#link-to-framescaper}

Les compositions liées nécessitent la branche de développement distincte
Framescaper 1.1. Dans sa boîte de dialogue **Fichier → Compositions liées**, créez
une URL d’association. Collez-la dans la boîte de dialogue **Fichier → Envoyer la
composition à Framescaper** de Motionscaper, connectez-vous et gardez les éditeurs
et les fenêtres de passerelle ouverts. Les opérations **Enregistrer** ultérieures
envoient automatiquement les nouvelles révisions ; **Enregistrer une copie** ne le fait pas.

Framescaper conserve chaque révision acceptée et tous les médias dont elle dépend
pour une utilisation hors ligne. Annuler fixe une révision précédente jusqu’à la
reprise des mises à jour. Les changements de taille de sortie, de synchronisation
ou de grille audio nécessitent un examen explicite de conformité. Le récepteur
de bureau peut aussi surveiller un fichier `.mscape` enregistré que vous sélectionnez.

## Rechercher des mises à jour de bureau {#check-desktop-updates}

Choisissez **Aide → Rechercher des mises à jour** dans l’application de bureau.
Cette vérification manuelle recherche les versions compatibles de Motionscaper
dans le dépôt GitHub du projet. Les versions préliminaires peuvent recevoir des
versions préliminaires plus récentes ; les versions stables reçoivent des versions
stables. Choisissez **Voir la version** pour ouvrir la page de version vérifiée.
Cette vérification ne télécharge ni n’installe de mise à jour. Les versions pour
navigateur n’incluent pas cette commande de menu.

## Échange avec After Effects {#after-effects-exchange}

**Fichier → Passerelle After Effects** fournit des scripts lisibles et permet
d’examiner les données d’échange prises en charge avant l’import. Les fichiers
`.aep` et `.aepx` s’ouvrent avec une installation d’After Effects et les scripts
de passerelle. La passerelle de développement n’a pas encore été validée avec
After Effects installé. Examinez son rapport ; les réglages de scène non pris en
charge et les médias d’origine restent conservés dans le projet.

La boîte de dialogue propose des options d’import et d’export distinctes pour
les expressions scalaires d’opacité prises en charge utilisant l’arithmétique,
le temps de composition, la valeur avant expression et les fonctions Math
standard. Les deux options sont désactivées au départ. Examinez le nouveau
rapport après avoir changé une option ; les autres formes d’expression exigent
un échantillonnage ou un rendu explicite. Le code source des expressions d’origine
reste dans l’échange conservé ou l’archive `original.mscape`.

Le moteur de rendu prend en charge les couleurs et l’alpha SDR avec des calques
2.5D, des caméras, des lumières, l’échantillonnage d’obturation et la profondeur de
champ. Il ne revendique pas la prise en charge du HDR, des maillages 3D complets,
du masquage avancé par IA ou des plug-ins After Effects arbitraires.

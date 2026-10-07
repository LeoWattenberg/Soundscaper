---
title: "Traitement local, modèles et plug-ins"
description: "Trouvez une assistance locale par tâche et gérez les modèles et les plug-ins dans les éditeurs de bureau."
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"fr"} -->

L'assistance locale s'exécute sur votre appareil dans les éditeurs de bureau Soundscaper et Framescaper. Sélectionnez un média, puis choisissez la tâche dans son menu. La boîte de dialogue affiche la sélection, les réglages de la tâche et indique si ses modèles sont installés.

Les versions de bureau n’incluent ni les moteurs de traitement natifs facultatifs ni les poids des modèles. Installez un modèle dans le Gestionnaire de modèles pour télécharger le moteur et les poids nécessaires, puis lancez la tâche sur les médias sélectionnés. La première installation nécessite une connexion réseau ; les traitements suivants s’exécutent localement. Consultez le guide de chaque modèle pour connaître les plateformes prises en charge, la commande de menu et les prérequis.

Consultez les [guides des modèles individuels](/reference/local-models/).

## Trouver une tâche {#find-a-task}

| Menu | Tâches |
| --- | --- |
| Effet → Suppression et réparation du bruit | Améliorer le dialogue, Réduire la réverbération, Nettoyer les mots de remplissage et le silence |
| Effet → Séparation des sources | Séparer le dialogue / la musique / les effets |
| Analyser → Parole | Transcrire et sous-titrer, Identifier les intervenants, Marquer les réactions |
| Analyser → Musique | Détecter les battements et le tempo |
| Analyser → Vidéo | Marquer les coupes |
| Effet → Effets vidéo | Recadrer |
| Édition | Créer des moments forts |
| Générer | Générer un texte éditorial |
| Outils → Rechercher | Recherche indexée, Indexer la transcription, Indexer la vidéo |

Les tâches vidéo appartiennent à Framescaper. Les commandes disponibles dépendent du runtime de bureau et des capacités du produit. L'option alphabétique du menu des effets de Soundscaper trie également les effets de traitement local par nom.

Choisissez **Exécuter localement** pour démarrer le traitement et répondre à la demande de consentement local. Vous pouvez annuler pendant le traitement. Choisissez **Examiner le résultat**, sélectionnez les résultats souhaités, puis choisissez **Appliquer la sélection**. Les modifications de projet acceptées peuvent être annulées. Fermer une tâche n'applique pas ses propositions.

**Outils → Traitement local avancé** conserve les sélecteurs individuels d'opération et de modèle. Les détails techniques des boîtes de dialogue des tâches affichent, si nécessaire, les étapes sous-jacentes et les réglages exacts.

## Gérer les modèles {#manage-models}

Ouvrez **Outils → Gestionnaire de modèles**, ou utilisez **Gérer les modèles** dans une tâche. Le lien de la tâche filtre la liste pour ne conserver que les identifiants de modèles compatibles ; **Afficher tous les modèles** supprime cette restriction. Recherchez par nom ou par tâche et filtrez selon l'état d'installation.

Installez les modèles explicitement. La première installation télécharge aussi tout environnement d’exécution natif partagé manquant dont le modèle a besoin. Les téléchargements affichent leur progression et peuvent être annulés. Lorsque vous revenez à une tâche, ses paramètres sont conservés et la disponibilité des modèles est actualisée ; le traitement ne démarre pas. Développez **Stockage et vérification** pour réparer, nettoyer, déplacer le stockage, consulter les avis de licence et installer hors ligne depuis un dossier. Un modèle installé à partir de fichiers hors ligne a toujours besoin de son environnement correspondant avant la première utilisation.

Consultez les [guides des modèles individuels](/reference/local-models/) pour connaître la fonction de chaque modèle publié, son entrée de menu, la taille du téléchargement, ses prérequis et limites, ainsi que les vérifications d'inférence réelles effectuées par le paquet de bureau nocturne avec tests.

## Gérer les plug-ins et les appareils {#manage-plugins-and-devices}

**Effet → Gestionnaire de plug-ins** répertorie les plug-ins audio dans Soundscaper et les plug-ins OpenFX dans Framescaper. Recherchez ou filtrez la liste, puis sélectionnez un plug-in pour voir ses contrôles de version, d'autorisation et de récupération. **Analyse et réglages** contient les réglages de découverte. La gestion reste accessible lorsque le traitement est désactivé.

Utilisez les plug-ins audio via **Effet → Plug-ins audio**. Les commandes Ajouter/Modifier un effet vidéo de Framescaper restent sous **Effet → Effets vidéo**.

Ouvrez **Édition → Préférences → Réglages audio** pour les appareils audio natifs et les contrôles auxiliaires. **Média** contient les réglages des médias natifs ; **Effets** renvoie vers le gestionnaire de plug-ins et contient le commutateur de découverte des plug-ins. Les autorisations des plug-ins et la récupération après mise en quarantaine nécessitent toujours des actions explicites.

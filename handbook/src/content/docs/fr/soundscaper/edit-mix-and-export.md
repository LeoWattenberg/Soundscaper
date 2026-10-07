---
title: "Éditer, mélanger et exporter"
description: "Organiser les clips, équilibrer les pistes, appliquer des effets et créer un fichier de livraison."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"fr"} -->

## Organiser les clips

Sélectionnez les clips ou une plage temporelle avant de choisir une commande d'édition. Split crée une
limite d'édition à la position de la tête de lecture. Les variantes qui préservent les espaces et les
variantes ripple déterminent si le contenu suivant reste en place ou se déplace pour combler la zone
supprimée.

Utilisez les dossiers de pistes, les groupes de clips et la corbeille du projet pour organiser les
projets volumineux.

### Ajuster les fondus des clips {#clip-fades}

Sélectionnez un clip audio pour faire apparaître de petites poignées triangulaires le long du haut de
sa forme d'onde, juste sous l'en-tête du clip.
Faites glisser le triangle gauche vers l'intérieur pour un fondu d'entrée, ou le triangle droit vers
l'intérieur pour un fondu de sortie. La forme d'onde change pendant le glissement et la zone
au-dessus de la courbe du fondu s'assombrit. Les triangles suivent les limites du fondu ; ramener
l'un d'eux à son angle supprime ce fondu. Seul le clip que vous faites glisser est modifié, même si
plusieurs clips sont sélectionnés.

Les poignées disparaissent lorsque vous désélectionnez le clip, mais la forme d'onde fondue et
l'ombrage restent visibles. Ces fondus préservent l'audio d'origine et restent réglables après
l'enregistrement et la réouverture du projet. Relâchez le bouton pour valider un fondu, ou appuyez sur
**Escape** pendant le glissement pour l'annuler. **Undo** annule un glissement complet. La lecture et
l'exportation utilisent les réglages de fondu validés.

Lorsqu'un clip sélectionné a le focus, appuyez sur **Tab** pour atteindre ses poignées de fondu. Les
touches fléchées règlent la durée par pas de 10 millisecondes, ou de 100 millisecondes avec
**Shift**. **Home** supprime le fondu ; **End** l'étend sur tout le clip. Pour saisir une valeur,
choisissez **Édition → Clips audio → Propriétés du clip** et utilisez **Fondu**.

### Modifier la source d’un clip {#clip-source-properties}

Choisissez **Édition → Clips audio → Propriétés du clip** pour ouvrir l’éditeur de source. L’enregistrement complet apparaît derrière le clip. Faites glisser les bords du clip pour modifier le début de source et la durée tout en conservant le début du clip sur la timeline du projet. Le panneau **Normalisation** contient le gain du clip et les actions de crête et de loudness.

Ouvrez **Hauteur et tempo** et cochez **Lier hauteur et tempo** pour modifier ensemble la vitesse et la hauteur. Un rapport de vitesse de `1` et un changement de hauteur de `0%` ne modifient pas le son. Le rapport `2` accélère la lecture et élève la hauteur d’une octave ; `0.5` la ralentit de moitié et abaisse la hauteur d’une octave. Modifier l’un des réglages liés met l’autre à jour. Désactiver le lien rétablit le réglage indépendant de hauteur tout en conservant le rapport de vitesse actuel.

Faites **Ctrl+clic** sur la forme d’onde pour ajouter un marqueur d’étirement lié à cet échantillon source. Le faire glisser modifie le timing de part et d’autre ; la superposition affiche les deux vitesses de lecture. Les commandes du clip restent propres à chaque clip. Sélectionner l’audio source et lui appliquer un effet met à jour chaque clip qui utilise cette source.

### Modifier les clips dans un tableur {#clip-spreadsheet}

Choisissez **Affichage → Panneaux → Tableur des clips** pour afficher tous les clips du projet. Le panneau s’ouvre sous la timeline. Son menu permet de le déplacer vers un autre ancrage, de le détacher ou de le fermer. Sa taille et son emplacement sont enregistrés avec l’espace de travail. Chaque ligne affiche la piste, la position sur la timeline, le fichier source, le décalage de source, la durée, la hauteur, la vitesse, le gain, les fondus et les options de lecture. Les durées sont en secondes, la hauteur en demi-tons et la vitesse est un rapport : `1` correspond à la vitesse normale et `2` à une vitesse deux fois plus rapide.

Double-cliquez sur une cellule ou sélectionnez-la et appuyez sur **Entrée** pour modifier sa valeur. Appuyez sur **Entrée** pour appliquer la modification ou sur **Échap** pour l’annuler. Les cellules de piste et de source indiquent leurs identifiants réels. Modifiez l’identifiant de piste pour déplacer un clip vers une piste audio existante. Modifiez l’identifiant de source ou saisissez un chemin de fichier local pour remplacer son audio, tout en conservant sa position sur la timeline, sa durée, sa vitesse et son décalage source en secondes. Le nouveau fichier doit contenir la plage source indiquée. **Inversé** et **Retourné** sont des cases à cocher ; sélectionnez-en une et appuyez sur **Espace** pour la changer. Les clips des pistes verrouillées et les clips vidéo sont en lecture seule.

Modifier la durée raccourcit ou prolonge la plage source à partir du décalage actuel. Modifier la vitesse conserve la plage source, sauf si vous collez également une durée. Dissociez ou déliez les clips avant d’y modifier le timing ; modifiez le timing des clips étirés dans l’éditeur de source.

Sélectionnez une cellule, faites glisser la sélection sur une plage ou faites **Maj+clic** sur une autre cellule pour l’étendre. Cliquez sur un numéro de ligne ou un en-tête de colonne pour sélectionner toute la ligne ou la colonne. Utilisez **Ctrl+C** et **Ctrl+V** (**Cmd+C** et **Cmd+V** sur macOS) pour échanger la sélection avec un tableur. Les colonnes sont séparées par des tabulations et les lignes par des retours à la ligne. Le collage commence dans la cellule sélectionnée et met à jour les clips existants. Un collage qui dépasse les lignes existantes est refusé. Avec une sélection, appuyez sur **Échap** ou cliquez dans la zone vide sous le tableau pour la désélectionner. Sans sélection, le collage insère de nouvelles lignes, même dans un projet vide. Les options de lecture sont copiées sous la forme `true` ou `false` et acceptent ces valeurs au collage. Les nouvelles lignes suivent l’ordre des colonnes du tableau et nécessitent un nom de fichier source ou un identifiant source. Un nom de piste existant et unique place le clip sur cette piste ; un nouveau nom crée une piste audio. Les noms de piste vides utilisent le nom de la source. Les cellules numériques vides prennent les valeurs par défaut : position et décalage `0`, vitesse `1`, hauteur et gain `0`, sans fondu. Une durée vide utilise le reste de l’audio à la vitesse demandée.

Le panneau recherche d’abord la source dans le projet, y compris dans la corbeille du projet. Si elle manque, choisissez **Charger les fichiers référencés** et sélectionnez les fichiers audio répertoriés dans la boîte de dialogue. Les chemins sur disque nécessitent aussi cette sélection : coller un chemin n’autorise pas l’application à accéder au fichier. Les fichiers sélectionnés doivent correspondre sans ambiguïté aux noms référencés. Le panneau importe l’audio, vérifie les limites source et les propriétés du clip, puis place les nouveaux clips aux positions indiquées. **Ctrl+Z** (**Cmd+Z** sur macOS) annule un collage complet en une seule étape ; **Ctrl+Maj+Z** (**Cmd+Maj+Z**) le rétablit. Si un collage contient une valeur non valide, les clips ne changent pas.

## Construire le mixage

Utilisez les commandes de gain, de panoramique, de mise en sourdine et de solo des pistes pour
équilibrer le projet. Le panneau Mixer expose le même état du projet dans une disposition orientée
mixage. Les effets en temps réel restent réglables ; les opérations destructives ou rendues créent
des modifications du projet qui peuvent être annulées tant que l'historique est disponible.

Utilisez le vumètre de lecture et l'analyse de la loudness pour examiner le résultat. Ne considérez pas
la cible du vumètre comme un substitut à l'écoute de l'exportation complète.

### Écouter les fréquences sélectionnées {#listen-to-selected-frequencies}

Sélectionnez le passage à écouter. Dans le menu de la piste, choisissez **Visualisation de la piste → Spectrogramme**, puis ouvrez **Options du spectrogramme → Sélectionner une plage de fréquences spectrales**. Saisissez les fréquences minimale et maximale et choisissez **Sélectionner la plage**, ou ajustez les poignées de sélection dans le spectrogramme.

Choisissez **Options de lecture → Lire les fréquences sélectionnées**, ou **Sélectionner → Spectral → Lire les fréquences sélectionnées**. La plage temporelle sélectionnée est lue une fois à vitesse normale, même si une autre vitesse ou la lecture en boucle était activée. Le filtre d’écoute s’applique au mixage actuel, y compris aux réglages de sourdine, de solo, de gain et d’effets. Un rectangle spectral indique la bande de fréquences et la plage temporelle ; il ne met pas la piste en solo. Si la lecture est en cours, la commande la met en pause ; choisissez-la de nouveau pour lancer l’écoute des fréquences.

Les filtres de fréquence en temps réel ont des transitions progressives. Les fréquences hors de la bande sont atténuées, ainsi que celles proches de ses limites. **Pause** ou **Arrêter** supprime le filtre ; la lecture normale suivante utilise donc toute la plage de fréquences. L’audio, les sélections, l’historique d’annulation et les fichiers exportés restent inchangés.

### Réduire les sibilances {#reduce-sibilance}

Choisissez **Effet → Suppression et réparation du bruit → Désibiliseur**. Réglez **Fréquence** près de
la partie agressive de la voix, puis baissez **Seuil** jusqu'à ce que les sibilances s'atténuent.
**Réduction maximale** limite la coupure ; commencez autour de 6–9 dB. Une **Attaque** plus courte
capture le début d'une consonne, tandis que le **Relâchement** contrôle la vitesse de récupération
des hautes fréquences. Seule la bande supérieure est réduite.

### Compresser des bandes de fréquences distinctes {#multiband-compression}

Choisissez **Effet → Volume et compression → Compresseur multibande**. Les deux filtres de coupure
divisent le signal en bandes basse, médium et haute. Chaque bande possède son propre seuil, taux de
compression et gain de sortie. Un taux de 1 laisse la dynamique de la bande inchangée. L'attaque et
le relâchement s'appliquent aux trois bandes. Les filtres de coupure ont des pentes douces et
chevauchantes de 6 dB par octave ; avec tous les taux à 1 et les gains de bande à 0 dB, le signal
d'origine passe sans modification.

Les deux effets relient leurs canaux pour préserver l'équilibre stéréo et sont également disponibles
dans les racks d'effets de piste et du master. Les réglages des racks sont enregistrés avec le projet
et peuvent être ajustés pendant la lecture. **Appliquer à la sélection** effectue le rendu de l'effet
dans l'audio sélectionné et prend en charge **Undo**. L'automatisation de la timeline n'est pas
disponible pour ces deux effets.

### Utiliser les effets LADSPA et les analyseurs Vamp {#native-audio-plugins}

L'application de bureau ne peut analyser les plug-ins tiers qu'après l'autorisation d'un format et
de l'un de ses dossiers dans **Effet → Gestionnaire de plug-ins**. L'analyse n'est jamais automatique.
Autorisez chaque installation détectée avant de l'utiliser et n'installez que des plug-ins fiables :
les plug-ins natifs exécutent du code même lorsque Soundscaper les héberge dans des processus auxiliaires
supervisés.

Les effets LADSPA sont disponibles sous Linux. Ouvrez-en un depuis **Effet → Plug-ins audio** après
l'avoir activé dans le gestionnaire. Soundscaper construit les contrôles à partir des ports LADSPA,
car ce format ne possède pas d'interface fournie par le fabricant. Les valeurs des contrôles et l'état
activé ou contourné de l'effet sont enregistrés avec le projet.

Les plug-ins Vamp analysent l'audio au lieu de le modifier. Après avoir activé une installation Vamp,
sélectionnez une piste audio à analyser, ou ne sélectionnez aucune piste audio pour analyser le mixage
master. Une sélection temporelle limite l'analyse ; sinon Soundscaper utilise le projet entier.
Choisissez **Analyser → Plug-ins Vamp**, sélectionnez la sortie de l'analyseur et ses réglages, puis
lancez-le. Soundscaper n'ajoute les horodatages renvoyés comme nouvelle piste d'étiquettes qu'une fois
l'analyse complète réussie ; une annulation ou une modification du projet ne peut donc pas laisser des
étiquettes partielles.

## Exporter

Choisissez **Fichier → Exporter l'audio** pour une livraison mixée, ou **Exporter l'audio sélectionné**
lorsque seule une sélection doit être rendue. Soundscaper peut également exporter les stems et les
étiquettes.

### Exporter les clips dans des fichiers séparés {#export-clips}

Choisissez **Fichier → Exporter l’audio** et réglez **Sortie** sur **Clips individuels (séparer par clips)**. Choisissez un format audio et appuyez sur **Exporter** pour télécharger une archive contenant un fichier par clip audio dans les pistes audio du projet. Chaque fichier commence au début audible du clip et se termine à sa fin audible, sans remplissage jusqu’à la durée de la timeline ni queue d’effet ajoutée. Les coupes, le gain du clip, les fondus et les modifications de vitesse et de hauteur sont inclus. Les clips qui se chevauchent restent séparés.

Les fichiers reprennent les noms des clips avec des préfixes numérotés. Les caractères non pris en charge sont remplacés et les numéros distinguent les noms répétés. Les effets de piste sont inclus ; les effets master, la sourdine et le solo ne modifient pas cet export. Dégeler d’abord les pistes gelées pour exporter séparément leurs clips modifiables.

Les formats compressés utilisent le runtime FFmpeg. Les formats exacts et leur disponibilité
conditionnelle sont indiqués dans la [référence générée des formats](/reference/).

### Intégrer des repères de chapitre {#embedded-chapters}

Dans l’éditeur du navigateur, choisissez **Fichier → Exporter l’audio**, puis **MP3** ou **AAC / M4A**, et activez **Intégrer les repères comme chapitres** dans **Options audio**. L’option est désactivée par défaut et ajoute les titres et les horaires des repères dans un seul fichier mixé. Ajoutez des repères avant l’export ; cette option n’est pas proposée pour les stems, les découpes en chapitres ni les séquences de mastering.

Seuls les repères qui croisent la plage livrée sont inclus. L’export d’une sélection décale les temps des chapitres au début du fichier livré. Le MP3 conserve les fins des repères de région ; un repère ponctuel se termine au chapitre suivant ou à la fin du fichier. Le M4A enregistre les débuts de chapitre ; chacun se poursuit jusqu’au début suivant ou jusqu’à la fin du fichier. Le M4A prend en charge jusqu’à 255 chapitres et 255 octets UTF-8 par titre. L’affichage des chapitres intégrés dépend du lecteur.

Lisez le fichier exporté dans une autre application avant de le livrer ou de supprimer les sources.

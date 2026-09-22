---
title: "Éditer, mélanger et exporter"
description: "Organiser les clips, équilibrer les pistes, appliquer des effets et créer un fichier de livraison."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"fr"} -->

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

## Construire le mixage

Utilisez les commandes de gain, de panoramique, de mise en sourdine et de solo des pistes pour
équilibrer le projet. Le panneau Mixer expose le même état du projet dans une disposition orientée
mixage. Les effets en temps réel restent réglables ; les opérations destructives ou rendues créent
des modifications du projet qui peuvent être annulées tant que l'historique est disponible.

Utilisez le vumètre de lecture et l'analyse de la loudness pour examiner le résultat. Ne considérez pas
la cible du vumètre comme un substitut à l'écoute de l'exportation complète.

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

Les formats compressés utilisent le runtime FFmpeg. Les formats exacts et leur disponibilité
conditionnelle sont indiqués dans la [référence générée des formats](/reference/).

Lisez le fichier exporté dans une autre application avant de le livrer ou de supprimer les sources.

Pour les travaux d'image — composition d'une séquence, effets vidéo et livraison MP4 ou WebM — confiez
le projet à [Framescaper](/framescaper/) et consultez [exporter une vidéo](/framescaper/video-export/).

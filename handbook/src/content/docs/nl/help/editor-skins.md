---
title: "Editor-huiden"
description: "Kies een visuele huid of probeer er tijdelijk eentje via een URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"nl"} -->

Huid wijzigt de kleuren, lettertypen, randen en decoratieve achtergronden van de editor.
Ze zijn beschikbaar in Soundscaper en Framescaper. Elk product onthoudt zijn eigen keuze. Werkruimten blijven de indeling van panelen en gereedschappen beheersen.

## Kies een huid {#choose-a-skin}

Open **Bewerken → Voorkeuren → Uiterlijk** en selecteer een huid:

- **Standaard** behoudt het originele editorontwerp.
- **Sakura** combineert kersbloesems, roze accenten en afgeronde lettervormen.
- **Lilac** gebruikt koele paarse tinten en laaggestapelde violette texturen.
- **Techno** combineert blauwe circuitgrafieken met monospaced lettervormen.

Kies **Licht**, **Donker** of **Volg systeemthema** afzonderlijk. Elke huid heeft zowel lichte als donkere versies. **Klemstijl** blijft een aparte keuze; het kleurrijke palet is afgestemd op elke huid terwijl de klemkleuren duidelijk blijven.

Hoog contrast heeft voorrang boven huiddecoratie. Het uitschakelen van hoog contrast herstelt de geselecteerde huid. Het wijzigen van een huid wijzigt nooit de klemgeluid, projectinhoud of werkruimteindeling.

## Probeer een huid vanaf een link {#try-a-skin-from-a-link}

Voeg `?useskin=sakura` toe aan een editor-URL om Sakura tijdelijk te bekijken. Gebruik
`default`, `sakura`, `lilac` of `techno` als waarde. Als de URL al een
queryparameter heeft, voeg dan `&useskin=sakura` toe. Een onbekende waarde wordt genegeerd.

Een URL-preview vervangt niet uw opgeslagen huid, zelfs als u andere voorkeuren wijzigt. Het opnieuw laden van de preview-URL houdt de preview in stand; het bezoeken zonder de parameter gebruikt uw opgeslagen keuze. De parameter kiest niet tussen licht en donker.

In **Voorkeuren → Uiterlijk**, kies **Houd deze huid** om de preview op te slaan, of **Eindig preview** om terug te keren naar uw opgeslagen huid. Het selecteren van elke huid slaat ook die keuze op en beëindigt de preview. Deze acties verwijderen alleen de huidparameter
uit de huidige URL, zonder de editor opnieuw te laden.

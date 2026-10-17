---
title: "Motionscaper"
description: "Vytvářejte animované kompozice a uchovávejte upravitelné pohybové projekty místně."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"cs"} -->

Motionscaper je editor pohyblivé grafiky z rodiny Scaper. Projekt obsahuje
kompozice, vrstvy, animaci a uchovaná média. Jeho projektové soubory mají
příponu `.mscape`.

Toto je vývojové vydání. Začněte s kopií důležitých zdrojových materiálů
a exportované archivy projektů uchovávejte vedle své pracovní knihovny.

## Začněte kompozicí {#start-a-composition}

Zvolte **Soubor → Nová kompozice**. Nabídka **Vrstva** otevírá nástroje pro text,
tvary, animaci, kompozici vrstev, sledování, výrazy a 3D scény. **Zobrazení →
Náhled kompozice** otevře přehrávání; nové plochy pro úpravy se zobrazí až tehdy,
když je zvolíte z nabídky.

Zvolte **Zobrazení → Plátno kompozice**, chcete-li vybírat, posouvat, měnit velikost
nebo otáčet vrstvy se statickými 2D transformacemi. Animované transformace lze
nadále upravovat pomocí nástrojů vlastností a časové osy.

V nabídce **Zobrazení → Časová osa** vyberte existující vrstvy, které chcete
přejmenovat, zapnout, vypnout nebo odstranit. Přejmenování zachovává odkazy na
vlastnosti i animaci. Odstranění vrstvy zachovává její původní média; zahrňte i
závislé vrstvy nebo nejprve odpojte jejich vazby. **Zpět** odstraněné vrstvy obnoví.
Vybraná vrstva zdrojového videa nabízí také přepínač zvuku, pokud uchovaný zdroj
obsahuje zvuk.

Podle návodu [Váš první pohybový projekt](/motionscaper/first-project/) vytvoříte,
rozpohybujete, uložíte a vykreslíte kompozici.

## Uložení a výstup {#save-and-deliver}

**Soubor → Uložit** zveřejní uloženou revizi. **Uložit kopii** exportuje aktuální
stav jako archiv `.mscape`, aniž by zveřejnil novou uloženou revizi.
Importovaná původní média a písma se přenesou s archivem. **Knihovna projektů**
otevírá projekty uchované na tomto zařízení.

**Soubor → Vykreslit** nabízí průhledné snímky PNG v archivu TAR,
neprůhledné video MP4 nebo WebM a ProRes 4444, je-li dostupný desktopový kodér.
Sekvence PNG neobsahují zvuk. Video v prohlížeči zachová vytvořený zvuk, pokud
jeho kodér podporuje požadovaný formát. Nativní ProRes v dialogu vykreslení
uvádí skutečnou přesnost barev a alfy. **Soubor → Fronta vykreslení** uchovává
úlohy i při zavření dialogů a přepínání projektů. Uchová nejvýše osm úloh
a 128 MiB stažených dat prohlížeče; jednotlivé stažení smí mít nejvýše 64 MiB.
Pro větší výstup zvolte průběžný zápis do souboru a dokončené úlohy odstraňte,
abyste uvolnili uchovaná stažená data. Pokud vyčištění nativního výstupu selže,
použijte v této frontě **Zopakovat vyčištění výstupu**. Úloha si ponechá cíl,
dokud vyčištění neuspěje; poté ji můžete odstranit nebo zopakovat odeslanou revizi
s novým cílem.

## Propojení s Framescaper {#link-to-framescaper}

Propojené kompozice vyžadují samostatnou vývojovou řadu Framescaper 1.1.
V jejím dialogu **Soubor → Propojené kompozice** vytvořte párovací URL.
Vložte ji do dialogu **Soubor → Odeslat kompozici do Framescaper** v Motionscaper,
připojte se a ponechte editory i propojovací okna otevřené. Další operace
**Uložit** automaticky odesílají nové revize; **Uložit kopii** nikoli.

Framescaper uchovává každou přijatou revizi a úplnou sadu jejích médií pro použití
bez připojení. Zpět připne předchozí revizi, dokud aktualizace neobnovíte. Změny
výstupní velikosti, časování nebo zvukové mřížky vyžadují výslovnou kontrolu
přizpůsobení. Desktopový přijímač může místo toho sledovat vybraný uložený
soubor `.mscape`.

## Kontrola desktopových aktualizací {#check-desktop-updates}

V desktopové aplikaci zvolte **Nápověda → Zkontrolovat aktualizace**. Tato ruční
kontrola hledá kompatibilní vydání Motionscaper v projektovém repozitáři GitHub.
Předběžné verze mohou získat novější předběžná vydání; stabilní verze získávají
stabilní vydání. Pomocí **Zobrazit vydání** otevřete ověřenou stránku vydání.
Kontrola aktualizaci nestahuje ani neinstaluje. Prohlížečová sestavení tento
příkaz nabídky neobsahují.

## Výměna s After Effects {#after-effects-exchange}

**Soubor → Propojení s After Effects** poskytuje čitelné skripty a před importem
kontroluje podporovaná výměnná data. Soubory `.aep` a `.aepx` se otevírají přes
nainstalované After Effects a propojovací skripty. Vývojové propojení dosud
nebylo ověřeno proti nainstalovanému After Effects. Zkontrolujte zprávu;
nepodporovaný záměr scény i původní média zůstávají uchovány v projektu.

Dialog nabízí samostatné možnosti importu a exportu podporovaných skalárních
výrazů krytí využívajících aritmetiku, čas kompozice, hodnotu před výrazem
a standardní funkce Math. Obě možnosti jsou zpočátku vypnuté. Po změně možnosti
zkontrolujte novou zprávu; jiné formy výrazů vyžadují výslovné vzorkování nebo
vykreslení. Původní zdroj výrazů zůstává v uchovaných výměnných datech nebo
v archivu `original.mscape`.

Vykreslovač podporuje barvy SDR a alfu s vrstvami 2.5D, kamerami, světly,
vzorkováním závěrky a hloubkou ostrosti. Neslibuje HDR, úplné 3D sítě,
pokročilé maskování pomocí AI ani kompatibilitu s libovolnými zásuvnými moduly
After Effects.

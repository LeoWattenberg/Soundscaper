---
title: "Upravit, smíchat a exportovat"
description: "Uspořádejte klipy, vyvažte stopy, aplikujte efekty a vytvořte soubor pro dodání."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"cs"} -->

## Uspořádání klipů

Před výběrem příkazu pro úpravu vyberte klipy nebo časový rozsah. Příkaz Rozdělit
vytvoří hranici úpravy na pozici přehrávací hlavy. Varianty s zachováním mezer a
ripple určují, zda se pozdější materiál ponechá na místě, nebo se posune tak, aby
uzavřel odstraněnou oblast.

Pro uspořádání větších projektů používejte složky stop, skupiny klipů a Projektový
koš.

### Úprava přechodů klipů {#clip-fades}

Vyberte zvukový klip, aby se podél horního okraje jeho vlnového tvaru, přímo pod
hlavičkou klipu, zobrazily malé trojúhelníkové úchyty.
Táhněte levý trojúhelník dovnitř pro přechod do zvuku (fade-in), nebo pravý
trojúhelník dovnitř pro přechod ze zvuku (fade-out). Vlnový tvar se mění při
tažení a oblast nad křivkou přechodu se stává tmavší. Trojúhelníky sledují hranice
přechodu; tažením jednoho zpět do rohu se tento přechod odstraní. Změní se pouze
ten klip, který táhnete, i když je vybráno více klipů.

Úchyty zmizí, když klip zrušíte výběr, ale ztlumený vlnový tvar a stínování
zůstanou. Tyto přechody zachovávají původní zvuk a zůstávají upravitelné i po
uložení a opětovném otevření projektu. Uvolněním potvrdíte přechod, nebo
stisknutím klávesy **Escape** během tažení zrušíte akci. Příkaz **Zpět** vrátí
jedno úplné tažení.
Přehrávání a export používají potvrzená nastavení přechodu.

S vybraným klipem v zaměření stiskněte **Tab** pro dosažení jeho úchytů přechodu.
Šipkové klávesy upravují délku o 10 milisekund, nebo o 100 milisekund s klávesou
**Shift**. Klávesa **Home** odstraní přechod; klávesa **End** jej rozšíří přes
celý klip.
Pro číselný vstup vyberte **Úpravy → Zvukové klipy → Vlastnosti klipu** a použijte
**Přechody**.

## Vytvoření mixáže

Pro vyvážení projektu používejte ovládací prvky zesílení stopy, panoramatu,
ztlumení a sóla. Panel Mixer zobrazuje stejný stav projektu v rozložení
orientovaném na mixáž. Efekty v reálném čase zůstávají upravitelné; destruktivní
nebo renderované operace vytvářejí změny projektu, které lze vrátit zpět, dokud je
historie dostupná.

K inspekci výsledku používejte měřič přehrávání a analýzu hlasitosti. Vyhněte se
tomu, abyste cíl měřiče považovali za náhradu za poslech kompletního exportu.

### Snížení sibilance {#reduce-sibilance}

Vyberte **Efekt → Odstranění šumu a opravy → De-esser**. Nastavte **Frekvenci** v
blízkosti drsné části hlasu, poté snižujte **Práh**, dokud se sibilanty nezmírní.
**Maximální redukce** omezuje útlum; začněte kolem 6–9 dB. Kratší **Útok** chytí
začátek souhlásky, zatímco **Uvolnění** řídí, jak rychle se vysoké frekvence
obnoví. Redukuje se pouze horní pásmo.

### Komprese samostatných frekvenčních pásem {#multiband-compression}

Vyberte **Efekt → Hlasitost a komprese → Multiband kompresor**. Dva křížové filtry
rozdělí signál na nízké, střední a vysoké pásma. Každé pásmo má svůj vlastní práh,
poměr a výstupní zesílení. Poměr 1 ponechá dynamiku daného pásma nezměněnou. Útok
a uvolnění se vztahují na všechna tři pásma. Křížové filtry mají jemné,
překrývající se sklon 6 dB/oktávu; při všech poměrech nastavených na 1 a
zesíleních pásem na 0 dB prochází původní signál nezměněn.

Oba efekty propojují své kanály, aby zachovaly stereo vyvážení, a jsou také k
dispozici v rackech efektů stopy a masteru. Nastavení racků se ukládá s projektem
a lze je upravovat během přehrávání. Příkaz **Použít na výběr** renderuje efekt do
vybraného zvuku a podporuje vrácení zpět. Časová osa automatizace pro tyto dva
efekty není k dispozici.

### Používejte efekty LADSPA a analyzátory Vamp {#native-audio-plugins}

Desktopová aplikace může prohledávat zásuvné moduly třetích stran až poté, co v
**Efekt → Správce zásuvných modulů** povolíte formát a jednu z jeho složek.
Prohledávání nikdy neprobíhá automaticky. Každou nalezenou instalaci před použitím
povolte a instalujte pouze zásuvné moduly, kterým důvěřujete: nativní zásuvné
moduly spouštějí spustitelný kód, i když je Soundscaper hostuje v kontrolovaných
pomocných procesech.

Efekty LADSPA jsou dostupné v Linuxu. Po povolení ve správci jeden otevřete přes
**Efekt → Zvukové zásuvné moduly**. Soundscaper vytváří ovládací prvky z portů
LADSPA, protože tento formát nemá rozhraní dodavatele. Tyto hodnoty ovládacích
prvků i stav efektu povolený nebo obejitý se ukládají s projektem.

Zásuvné moduly Vamp analyzují zvuk, místo aby jej měnily. Po povolení instalace
Vamp vyberte zvukovou stopu, kterou chcete analyzovat, nebo nechte vybranou žádnou
zvukovou stopu a analyzujte hlavní mix. Výběr času analýzu omezí; jinak
Soundscaper použije celý projekt. Zvolte **Analyzovat → Zásuvné moduly Vamp**,
vyberte výstup analyzátoru a jeho nastavení a spusťte jej. Soundscaper přidá
vrácené časové značky jako novou stopu popisků až po úspěšném dokončení celé
analýzy, takže zrušení nebo změna projektu nemůže zanechat částečné popisky.

## Export

Vyberte **Soubor → Exportovat zvuk** pro smíchané dodání, nebo **Exportovat
vybraný zvuk**, pokud má být renderován pouze výběr. Soundscaper může také
exportovat stemy a popisky.

Komprimované formáty používají běhové prostředí FFmpeg. Přesné formáty a podmíněná
dostupnost jsou uvedeny v [vygenerované referenci formátů](/reference/).

Přehrajte exportovaný soubor v jiné aplikaci před dodáním nebo smazáním zdrojového
materiálu.

Pro práci s obrazem — skládání sekvence, video efekty a dodání ve formátu MP4 nebo
WebM — přenechte projekt aplikaci [Framescaper](/framescaper/) a viz
[export videa](/framescaper/video-export/).

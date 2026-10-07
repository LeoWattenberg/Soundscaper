---
title: "Upravit, smíchat a exportovat"
description: "Uspořádejte klipy, vyvažte stopy, aplikujte efekty a vytvořte soubor pro dodání."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"cs"} -->

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

### Úprava zdroje klipu {#clip-source-properties}

Zdrojový editor otevřete volbou **Upravit → Zvukové klipy → Vlastnosti klipu**. Za klipem se zobrazí celý záznam. Tažením za okraje klipu změňte začátek a délku zdroje, přičemž začátek klipu na časové ose projektu zůstane stejný. Panel **Normalizace** obsahuje zesílení klipu a akce pro špičku a hlasitost.

Otevřete **Výška tónu a tempo** a zaškrtnutím **Propojit výšku tónu a tempo** změňte rychlost a výšku tónu společně. Poměr rychlosti `1` a změna výšky tónu `0%` zvuk nemění. Poměr `2` přehrává dvojnásobnou rychlostí o oktávu výše; `0.5` poloviční rychlostí o oktávu níže. Úprava jednoho propojeného ovládacího prvku aktualizuje druhý. Zrušení propojení obnoví samostatné nastavení výšky tónu a ponechá aktuální poměr rychlosti.

Kliknutím na waveform se stisknutou klávesou **Ctrl** přidáte značku roztažení navázanou na daný zdrojový vzorek. Tažením změníte časování na obou stranách; překryvná vrstva ukazuje obě rychlosti přehrávání. Ovládací prvky klipu nadále platí pro každý klip zvlášť. Výběr zdrojového audia a použití efektu aktualizuje všechny klipy, které tento zdroj používají.

### Úprava klipů v tabulce {#clip-spreadsheet}

Všechny klipy projektu zobrazíte volbou **Zobrazení → Panely → Tabulka klipů**. Panel se otevře pod časovou osou. V jeho nabídce ho můžete přesunout do jiné dokovací oblasti, nechat plovoucí nebo zavřít. Velikost a umístění se ukládají s pracovním prostorem. Každý řádek zobrazuje stopu, pozici na časové ose, zdrojový soubor, posun zdroje, délku, výšku tónu, rychlost, zesílení, prolínání a možnosti přehrávání. Časy jsou v sekundách, výška tónu v půltónech a rychlost je poměr: `1` znamená běžnou rychlost, `2` dvojnásobnou.

Hodnotu upravíte dvojitým kliknutím na buňku nebo výběrem buňky a stisknutím **Enter**. **Enter** změnu použije, **Escape** ji zruší. Buňky stopy a zdroje zobrazují jejich skutečná ID. Změnou ID stopy přesunete klip na existující zvukovou stopu. Změnou ID zdroje nebo zadáním místní cesty k souboru nahradíte audio a zachováte pozici na časové ose, délku, rychlost i posun zdroje v sekundách. Nový soubor musí obsahovat určený rozsah zdroje. **Obráceně** a **Invertovat** jsou zaškrtávací políčka; jejich stav přepnete výběrem buňky a stisknutím **Mezerníku**. Klipy na uzamčených stopách a videoklipy jsou jen pro čtení.

Změna délky zkrátí nebo prodlouží rozsah zdroje od aktuálního posunu. Změna rychlosti zachová rozsah zdroje, pokud současně nevložíte také délku. Před změnou časování zde klipy seskupte nebo odpojte; časování roztažených klipů upravte ve zdrojovém editoru.

Vyberte buňku, přetáhněte výběr přes rozsah nebo rozšiřte výběr kliknutím na další buňku se stisknutým **Shift**. Kliknutím na číslo řádku nebo záhlaví sloupce vyberete celý řádek či sloupec. Pomocí **Ctrl+C** a **Ctrl+V** (**Cmd+C** a **Cmd+V** v macOS) můžete výběr předávat tabulkovému editoru. Sloupce oddělují tabulátory, řádky nové řádky. Vložení začíná ve vybrané buňce a aktualizuje stávající klipy. Vložení přesahující stávající řádky se odmítne. S aktivním výběrem stiskněte **Escape** nebo klikněte do prázdného prostoru pod tabulkou, čímž výběr zrušíte. Bez výběru se vložením přidají nové řádky, a to i do prázdného projektu. Možnosti přehrávání se kopírují jako `true` nebo `false` a při vkládání tyto hodnoty přijímají. Nové řádky dodržují pořadí sloupců tabulky a vyžadují název zdrojového souboru nebo ID zdroje. Jedinečný název existující stopy umístí klip na tuto stopu; nový název vytvoří zvukovou stopu. Prázdné názvy stop používají název zdroje. Prázdné číselné buňky mají výchozí hodnoty: pozice a posun `0`, rychlost `1`, výška tónu a zesílení `0`, bez prolínání. Prázdná délka použije zbývající audio požadovanou rychlostí.

Panel nejprve hledá zdroj v projektu včetně projektového koše. Pokud chybí, zvolte **Načíst odkazované soubory** a vyberte zvukové soubory uvedené v dialogu. I cesty k souborům na disku vyžadují tento výběr: vložením cesty aplikace nezíská přístup k souboru. Vybrané soubory musí jednoznačně odpovídat odkazovaným názvům. Panel importuje audio, ověří meze zdroje a vlastnosti klipu a umístí nové klipy na zadané pozice. **Ctrl+Z** (**Cmd+Z** v macOS) vrátí celé vložení jedním krokem; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) ho zopakuje. Pokud vložení obsahuje neplatnou hodnotu, klipy zůstanou beze změny.

## Vytvoření mixáže

Pro vyvážení projektu používejte ovládací prvky zesílení stopy, panoramatu,
ztlumení a sóla. Panel Mixer zobrazuje stejný stav projektu v rozložení
orientovaném na mixáž. Efekty v reálném čase zůstávají upravitelné; destruktivní
nebo renderované operace vytvářejí změny projektu, které lze vrátit zpět, dokud je
historie dostupná.

K inspekci výsledku používejte měřič přehrávání a analýzu hlasitosti. Vyhněte se
tomu, abyste cíl měřiče považovali za náhradu za poslech kompletního exportu.

### Poslech vybraných frekvencí {#listen-to-selected-frequencies}

Vyberte pasáž, kterou chcete poslouchat. V nabídce stopy zvolte **Vizualizace stopy → Spektrogram** a otevřete **Možnosti spektrogramu → Vybrat rozsah spektrální frekvence**. Zadejte minimální a maximální frekvenci a zvolte **Vybrat rozsah**, nebo upravte úchyty výběru ve spektrogramu.

Zvolte **Možnosti přehrávání → Přehrát vybrané frekvence** nebo **Vybrat → Spektrální → Přehrát vybrané frekvence**. Vybraný časový rozsah se přehraje jednou běžnou rychlostí, i když byla předtím zvolena jiná rychlost či smyčka. Poslechový filtr se vztahuje na aktuální mix včetně ztlumení, sóla, zesílení a efektů. Spektrální obdélník označuje frekvenční pásmo a časový rozsah, ale stopu nepřepne na sólo. Pokud již přehrávání běží, příkaz ho pozastaví; dalším výběrem příkazu spustíte poslech frekvencí.

Filtry frekvencí v reálném čase mají plynulé okraje. Frekvence mimo pásmo a blízko jeho hranic mohou být tišší. **Pozastavit** nebo **Zastavit** filtr odstraní, takže další běžné přehrávání použije celé frekvenční pásmo. Audio, výběry, historie vrácení změn a exportované soubory zůstávají beze změny.

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

### Exportovat klipy jako samostatné soubory {#export-clips}

Zvolte **Soubor → Exportovat zvuk** a nastavte **Výstup** na **Jednotlivé klipy (rozdělit podle klipů)**. Vyberte zvukový formát a stisknutím **Exportovat** stáhněte archiv s jedním souborem pro každý zvukový klip ve zvukových stopách projektu. Každý soubor začíná na slyšitelném začátku klipu a končí na jeho slyšitelném konci, bez doplnění na délku časové osy projektu nebo přidání dozvuku efektů. Zahrnou se ořezy, zesílení klipu, prolínání a změny rychlosti i výšky tónu. Překrývající se klipy zůstanou oddělené.

Soubory používají názvy klipů s číselnými předponami. Nepodporované znaky v názvech souborů se nahradí a čísla odliší opakované názvy klipů. Zahrnou se efekty stop; hlavní efekty, ztlumení a sólo tento export neovlivní. Před samostatným exportem upravitelných klipů rozmrazte zmrazené stopy.

Komprimované formáty používají běhové prostředí FFmpeg. Přesné formáty a podmíněná
dostupnost jsou uvedeny v [vygenerované referenci formátů](/reference/).

### Vložení značek kapitol {#embedded-chapters}

V prohlížečovém editoru zvolte **Soubor → Exportovat audio**, vyberte **MP3** nebo **AAC / M4A** a v **Možnostech audia** zapněte **Vložit značky jako kapitoly**. Volba je zpočátku vypnutá a vloží názvy a časy značek do jednoho smíchaného souboru. Před exportem přidejte značky; stemy, rozdělení na kapitoly a masteringové sekvence tuto možnost nenabízejí.

Zahrnou se pouze značky, které se protínají s dodávaným rozsahem. Export výběru posune časy kapitol na začátek vytvořeného souboru. MP3 zachovává časy konce značek oblastí; bodová značka končí u další kapitoly nebo na konci souboru. M4A ukládá začátky kapitol a každá kapitola pokračuje do dalšího začátku nebo konce souboru. M4A podporuje až 255 kapitol a 255 bajtů UTF-8 na název. Zobrazení vložených kapitol závisí na přehrávači.

Přehrajte exportovaný soubor v jiné aplikaci před dodáním nebo smazáním zdrojového
materiálu.

---
title: "Jak se Soundscaper srovnává"
description: "Porovnejte Soundscaper s Audacity 4 a Adobe Audition v oblastech nahrávání, úprav, mixování, distribuce a výměny."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"cs"} -->

Soundscaper znovu implementuje Audacity 4 na webu a přidává na něj vrstvu pro produkci. Adobe Audition je komerční nástroj pro postprodukci, vůči kterému se obvykle oba produkty porovnávají. Tato stránka porovnává všechny tři, abyste mohli zjistit, který z nich již plní úkol, který máte.

## Jak číst tuto stránku

Každá buňka obsahuje **Ano**, **Částečně** nebo **Ne**, následované podrobností, která tento stav upřesňuje.

**Částečně** pokrývá tři různé situace a poznámka uvádí, která se uplatňuje: funkce existuje, ale je užší než jinde, existuje, ale závisí na něčem, co musíte dodat, nebo je dosažitelná pouze obcházením chybějícího prvku.

Řádky popisují funkce, ne příkazy v menu. Přesný seznam příkazů naleznete v [Příkazy a zkratky](/reference/generated/commands/), a co každý produkt umožňuje, naleznete v
[Funkce produktu](/reference/generated/product-capabilities/).

### Odkud pocházejí tyto tvrzení

- Řádky pro **Soundscaper** pocházejí z tohoto repozitáře: profily funkcí produktu, manifest akcí runtime a rejstřík formátů exportu.
  Cílové platby nativní pro desktop jsou generovány CI repozitáře nebo balíkováním cíle. Balík povolí pouze po stagi a ověření přesně odpovídajícího výsledku; tyto řádky uvádějí, kdy je stále vyžadována platba.
- Řádky pro **Audacity 4** pocházejí z inventáře upstreamu pevně stanoveného v tomto repozitáři, `4.0.0` na commitu `4c177d43`. Funkce, kterou upstream registruje, ale ponechá zakázanou nebo vynechá z menu, je zaznamenána jako taková, a funkce bez registrace v pevně stanovené sestavě je hlášena jako nepřítomná v této sestavě, nikoli jako trvale chybějící.
- Řádky pro **Audition** pocházejí z publikované dokumentace Adobe pro aktuální vydání. Nejsou ověřeny proti běžící sestavě.

## Platforma a pojmy

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licence | Ano — AGPL-3.0-only | Ano — GPL, open source | Ne — proprietární a uzavřená |
| Náklady | Ano — zdarma | Ano — zdarma | Ne — předplatné Creative Cloud |
| Spouští se v prohlížeči | Ano — Chromium, Firefox a WebKit | Ne — pouze desktop | Ne — pouze desktop |
| Sestavy pro desktop | Ano — Windows a Linux na x64 a ARM64, macOS na ARM64 | Ano — Windows, macOS, Linux | Částečně — Windows a macOS, bez Linuxu |
| Funguje bez účtu | Ano — účet neexistuje | Ano — přihlášení pouze pro audio.com | Ne — vyžaduje přihlášené předplatné |
| Ukládání projektů v cloudu | Ne — vyloučeno designem zaměřeným na lokální prostředí | Ano — ukládání a sdílení prostřednictvím audio.com | Částečně — soubory Creative Cloud, relace se nesynchronizují |
| Systémové požadavky | Ano — spouští se všude, kde běží aktuální prohlížeč | Částečně — podstatně vyšší než u Audacity 3 | Částečně — třída profesionální pracovní stanice |

## Model projektu a relace

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Nativní formát projektu | Ano — `.sscape`, bezstratná přenosná archiva | Ano — `.aup4` | Ano — `.sesx` |
| Otevírání projektů Audacity | Ano — import a export AUP4 | Ano — nativní | Ne |
| Nedestruktivní časová osa klipů | Ano | Ano | Ano — vícestopý editor |
| Samostatný editor souboru | Částečně — úpravy vzorků probíhají v časové ose | Částečně — úpravy se aplikují přímo v časové ose | Ano — editor vlnového tvaru |
| Mono a stereo obsah na jednom stopě | Ano — stopa obsahuje buď mono nebo stereo | Ne — stopa je mono nebo stereo | Ne — kanálový formát je pevně stanoven pro stopu |
| Vložené složky stop | Ano — libovolná hloubka, s možností vrácení a routováním | Ne | Částečně — pouze sběrnice submix, bez složek stop |
| Koš projektu | Ano — organizuje soubory a slouží jako schránka | Ne | Částečně — panel Soubory zobrazuje otevřené soubory |
| Automatické ukládání a obnova po pádu | Ano — automatické ukládání, zámky a obalové soubory pro obnovu | Ano | Ano |
| Značky a pojmenované oblasti | Ano — první třída, s navigací a chováním ripple | Částečně — stopy s popisky | Ano — značky a rozsahy |
| Mapy tempa a taktových znaků | Ano — uspořádané mapy vyhodnocené s přesností vzorku | Částečně — jedno tempo a taktový znak projektu | Částečně — jedno tempo relace |

## Záznam

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vícestopý záznam | Ano — více zdrojů najednou | Částečně — jedno vstupní zařízení najednou | Ano — vícevstupní a vícekanálové rozhraní |
| Současný záznam mikrofonu a zvuku z počítače | Ano — vestavěné | Ne | Částečně — vyžaduje zařízení loopback operačního systému |
| Časovaný záznam | Ano | Ano | Ne |
| Záznam aktivovaný zvukem | Ano — s nastavitelnou prahovou hodnotou | Ano — s nastavitelnou prahovou hodnotou | Ne |
| Odpočet před nahráváním | Ano — s ohledem na mapu tempa, zvládá složené metrum | Částečně — záznam úvodu | Částečně — předběh jako součást punch and roll |
| Punch záznam | Ano — jedna transakce, výchozí a routované zachycení | Ne | Ano — punch and roll |
| Smyčkový záznam do nahrávek | Ano — jedna dráha na průchod, připojeno ke stejné skupině | Ne | Částečně — nahrávky na jednom klipu, vybrané ze seznamu |
| Comping nahrávek | Ano — poslech, povýšení, úprava oblastí compu, sploštění jako jedna vracitelná úprava | Ne | Ne — žádný editor compu |
| Monitorování a měření vstupu | Ano | Ano | Ano |

## Úpravy časové osy

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Varianty ripple edit | Ano — pro klip, pro stopu a pro všechny stopy, při řezu a smazání | Ano — stejné tři, při řezu a smazání | Částečně — ripple delete pro výběr nebo mezery |
| Rozdělení, spojení a rozdělení na tichých místech | Ano | Ano | Částečně — rozdělení a ořez, bez spojení klipů |
| Skupiny klipů | Ano | Ano | Ano |
| Zisk (gain) klipu | Ano | Ano | Ano |
| Tonální výška a rychlost pro každý klip | Ano — úprava, renderování nebo reset | Ano — úprava, renderování nebo reset | Částečně — stretch zůstává editovatelný, tonální výška je efekt |
| Sledování změn tempa | Ano — klipy se natahují, když se mapa pohybuje | Ano | Ne |
| Kvantizace a groove s ohledem na beaty | Ano — warp mapy s nastavitelnou intenzitou groove | Ne | Ne |
| Přichycení k nulovým průchodům | Ano | Ano | Ano |
| Kreslení na úrovni vzorků | Ano | Částečně — v připevněné verzi není registrována akce kreslení | Ano — ve vlnovém editoru |
| Editace pouze pomocí klávesnice | Ano — každý editační prvek má navigační akci | Ano — každý editační prvek má navigační akci | Částečně — rozsáhlé zkratky, některé panely vyžadují myš |

## Spektrální práce a restaurování

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Zobrazení spektrogramu | Ano — s nastavením pro každou stopu | Ano — s nastavením pro každou stopu | Ano — zobrazení frekvence a tonální výšky |
| Výběr ohraničený frekvencemi | Ano | Ano | Ano — marquee a lasso |
| Spektrální štětec | Ano | Ano | Ano — paintbrush a spot healing |
| Smazání nebo zesílení spektrální oblasti | Ano — obě jako přímé akce | Ano — obě jako přímé akce | Částečně — aplikovat efekt na výběr |
| Oprava krátkých poškození | Ano — Repair | Ano — Repair | Ano — Auto Heal a Spot Healing Brush |
| Širokopásmové potlačení šumu | Ano — s zachyceným profilem | Ano — s zachyceným profilem | Ano — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Odstranění dozvuku | Ne | Ne | Ano — DeReverb |
| Nástroje pro klikání, hučení a sibilanci | Částečně — pouze Click Removal | Částečně — pouze Click Removal | Ano — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostický panel | Částečně — Find Clipping jako analyzér | Částečně — Find Clipping jako analyzér | Ano — diagnostika s opravou pro jednotlivé problémy |

## Efekty a zásuvné moduly

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vestavěná sada efektů | Ano — 30 efektů Audacity, balíčkové plug-iny Nyquist a efekty první strany bez ekvivalentu ve výchozím kódu, jako je bitcrusher | Ano — stejná vestavěná kolekce 30 efektů | Ano — přibližně padesát, včetně multibandové dynamiky |
| Reálný časový efektový rack pro každý stopu | Ano — širší sada reálného času než ve výchozím kódu | Ano | Ano — šestnáct slotů na klip, stopu a master |
| Parametrický EQ | Ano — nový parametrický EQ s automatizovatelnými pásmy | Částečně — Filter Curve a Graphic EQ | Ano — parametrické, grafické a FFT filtry |
| Předvolby efektů | Ano — aplikovat, uložit, importovat, exportovat | Ano — aplikovat, uložit, importovat, exportovat | Ano |
| Makra a dávkové řetězce | Ano — uložená knihovna mokr s šablonami | Ne — připnutá build verze má zakomentované menu Makra | Ano — Oblíbené a Batch Process |
| Formáty třetích stran plug-inů | Částečně — VST3, CLAP, AU a LV2 na desktopu za souhlasu a izolace, v prohlížeči žádné | Ano — VST3, AU, LV2 a Nyquist, s manažerem plug-inů | Částečně — VST3 a AU na macOS, bez CLAP nebo LV2 |
| Skriptování Nyquist | Ano — balíčkové plug-iny a prompt Nyquist | Ano — balíčkové plug-iny a prompt Nyquist | Ne |
| Izolované balíčky efektů | Částečně — prověřené balíčky WebAssembly, jeden je dodáván a externí jsou izolovány | Ne | Ne |
| Virtuální nástroje | Ne — po verzi 1.0 | Ne | Ne |

## Mixáž, routování a automatizace

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixér s kanálovými pruhy | Ano | Částečně — ovládání stop a master stopa | Ano |
| Buse a submixy | Ano — vnořené, s cyklickou validací | Ne | Ano — bus stopy |
| Sends | Ano — pre a post fader, více přiřazení | Ne | Ano — pre a post fader |
| Skupiny VCA | Ano | Ne | Ne |
| Vstup sidechain | Ano | Ne | Ano — přes sends |
| Cue a control-room mixy | Ano | Ne | Ne |
| Kompenzace zpoždění plug-inů | Ano — přehrávání, monitorování, buse, sidechainy, render a freeze | Částečně — nevyjádřeno v připnutých zdrojích | Ano |
| Dráhy automatizace | Ano — gain, pan, mute, sends, buse a parametry plug-inů | Ne — žádné dráhy a žádný nástroj obálky v připnuté build verzi | Ano — hlasitost, pan a parametry efektů |
| Režimy automatizace | Ano — read, trim, touch, latch a write | Ne | Částečně — read, write, latch a touch, bez trim |
| Tvary křivek | Ano — line, hold a curve | Ne | Ano — lineární a spline |
| Zamrznutí stopy | Ano — freeze, unfreeze a commit bez ztráty stavu | Ne | Částečně — bounce do nové stopy |

## Metrování a analýza

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Měřič hlasitosti | Ano — ve stylu EBU R 128, s historií | Ne — efekt Normalizace hlasitosti, ale bez měřiče | Ano — Loudness Radar podle ITU-R BS.1770 |
| Měřič fáze a korelace | Ano | Ne | Ano — měřič fáze a analýza |
| Měření surround | Ano | Ne | Částečně — až 5.1 |
| Spektrální graf | Ano — Plot Spectrum | Částečně — registrováno, ale v pevně dané verzi je zakomentováno v menu Analyzovat | Ano — Frequency Analysis |
| Klipování a RMS ve vlnovém tvaru | Ano — oba, přepínatelné pro každý projekt | Ano — oba, přepínatelné pro každý projekt | Částečně — indikátory klipování, RMS v Amplitude Statistics |
| Kontrast srozumitelnosti řeči | Ano — analyzátor kontrastu | Částečně — registrováno, ale v pevně dané verzi je zakomentováno v menu Analyzovat | Ne |

## Kanály a immersivní zvuk

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Počet kanálů na soubor | Ano — až 32 pro formáty PCM | Částečně — monofonní a stereofonní stopy | Ano — až 32 ve vlnovém editoru |
| Surround mixáž | Ano — postele až 7.1.4 | Ne | Částečně — až 5.1 |
| Objektový zvuk | Ano — objekty vedle postelí | Ne | Ne |
| Autoring ADM a průchod | Ano — BW64/ADM s kontrolami shody | Ne | Ne |
| Binaurální render | Ano — pojmenovaný binaurální model | Ne | Částečně — binauralizér pro ambisonics |
| Ambisonics | Ne | Ne | Ano — první řád, s VR pannerem |

## Export a dodávka

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ztrátový výstup | Ano — WAV, AIFF, BWF a BW64 zapisované nativně | Ano — WAV, AIFF a FLAC | Ano — WAV, AIFF, FLAC a další |
| Ztrátový výstup | Částečně — MP3, AAC, Opus, Vorbis, MP2, FLAC a WavPack, vše přes běhové prostředí FFmpeg | Částečně — MP3 vestavěné, zbytek přes volitelnou instalaci FFmpeg | Ano — vestavěné |
| Vlastní nastavení kodéru | Ano — vlastní cíl FFmpeg | Ano — vlastní cíl FFmpeg | Ano — možnosti pro každý formát |
| Fronta exportu | Ano — pozastavení, zrušení, opakování a přeuspořádání | Ne — jeden export najednou | Částečně — Batch Process bez ovládání fronty |
| Stemy a alternativy v jednom průchodu | Ano — zařazeny do fronty společně s mixem | Ne | Částečně — jeden mixdown na stem |
| Dodávka podle oblastí | Ano — masterovací sekvence s metadaty pro každou oblast, mezerami a přechody | Částečně — export štítků, žádný export více souborů v pevně dané verzi | Ano — export značek do samostatných souborů |
| Normalizace hlasitosti při exportu | Ano — součást plánu dodávky | Částečně — nejdříve spustit efekt | Ano — Match Loudness |
| Dither a mapování kanálů | Ano — explicitní ovládací prvky | Částečně — dither v nastaveních | Ano — explicitní ovládací prvky |
| Zpráva o dodávce | Ano — položkově pro každý úkol | Ne | Ne |
| Fronta renderu přežije restart | Ano — na desktopu, restart od nuly bajtů s deníkem havárií | Ne | Ne |

## Výměna s jinými nástroji

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Projekty Audacity | Ano — vstup a výstup AUP4, s zprávou o vynecháních | Ano — nativní | Ne |
| EDL | Částečně — export třídy CMX3600, bez importu | Ne | Ne |
| OpenTimelineIO | Částečně — pouze export | Ne | Ne |
| FCPXML | Částečně — pouze export | Ne | Ano — import a export |
| DAWproject | Ano — import a export, se zprávou o výměně | Ne | Ne |
| OMF | Ne | Ne | Částečně — import a export |
| Obousměrná výměna s video editorem | Částečně — předává stejný projekt do Framescaperu bez kopírování médií | Ne | Ano — Dynamic Link s Premiere Pro |
| Výměna štítků a značek | Ano — import a export | Ano — import a export | Ano — seznamy značek |

## Video

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Import videa pro referenci | Ano — na časové ose, s propojeným zvukem | Ne | Částečně — jedna video stopa, pouze náhled |
| Úpravy video časové osy | Částečně — základní úpravy, plná funkčnost je v Framescaperu | Ne | Ne |
| Export videa | Ano — MP4 a WebM prostřednictvím běhového prostředí FFmpeg | Ne | Ne — pouze zvuk |
| Kompozitní úpravy, barevné korekce a efekty | Částečně — v Framescaperu, na stejném projektu | Ne | Ne |

## Pomoc stroje

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Zlepšení řeči | Částečně — pouze desktop, po instalaci modelu | Ne | Ano — Enhance Speech |
| Transkripce a diarizace | Částečně — pouze desktop, volitelné modely | Ne | Ne — transkripty jsou v Premiere Pro |
| Separace zdrojů do stemů | Částečně — pouze desktop, volitelné modely | Ne | Ne |
| Automatické utlumení | Ano — efekt Auto Duck | Ano — efekt Auto Duck | Ano — utlumení Essential Sound |
| Detekce beatů a záběrů | Částečně — pouze desktop, volitelné modely | Ne | Částečně — Remix automaticky mění tempo hudby |
| Běží zcela na vašem stroji | Ano — inferencí pouze na desktopu a offline po instalaci | Ano — žádná inferencí | Částečně — některé funkce zpracovává v cloudu Adobe |
| Modely jsou volitelné a odstranitelné | Ano — staženo samostatně, s pevným otiskem, odstranitelné | Ano — nic k instalaci | Ne — zabudováno do aplikace |

## Na co se rozdíly sumují

Audacity 4 je editor s jedním průchodem. Nemá sběrače, posílání, dráhy automatizace ani makra v pevně dané verzi. Soundscaper si tento model úprav zachovává a přidává na něj vrstvu mixování, automatizace a dodávky, kromě nahrávání, videa a výměny dat, které Audacity nezkouší.

Audition stále vede v hloubce restaurování, v obousměrné výměně s Premiere Pro a v ambisonice. Kde Soundscaper vede, je v imerzivní dodávce, zpracování projektů a v tom, že běží v prohlížeči na hardwaru, který žádný z ostatních nepodporuje.

Pokud již pracujete v Audacity, viz
[soubory projektů a výměna s Audacity](/projects-and-data/project-files/) pro
přenos projektu.

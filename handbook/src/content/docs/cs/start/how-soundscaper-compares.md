---
title: "Jak se Soundscaper srovnává"
description: "Porovnejte Soundscaper s Audacity 4 a Adobe Audition v oblastech nahrávání, úprav, mixáže, distribuce a výměny."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"5b9d7c73cc9a759d623469a935b0c57325920832ea7775ef89dee9cdede4a17f","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5b9d7c73cc9a759d623469a935b0c57325920832ea7775ef89dee9cdede4a17f","targetLocale":"cs"} -->

Soundscaper znovu implementuje Audacity 4 na webu a přidává na něj vrstvu pro produkci. Adobe Audition je komerční nástroj pro postprodukci, vůči kterému se obvykle oba produkty měří. Tato stránka srovnává všechny tři, abyste mohli zjistit, který z nich už vykonává práci, kterou potřebujete.

## Jak číst tuto stránku

Každá buňka obsahuje **Ano**, **Částečně** nebo **Ne**, následované podrobností, která tento stav specifikuje.

**Částečně** pokrývá tři různé situace a poznámka uvádí, která se uplatňuje: funkce existuje, ale je užší než jinde; existuje, ale závisí na něčem, co musíte dodat; nebo je dosažitelná pouze obcházením chybějícího prvku.

Řádky popisují funkce, ne příkazy v menu. Přesný seznam příkazů naleznete v [Příkazy a zkratky](/reference/generated/commands/), a co každý produkt umožňuje, viz
[Funkce produktu](/reference/generated/product-capabilities/).

### Odkud pocházejí tyto tvrzení

- Řádky pro **Soundscaper** pocházejí z tohoto repozitáře: profily funkcí produktu, manifest akcí běhového prostředí a rejstřík formátů pro export.
  Některé nativní desktopové cesty jsou implementovány, ale stále jsou omezeny podepsanými datovými balíčky stroje; tyto řádky to uvádějí.
- Řádky pro **Audacity 4** pocházejí z inventáře horního proudu (upstream) pevně stanoveného v tomto repozitáři, `4.0.0` v commitu `4c177d43`. Funkce, kterou horní proud registruje, ale nechá vypnutou nebo vynechá z menu, je zaznamenána jako taková, a funkce bez registrace v pevně stanovené sestavě je hlášena jako v této sestavě nepřítomná, nikoli jako trvale chybějící.
- Řádky pro **Audition** pocházejí z publikované dokumentace Adobe pro aktuální vydání. Nejsou ověřeny proti běžící sestavě.

## Platforma a pojmy

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Licence | Ano — pouze AGPL-3.0 | Ano — GPL, open source | Ne — proprietární a uzavřená |
| Cena | Ano — zdarma | Ano — zdarma | Ne — předplatné Creative Cloud |
| Spouští se v prohlížeči | Ano — Chromium, Firefox a WebKit | Ne — pouze desktop | Ne — pouze desktop |
| Desktopové sestavy | Ano — Windows a Linux na x64 a ARM64, macOS na ARM64 | Ano — Windows, macOS, Linux | Částečně — Windows a macOS, bez Linuxu |
| Funguje bez účtu | Ano — účet neexistuje | Ano — přihlášení pouze pro audio.com | Ne — vyžaduje přihlášené předplatné |
| Ukládání projektů v cloudu | Ne — vyloučeno designem zaměřeným na lokální použití | Ano — ukládání a sdílení prostřednictvím audio.com | Částečně — soubory Creative Cloud, relace se nesynchronizují |
| Systémové požadavky | Ano — spouští se všude, kde běží aktuální prohlížeč | Částečně — podstatně vyšší než u Audacity 3 | Částečně — třída profesionálních pracovních stanovic |

## Model projektu a relace

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Nativní formát projektu | Ano — `.sscape`, ztrátový přenosný archiv | Ano — `.aup4` | Ano — `.sesx` |
| Otevírá projekty Audacity | Ano — import a export AUP4 | Ano — nativní | Ne |
| Nedestruktivní časová osa klipů | Ano | Ano | Ano — vícestopý editor |
| Samostatný editor jednoho souboru | Částečně — úpravy vzorků probíhají v časové ose | Částečně — úpravy se aplikují přímo v časové ose | Ano — editor vlnového tvaru |
| Mono a stereo obsah na jedné stopě | Ano — stopa drží buď mono nebo stereo | Ne — stopa je mono nebo stereo | Ne — formát kanálu je pevně stanoven pro stopu |
| Vnořené složky stop | Ano — libovolná hloubka, s možností vrácení a routováním | Ne | Částečně — pouze sběrnice submix, žádné složkové stopy |
| Koš projektu | Ano — organizuje soubory a slouží jako schránka | Ne | Částečně — panel Soubory vypisuje otevřené soubory |
| Automatické ukládání a obnova po pádu | Ano — automatické ukládání, zámky a obalové obaly pro obnovu | Ano | Ano |
| Značky a pojmenované oblasti | Ano — první třída, s navigací a chováním ripple | Částečně — stopy s popisky | Ano — značky a rozsahy |
| Mapy tempa a taktových znaků | Ano — uspořádané mapy vyřešené s přesností vzorku | Částečně — jedno tempo a taktový znak projektu | Částečně — jedno tempo relace |

## Záznam

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vícestopý záznam | Ano — více zdrojů najednou | Částečně — jedno vstupní zařízení najednou | Ano — vícevstupní a vícekanálové rozhraní |
| Mikrofon a zvuk desktopu najednou | Ano — vestavěné | Ne | Částečně — vyžaduje zařízení loopback operačního systému |
| Časovaný záznam | Ano | Ano | Ne |
| Záznam aktivovaný zvukem | Ano — s nastavitelnou prahovou hodnotou | Ano — s nastavitelnou prahovou hodnotou | Ne |
| Odpočet před záběrem | Ano — s ohledem na mapu tempa, zvládá složitý takt | Částečně — záznam úvodu | Částečně — pre-roll jako součást punch and roll |
| Punch záznam | Ano — jedna transakce, výchozí a routované zachycení | Ne | Ano — punch and roll |
| Záznam smyčky do záběrů | Ano — jedna dráha na průchod, připojená ke stejné skupině | Ne | Částečně — záběry na jednom klipu, vybrané ze seznamu |
| Comping záběrů | Ano — poslech, povýšení, úprava oblastí compu, zploštění jako jedna vrácitelná úprava | Ne | Ne — žádný editor compu |
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
| Kreslení na úrovni vzorků | Ano | Částečně — v pevně dané verzi není registrována akce kreslení | Ano — ve vlnovém editoru |
| Editace pouze pomocí klávesnice | Ano — každý editační prvek má navigační akci | Ano — každý editační prvek má navigační akci | Částečně — rozsáhlé zkratky, některé panely vyžadují myš |

## Spektrální práce a restaurování

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Zobrazení spektrogramu | Ano — s nastavením pro každou stopu | Ano — s nastavením pro každou stopu | Ano — zobrazení frekvence a tonální výšky |
| Výběr omezený frekvencemi | Ano | Ano | Ano — marquee a lasso |
| Spektrální štětec | Ano | Ano | Ano — štětec a bodové léčení |
| Smazání nebo zesílení spektrální oblasti | Ano — obě jako přímé akce | Ano — obě jako přímé akce | Částečně — aplikovat efekt na výběr |
| Oprava krátkých poškození | Ano — Oprava (Repair) | Ano — Oprava (Repair) | Ano — Auto Heal a Spot Healing Brush |
| Širokopásmové potlačení šumu | Ano — s zachyceným profilem | Ano — s zachyceným profilem | Ano — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Odstranění dozvuku | Ne | Ne | Ano — DeReverb |
| Nástroje pro klikání, hučení a sibilanci | Částečně — pouze Click Removal | Částečně — pouze Click Removal | Ano — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostický panel | Částečně — Find Clipping jako analyzér | Částečně — Find Clipping jako analyzér | Ano — diagnostika s opravou pro jednotlivé problémy |

## Efekty a zásuvné moduly

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Vestavěná sada efektů | Ano — 30 efektů Audacity, zabalené zásuvné moduly Nyquist a efekty první strany bez ekvivalentu ve výchozím zdroji, jako je bitcrusher | Ano — stejná vestavěná kolekce 30 efektů | Ano — přibližně padesát, včetně multiband dynamiky |
| Rack efektů v reálném čase pro každou stopu | Ano — širší sada efektů v reálném čase než ve výchozím zdroji | Ano | Ano — šestnáct slotů pro klip, stopu a master |
| Parametrický EQ | Ano — nový parametrický EQ s automatizovatelnými pásmy | Částečně — Filter Curve a Graphic EQ | Ano — parametrické, grafické a FFT filtry |
| Předvolby efektů | Ano — aplikovat, uložit, importovat, exportovat | Ano — aplikovat, uložit, importovat, exportovat | Ano |
| Makra a dávkové řetězce | Ano — uložená knihovna makt s šablonami | Ne — pevně daná verze má menu Macros zakomentované | Ano — Favorites a Batch Process |
| Formáty třetích stran pro zásuvné moduly | Částečně — VST3, CLAP, AU a LV2 na desktopu za souhlasu a izolace, v prohlížeči žádné | Ano — VST3, AU, LV2 a Nyquist, s manažerem zásuvných modulů | Částečně — VST3 a AU na macOS, bez CLAP nebo LV2 |
| Skriptování Nyquist | Ano — zabalené zásuvné moduly a prompt Nyquist | Ano — zabalené zásuvné moduly a prompt Nyquist | Ne |
| Izolované balíčky efektů | Částečně — prověřené balíčky WebAssembly, jeden je dodáván a externí jsou izolovány | Ne | Ne |
| Virtuální nástroje | Ne — po verzi 1.0 | Ne | Ne |

## Mixáž, routování a automatizace

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Mixér s kanálovými pruhy | Ano | Částečně — ovládání stop a master stopa | Ano |
| Buse a submixy | Ano — vnořené, s cyklickou validací | Ne | Ano — bus stopy |
| Sends | Ano — před a za faderem, více přiřazení | Ne | Ano — před a za faderem |
| Skupiny VCA | Ano | Ne | Ne |
| Vstup sidechain | Ano | Ne | Ano — přes sends |
| Cue a control-room mixy | Ano | Ne | Ne |
| Kompenzace zpoždění zásuvných modulů | Ano — přehrávání, monitorování, buse, sidechainy, renderování a zamrznutí | Částečně — není vystaveno v pevně daných zdrojích | Ano |
| Dráhy automatizace | Ano — zisk, pan, mute, sends, buse a parametry zásuvných modulů | Ne — žádné dráhy a žádný nástroj obálky v pevně dané verzi | Ano — hlasitost, pan a parametry efektů |
| Režimy automatizace | Ano — read, trim, touch, latch a write | Ne | Částečně — read, write, latch a touch, bez trim |
| Tvary křivek | Ano — line, hold a curve | Ne | Ano — lineární a spline |
| Zamrznutí stopy | Ano — zamrznutí, rozmrazení a commit bez ztráty stavu | Ne | Částečně — bounce do nové stopy |

## Metrování a analýza

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Měřič hlasitosti | Ano — ve stylu EBU R 128, s historií | Ne — efekt Loudness Normalization, ale bez měřiče | Ano — Loudness Radar podle ITU-R BS.1770 |
| Měřič fáze a korelace | Ano | Ne | Ano — měřič fáze a analýza |
| Metrování surroundu | Ano | Ne | Částečně — až 5.1 |
| Graf spektra | Ano — Plot Spectrum | Částečně — registrováno, ale pevně daná verze ho má zakomentované v menu Analyze | Ano — Frequency Analysis |
| Klipování a RMS ve vlně | Ano — oba, přepínatelné pro každý projekt | Ano — oba, přepínatelné pro každý projekt | Částečně — indikátory klipu, RMS v Amplitude Statistics |
| Kontrast srozumitelnosti řeči | Ano — analyzér Contrast | Částečně — registrováno, ale pevně daná verzi ho má zakomentované v menu Analyze | Ne |

## Kanály a immersivní audio

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Kanály na soubor | Ano — až 32 pro formáty PCM | Částečně — monofonní a stereofonní stopy | Ano — až 32 v editoru vlnového tvaru |
| Surround mixáž | Ano — postele až do konfigurace 7.1.4 | Ne | Částečně — až do konfigurace 5.1 |
| Objektové audio | Ano — objekty vedle postelí | Ne | Ne |
| Autoring a průchod ADM | Ano — BW64/ADM s kontrolami shody | Ne | Ne |
| Binaurální render | Ano — pojmenovaný binaurální model | Ne | Částečně — binauraliser pro ambisoniku |
| Ambisonika | Ne | Ne | Ano — první řád, s VR pannerem |

## Export a dodávka

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ztrátový výstup | Ano — WAV, AIFF, BWF a BW64 zapisované nativně | Ano — WAV, AIFF a FLAC | Ano — WAV, AIFF, FLAC a další |
| Ztrátový výstup | Částečně — MP3, AAC, Opus, Vorbis, MP2, FLAC a WavPack, vše prostřednictvím běhového prostředí FFmpeg | Částečně — MP3 vestavěné, zbytek prostřednictvím volitelné instalace FFmpeg | Ano — vestavěné |
| Vlastní nastavení kodéru | Ano — vlastní cíl FFmpeg | Ano — vlastní cíl FFmpeg | Ano — možnosti pro každý formát |
| Fronta exportu | Ano — pozastavení, zrušení, opakování a přeuspořádání | Ne — jeden export najednou | Částečně — Hromadné zpracování bez ovládání fronty |
| Stemy a alternativy v jednom průchodu | Ano — zařazeny do fronty společně s mixem | Ne | Částečně — jeden mixdown na stem |
| Dodávka podle oblastí | Ano — masterovací sekvence s metadaty pro každou oblast, mezerami a přechody | Částečně — export štítků, žádný export více souborů v pevně dané verzi | Ano — export značek do samostatných souborů |
| Normalizace hlasitosti při exportu | Ano — součást plánu dodávky | Částečně — nejdříve spustit efekt | Ano — Match Loudness |
| Dither a mapování kanálů | Ano — explicitní ovládací prvky | Částečně — dither v nastaveních | Ano — explicitní ovládací prvky |
| Zpráva o dodávce | Ano — položkově pro každý úkol | Ne | Ne |
| Fronta renderu přežije restart | Ano — na desktopu, restart od nuly bajtů s deníkem havárií | Ne | Ne |

## Výměna s jinými nástroji

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Projekty Audacity | Ano — vstup a výstup AUP4, s zprávou o vynechání | Ano — nativní | Ne |
| EDL | Částečně — export třídy CMX3600, bez importu | Ne | Ne |
| OpenTimelineIO | Částečně — pouze export | Ne | Ne |
| FCPXML | Částečně — pouze export | Ne | Ano — import a export |
| DAWproject | Ano — import a export, se zprávou o výměně | Ne | Ne |
| OMF | Ne | Ne | Částečně — import a export |
| Round-trip s video editorem | Částečně — předá stejný projekt do Framescaperu bez kopírování médií | Ne | Ano — Dynamic Link s Premiere Pro |
| Výměna štítků a značek | Ano — import a export | Ano — import a export | Ano — seznamy značek |

## Video

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Import videa pro referenci | Ano — na časové ose, s propojeným audiem | Ne | Částečně — jedna video stopa, pouze náhled |
| Editace video časové osy | Částečně — základní editace, plné rozhraní je v Framescaperu | Ne | Ne |
| Export videa | Ano — MP4 a WebM prostřednictvím běhového prostředí FFmpeg | Ne | Ne — pouze audio |
| Kompozitní, barevné korekce a efekty | Částečně — v Framescaperu, ve stejném projektu | Ne | Ne |

## Pomoc stroje

| Funkce | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Zlepšení řeči | Částečně — pouze desktop, po instalaci modelu | Ne | Ano — Enhance Speech |
| Transkripce a diarizace | Částečně — pouze desktop, volitelné modely | Ne | Ne — transkripty jsou v Premiere Pro |
| Separace zdrojů na stemy | Částečně — pouze desktop, volitelné modely | Ne | Ne |
| Automatické utlumení | Ano — efekt Auto Duck | Ano — efekt Auto Duck | Ano — utlumení v Essential Sound |
| Detekce beatů a záběrů | Částečně — pouze desktop, volitelné modely | Ne | Částečně — Remix automaticky mění tempo hudby |
| Běží zcela na vašem stroji | Ano — inferencing je pouze na desktopu a offline po instalaci | Ano — žádný inferencing | Částečně — některé funkce zpracovává v cloudu Adobe |
| Modely jsou volitelné a odstranitelné | Ano — stahované samostatně, s pevně daným stravným číslem, odstranitelné | Ano — nic k instalaci | Ne — zabalené s aplikací |

## Na co se rozdíly sumují

Audacity 4 je editor s jedním průchodem. Nemá sběrače, posílání, dráhy automatizace ani makra v pevně dané verzi. Soundscaper si ponechává tento editační model a přidává na něj vrstvu mixáže, automatizace a dodávky, kromě toho nahrávání, video a výměnu, které Audacity nezkouší.

Audition stále vede v hloubce restaurování, round-trip s Premiere Pro a ambisonice. Kde Soundscaper vede, je to imerzivní dodávka, zpracování projektů a skutečnost, že běží v prohlížeči na hardwaru, který žádný z ostatních nepodporuje.

Pokud již pracujete v Audacity, viz
[soubory projektů a výměna s Audacity](/projects-and-data/project-files/) pro
přenos projektu.

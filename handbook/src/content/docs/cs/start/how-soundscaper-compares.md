---
title: "Srovnání Soundscaperu"
description: "Porovnejte Soundscaper Web a Desktop s Audacity 4 a Adobe Audition při nahrávání, úpravách, mixování, distribuci a výměně dat."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"cs"} -->

Soundscaper znovu implementuje Audacity 4 na webu a přidává produkční vrstvu. Adobe Audition je komerční nástroj pro postprodukci, se kterým se oba obvykle srovnávají. Tato stránka porovnává Soundscaper Web a Desktop, Audacity 4 a Audition, abyste zjistili, která edice již zvládne to, co potřebujete.

## Jak číst tuto stránku

Každá buňka začíná barevným symbolem, za kterým následuje vysvětlující podrobnost:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — podporováno nebo použitelné
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — omezený rozsah, závislost na platformě nebo nutnost náhradního řešení
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — nedostupné nebo nepoužitelné

Poznámky čtěte společně se symboly. Volitelný zásuvný modul, model nebo kodek sám o sobě neznamená, že je podporovaná funkce na počítači omezená; poznámka uvádí, co je třeba nainstalovat. Web a Desktop mají samostatné sloupce, takže omezení prohlížeče nesnižuje hodnocení desktopové verze.

Řádky popisují funkce, ne příkazy v menu. Přesný seznam příkazů naleznete v [Příkazy a zkratky](/reference/generated/commands/), a co každý produkt umožňuje, naleznete v
[Funkce produktu](/reference/generated/product-capabilities/).

### Odkud pocházejí tyto tvrzení

- Řádky **Soundscaper** vycházejí z tohoto úložiště: profilů funkcí produktu, manifestu akcí za běhu, registru exportních formátů a bran podpory kodeků v prohlížeči a na počítači.
  Nativní cílové balíčky pro počítače vytváří CI úložiště nebo balení pro daný cíl. Balíček funkci povolí až po přípravě a ověření přesně odpovídajícího výsledku; řádky uvádějí, kdy je balíček stále potřeba.
- Řádky **Audacity 4** vycházejí z inventáře upstream připnutého v tomto úložišti, verze `4.0.0` při commitu `4c177d43`, a zahrnují změny viditelné uživatelům až do oficiálního [vydání `4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) při commitu `d82386ce`. Funkce, které upstream registruje, ale ponechává vypnuté nebo zakomentované v nabídce, jsou takto označené. Pokud funkce není v auditovaném inventáři ani poznámkách k vydání, uvádíme, že tam není, nikoli že chybí trvale. Kreslení vzorků, obálky zesílení klipu a import starších projektů popisuje také oficiální [seznam změn 4.0](https://www.audacityteam.org/changelog/) a [příručka zesílení klipu](https://www.audacityteam.org/manual/clips/clip-gain/).
- Řádky pro **Audition** pocházejí z publikované dokumentace Adobe pro aktuální vydání. Nejsou ověřeny proti běžící sestavě.

## Platforma a pojmy

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licence | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, open source | / — proprietární a uzavřená |
| Náklady | + — zdarma | + — zdarma | + — zdarma | / — předplatné Creative Cloud |
| Spouští se v prohlížeči | + — Chromium, Firefox a WebKit | / — zabalená aplikace | / — pouze desktop | / — pouze desktop |
| Sestavy pro desktop | / — použijte webovou verzi | + — Windows a Linux na x64 a ARM64, macOS na ARM64 | + — Windows (instalační nebo přenosná verze), macOS a Linux | ~ — Windows a macOS, bez Linuxu |
| Funguje bez účtu | + — účet neexistuje | + — účet neexistuje | + — přihlášení pouze pro audio.com | / — vyžaduje přihlášené předplatné |
| Ukládání projektů v cloudu | / — vyloučeno designem zaměřeným na lokální prostředí | / — vyloučeno designem zaměřeným na lokální prostředí | + — ukládání a sdílení prostřednictvím audio.com | ~ — soubory Creative Cloud, relace se nesynchronizují |
| Systémové požadavky | + — spouští se všude, kde běží aktuální prohlížeč | + — Windows, Linux nebo macOS na podporovaných architekturách počítačů | ~ — podstatně vyšší než u Audacity 3 | ~ — třída profesionální pracovní stanice |

## Model projektu a relace

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Nativní formát projektu | + — `.sscape`, bezstratná přenosná archiva | + — `.sscape`, bezstratná přenosná archiva | + — `.aup4` | + — `.sesx` |
| Otevírání projektů Audacity | + — import AUP, AUP3 a AUP4; export AUP3 a AUP4 | + — import AUP, AUP3 a AUP4; export AUP3 a AUP4 | + — import AUP, AUP3 a AUP4; export AUP4, bez exportu AUP3 | / |
| Nedestruktivní časová osa klipů | + | + | + | + — vícestopý editor |
| Samostatný editor souboru | + — editor zdrojové křivky ve vlastnostech klipu | + — editor zdrojové křivky ve vlastnostech klipu | ~ — úpravy se aplikují přímo v časové ose | + — editor vlnového tvaru |
| Mono a stereo obsah na jednom stopě | + — stopa obsahuje buď mono nebo stereo | + — stopa obsahuje buď mono nebo stereo | / — stopa je mono nebo stereo | / — kanálový formát je pevně stanoven pro stopu |
| Vložené složky stop | + — libovolná hloubka, s možností vrácení a routováním | + — libovolná hloubka, s možností vrácení a routováním | / | ~ — pouze sběrnice submix, bez složek stop |
| Koš projektu | + — organizuje soubory a slouží jako schránka | + — organizuje soubory a slouží jako schránka | / | ~ — panel Soubory zobrazuje otevřené soubory |
| Automatické ukládání a obnova po pádu | + — automatické ukládání, zámky a obalové soubory pro obnovu | + — automatické ukládání, zámky a obalové soubory pro obnovu | + | + |
| Značky a pojmenované oblasti | + — první třída, s navigací a chováním ripple | + — první třída, s navigací a chováním ripple | ~ — stopy s popisky | + — značky a rozsahy |
| Mapy tempa a taktových znaků | + — uspořádané mapy vyhodnocené s přesností vzorku | + — uspořádané mapy vyhodnocené s přesností vzorku | ~ — jedno tempo a taktový znak projektu | ~ — jedno tempo relace |

## Záznam

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Vícestopý záznam | + — více zdrojů najednou | + — více zdrojů najednou | ~ — jedno vstupní zařízení najednou | + — vícevstupní a vícekanálové rozhraní |
| Současný záznam mikrofonu a zvuku z počítače | ~ — vestavěné tam, kde prohlížeč a operační systém zpřístupňují zvuk obrazovky | + — mikrofon a zpětná smyčka plochy ve Windows; jinde se používá vstup zpětné smyčky | / | ~ — vyžaduje zařízení loopback operačního systému |
| Časovaný záznam | + | + | + | / |
| Záznam aktivovaný zvukem | + — s nastavitelnou prahovou hodnotou | + — s nastavitelnou prahovou hodnotou | + — s nastavitelnou prahovou hodnotou | / |
| Odpočet před nahráváním | + — s ohledem na mapu tempa, zvládá složené metrum | + — s ohledem na mapu tempa, zvládá složené metrum | ~ — záznam úvodu | ~ — předběh jako součást punch and roll |
| Punch záznam | + — jedna transakce, výchozí a routované zachycení | + — jedna transakce, výchozí a routované zachycení | / | + — punch and roll |
| Smyčkový záznam do nahrávek | + — jedna dráha na průchod, připojeno ke stejné skupině | + — jedna dráha na průchod, připojeno ke stejné skupině | / | ~ — nahrávky na jednom klipu, vybrané ze seznamu |
| Comping nahrávek | + — poslech, povýšení, úprava oblastí compu, sploštění jako jedna vracitelná úprava | + — poslech, povýšení, úprava oblastí compu, sploštění jako jedna vracitelná úprava | / | / — žádný editor compu |
| Monitorování a měření vstupu | + | + | + | + |

## Úpravy časové osy

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Varianty ripple edit | + — pro klip, pro stopu a pro všechny stopy, při řezu a smazání | + — pro klip, pro stopu a pro všechny stopy, při řezu a smazání | + — stejné tři, při řezu a smazání | ~ — ripple delete pro výběr nebo mezery |
| Rozdělení, spojení a rozdělení na tichých místech | + | + | + | ~ — rozdělení a ořez, bez spojení klipů |
| Skupiny klipů | + | + | + | + |
| Zisk (gain) klipu | + | + | + | + |
| Tonální výška a rychlost pro každý klip | + — úprava, renderování nebo reset | + — úprava, renderování nebo reset | + — úprava, renderování nebo reset | ~ — stretch zůstává editovatelný, tonální výška je efekt |
| Sledování změn tempa | + — klipy se natahují, když se mapa pohybuje | + — klipy se natahují, když se mapa pohybuje | + | / |
| Kvantizace a groove s ohledem na beaty | + — warp mapy s nastavitelnou intenzitou groove | + — warp mapy s nastavitelnou intenzitou groove | / | / |
| Přichycení k nulovým průchodům | + | + | + | + |
| Kreslení na úrovni vzorků | + | + | + — dostupné při přiblížení na jednotlivé vzorky | + — ve vlnovém editoru |
| Editace pouze pomocí klávesnice | + — každý editační prvek má navigační akci | + — každý editační prvek má navigační akci | + — akce úprav, časovou osu a svislá pravítka stop lze ovládat klávesnicí | ~ — rozsáhlé zkratky, některé panely vyžadují myš |

## Spektrální práce a restaurování

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Zobrazení spektrogramu | + — s nastavením pro každou stopu | + — s nastavením pro každou stopu | + — s nastavením pro každou stopu | + — zobrazení frekvence a tonální výšky |
| Výběr ohraničený frekvencemi | + | + | + | + — marquee a lasso |
| Spektrální štětec | + | + | + | + — paintbrush a spot healing |
| Smazání nebo zesílení spektrální oblasti | + — obě jako přímé akce | + — obě jako přímé akce | + — obě jako přímé akce | ~ — aplikovat efekt na výběr |
| Oprava krátkých poškození | + — Repair | + — Repair | + — Repair | + — Auto Heal a Spot Healing Brush |
| Širokopásmové potlačení šumu | + — s zachyceným profilem | + — s zachyceným profilem | + — s zachyceným profilem | + — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Odstranění dozvuku | / — asistence pouze v desktopové verzi | + — Reduce Reverb po instalaci volitelného modelu a enginu | / | + — DeReverb |
| Nástroje pro klikání, hučení a sibilanci | ~ — odstranění kliknutí a De-esser; bez samostatného odstranění brumu | ~ — odstranění kliknutí a De-esser; bez samostatného odstranění brumu | ~ — pouze Click Removal | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Diagnostický panel | ~ — Find Clipping jako analyzér | ~ — Find Clipping jako analyzér | ~ — Find Clipping jako analyzér | + — diagnostika s opravou pro jednotlivé problémy |

## Efekty a zásuvné moduly

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Vestavěná sada efektů | + — efekty odvozené z Audacity, přibalené zásuvné moduly Nyquist a vlastní efekty jako Bitcrusher a De-esser | + — efekty odvozené z Audacity, přibalené zásuvné moduly Nyquist a vlastní efekty jako Bitcrusher a De-esser | + — 30 vestavěných efektů v připnutém sestavení | + — přibližně padesát, včetně multibandové dynamiky |
| Reálný časový efektový rack pro každý stopu | + — širší sada reálného času než ve výchozím kódu | + — širší sada reálného času než ve výchozím kódu | + | + — šestnáct slotů na klip, stopu a master |
| Parametrický EQ | + — nový parametrický EQ s automatizovatelnými pásmy | + — nový parametrický EQ s automatizovatelnými pásmy | ~ — Filter Curve a Graphic EQ | + — parametrické, grafické a FFT filtry |
| Předvolby efektů | + — aplikovat, uložit, importovat, exportovat | + — aplikovat, uložit, importovat, exportovat | + — aplikovat, uložit, importovat, exportovat | + |
| Makra a dávkové řetězce | + — uložená knihovna mokr s šablonami | + — uložená knihovna mokr s šablonami | / — připnutá build verze má zakomentované menu Makra | + — Oblíbené a Batch Process |
| Formáty třetích stran plug-inů | / — nativní zásuvné moduly vyžadují desktopovou verzi | + — VST3, CLAP, AU, LV2, Linux LADSPA a Vamp; podle platformy, se souhlasem a izolací | + — VST3, AU, LV2 a Nyquist, s manažerem plug-inů | ~ — VST3 a AU na macOS, bez CLAP nebo LV2 |
| Skriptování Nyquist | + — balíčkové plug-iny a prompt Nyquist | + — balíčkové plug-iny a prompt Nyquist | + — balíčkové plug-iny a prompt Nyquist | / |
| Izolované balíčky efektů | ~ — prověřené balíčky WebAssembly, jeden je dodáván a externí jsou izolovány | ~ — prověřené balíčky WebAssembly, jeden je dodáván a externí jsou izolovány | / | / |
| Virtuální nástroje | / | / | / | / |

## Mixáž, routování a automatizace

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mixér s kanálovými pruhy | + | + | ~ — ovládání stop a master stopa | + |
| Buse a submixy | + — vnořené, s cyklickou validací | + — vnořené, s cyklickou validací | / | + — bus stopy |
| Sends | + — pre a post fader, více přiřazení | + — pre a post fader, více přiřazení | / | + — pre a post fader |
| Skupiny VCA | + | + | / | / |
| Vstup sidechain | + | + | / | + — přes sends |
| Cue a control-room mixy | + | + | / | / |
| Kompenzace zpoždění plug-inů | + — přehrávání, monitorování, buse, sidechainy, render a freeze | + — přehrávání, monitorování, buse, sidechainy, render a freeze | ~ — nevyjádřeno v připnutých zdrojích | + |
| Dráhy automatizace | + — gain, pan, mute, sends, buse a parametry plug-inů | + — gain, pan, mute, sends, buse a parametry plug-inů | ~ — obálky zesílení klipu; bez automatizačních stop pro stopy a efekty | + — hlasitost, pan a parametry efektů |
| Režimy automatizace | + — read, trim, touch, latch a write | + — read, trim, touch, latch a write | / | ~ — read, write, latch a touch, bez trim |
| Tvary křivek | + — line, hold a curve | + — line, hold a curve | ~ — pouze obálky zesílení klipu | + — lineární a spline |
| Zamrznutí stopy | + — freeze, unfreeze a commit bez ztráty stavu | + — freeze, unfreeze a commit bez ztráty stavu | / | ~ — bounce do nové stopy |

## Metrování a analýza

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Měřič hlasitosti | + — ve stylu EBU R 128, s historií | + — ve stylu EBU R 128, s historií | / — efekt Normalizace hlasitosti, ale bez měřiče | + — Loudness Radar podle ITU-R BS.1770 |
| Měřič fáze a korelace | + | + | / | + — měřič fáze a analýza |
| Měření surround | + | + | / | ~ — až 5.1 |
| Spektrální graf | + — Plot Spectrum | + — Plot Spectrum | ~ — registrováno, ale v pevně dané verzi je zakomentováno v menu Analyzovat | + — Frequency Analysis |
| Klipování a RMS ve vlnovém tvaru | + — přepínače projektu s přepsáním RMS pro jednotlivé stopy | + — přepínače projektu s přepsáním RMS pro jednotlivé stopy | + — oba, přepínatelné pro každý projekt | ~ — indikátory klipování, RMS v Amplitude Statistics |
| Kontrast srozumitelnosti řeči | + — analyzátor kontrastu | + — analyzátor kontrastu | ~ — registrováno, ale v pevně dané verzi je zakomentováno v menu Analyzovat | / |

V Soundscaperu otevřete nabídku **Zobrazení stopy** a přepněte **Půlvlnu** nebo **Zobrazit RMS v průběhu**. Výchozí zobrazení, frekvence třípásmové výhybky a nastavení spektrogramu najdete v **Úpravy → Předvolby → Zobrazení stopy**.

## Kanály a immersivní zvuk

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Počet kanálů na soubor | + — až 32 pro formáty PCM | + — až 32 pro formáty PCM | ~ — monofonní a stereofonní stopy | + — až 32 ve vlnovém editoru |
| Surround mixáž | + — postele až 7.1.4 | + — postele až 7.1.4 | / | ~ — až 5.1 |
| Objektový zvuk | + — objekty vedle postelí | + — objekty vedle postelí | / | / |
| Autoring ADM a průchod | + — BW64/ADM s kontrolami shody | + — BW64/ADM s kontrolami shody | / | / |
| Binaurální render | + — pojmenovaný binaurální model | + — pojmenovaný binaurální model | / | ~ — binauralizér pro ambisonics |
| Ambisonics | / | / | / | + — první řád, s VR pannerem |

## Export a dodávka

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ztrátový výstup | + — nativní WAV, AIFF, BWF a BW64; FLAC a WavPack přes specializované kodeky | + — nativní WAV, AIFF, BWF a BW64; FLAC a WavPack přes specializované kodeky | + — WAV, AIFF a FLAC | + — WAV, AIFF, FLAC a další |
| Ztrátový výstup | ~ — MP3, MP2, Opus a Ogg Vorbis; AAC závisí na prohlížeči | + — MP3, MP2, Opus, Ogg Vorbis a AAC přes podporované poskytovatele kodeků včetně nakonfigurovaného FFmpeg | + — MP3, Opus a Ogg Vorbis; další formáty přes volitelný FFmpeg | ~ — MP2, MP3 a Ogg Vorbis; další přes Adobe Media Encoder, bez obecného cíle FFmpeg |
| Vlastní nastavení kodéru | ~ — ovládání pro jednotlivé formáty; vlastní argumenty FFmpeg nejsou k dispozici | ~ — ovládání pro jednotlivé formáty; vlastní argumenty FFmpeg nejsou k dispozici | + — vlastní cíl FFmpeg | + — možnosti pro každý formát |
| Fronta exportu | + — pozastavení, zrušení, opakování a přeuspořádání | + — pozastavení, zrušení, opakování a přeuspořádání | / — Export Multiple je jediná sekvenční operace, nikoli fronta úloh | ~ — Batch Process bez ovládání fronty |
| Stemy a alternativy v jednom průchodu | + — zařazeny do fronty společně s mixem | + — zařazeny do fronty společně s mixem | ~ — Export Multiple ukládá každou stopu zvlášť, ale nezařazuje mix a alternativní renderování společně do fronty | ~ — jeden mixdown na stem |
| Dodávka podle oblastí | + — masterovací sekvence s metadaty pro každou oblast, mezerami a přechody | + — masterovací sekvence s metadaty pro každou oblast, mezerami a přechody | + — Export Multiple ukládá každou označenou oblast do samostatného souboru | + — export značek do samostatných souborů |
| Normalizace hlasitosti při exportu | + — součást plánu dodávky | + — součást plánu dodávky | ~ — nejdříve spustit efekt | + — Match Loudness |
| Dither a mapování kanálů | + — explicitní ovládací prvky | + — explicitní ovládací prvky | ~ — dither v nastaveních | + — explicitní ovládací prvky |
| Zpráva o dodávce | + — položkově pro každý úkol | + — položkově pro každý úkol | / | / |
| Fronta renderu přežije restart | / — trvalé obnovení renderování vyžaduje desktopovou verzi | + — začíná znovu od nultého bajtu se záznamem o pádu | / | / |

Soundscaper Desktop může pro podporované exportní formáty používat nakonfigurovaný FFmpeg; aktuální editor nenabízí libovolné argumenty FFmpeg ani všechny jeho enkodéry. Zaregistrované cíle najdete v části [Exportní formáty](/reference/generated/formats/). [Exportní postup](https://www.audacityteam.org/manual/getting-started/export-your-audio/) Audacity přidává formáty pomocí volitelné instalace FFmpeg. Audition nabízí pevnou sadu zapisovačů souborů a [předání do Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Výměna s jinými nástroji

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Projekty Audacity | + — import AUP, AUP3 a AUP4; export AUP3 a AUP4 se zprávou o kompatibilitě | + — import AUP, AUP3 a AUP4; export AUP3 a AUP4 se zprávou o kompatibilitě | + — import AUP, AUP3 a AUP4; export AUP4, bez exportu AUP3 | / |
| Audition-Sitzungen | / — import SESX vyžaduje Desktop | ~ — import audia `.sesx` se zprávou o vynechaných položkách; bez exportu | / — v připnutém sestavení není import SESX | + — nativní |
| EDL | ~ — export třídy CMX3600, bez importu | ~ — export třídy CMX3600, bez importu | / | / |
| OpenTimelineIO | ~ — pouze export | ~ — pouze export | / | / |
| FCPXML | ~ — pouze export | ~ — pouze export | / | + — import a export |
| DAWproject | + — import a export, se zprávou o výměně | + — import a export, se zprávou o výměně | / | / |
| OMF | / | / | / | ~ — import a export |
| Obousměrná výměna s video editorem | ~ — předává stejný projekt do Framescaperu bez kopírování médií | ~ — předává stejný projekt do Framescaperu bez kopírování médií | / | + — Dynamic Link s Premiere Pro |
| Výměna štítků a značek | + — import a export | + — import a export | + — import a export | + — seznamy značek |

Informace o tom, která nastavení zvuku se při importu `.sesx` z Audition přenesou a co zpráva označí jako vynechané, najdete v části [Soubory projektů](/projects-and-data/project-files/).

## Video

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Import videa pro referenci | + — na časové ose, s propojeným zvukem | + — na časové ose, s propojeným zvukem | / | ~ — jedna video stopa, pouze náhled |
| Úpravy video časové osy | ~ — základní úpravy, plná funkčnost je v Framescaperu | ~ — základní úpravy, plná funkčnost je v Framescaperu | / | / |
| Export videa | ~ — MP4 a WebM tam, kde WebCodecs v prohlížeči podporuje potřebné kodeky | + — MP4 a WebM s ověřeným poskytovatelem desktopových kodeků | / | / — pouze zvuk |
| Kompozitní úpravy, barevné korekce a efekty | ~ — v Framescaperu, na stejném projektu | ~ — v Framescaperu, na stejném projektu | / | / |

## Pomoc stroje

Asistence v desktopové verzi je k dispozici po instalaci volitelných vah modelu a odpovídajícího nativního enginu; tyto pracovní postupy nejsou dostupné ve Webu. Správce modelů nainstaluje obojí. Dostupné postupy a modely uvádí [Místní asistence](/reference/generated/local-assistance/).

| Funkce | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Zlepšení řeči | / — asistence pouze v desktopové verzi | + — s nainstalovaným volitelným modelem a enginem | / | + — Enhance Speech |
| Transkripce a diarizace | / — asistence pouze v desktopové verzi | + — s nainstalovanými volitelnými modely a enginy | / | / — transkripty jsou v Premiere Pro |
| Separace zdrojů do stemů | / — asistence pouze v desktopové verzi | + — s nainstalovaným volitelným modelem a enginem | / | / |
| Automatické utlumení | + — efekt Auto Duck | + — efekt Auto Duck | + — efekt Auto Duck | + — utlumení Essential Sound |
| Detekce beatů a záběrů | / — detekce dob vyžaduje Desktop; detekce záběrů je ve Framescaperu | ~ — detekce dob s volitelným modelem; detekce záběrů je ve Framescaperu | / | ~ — Remix automaticky mění tempo hudby |
| Běží zcela na vašem stroji | + — místní zpracování v prohlížeči; bez inference modelu | + — místní zpracování a offline inference po instalaci modelu | + — žádná inferencí | ~ — některé funkce zpracovává v cloudu Adobe |
| Modely jsou volitelné a odstranitelné | / — ve Webu se modely neinstalují | + — staženo samostatně, s pevným otiskem, odstranitelné | + — nic k instalaci | / — zabudováno do aplikace |

## Na co se rozdíly sumují

Audacity 4 je editor s jediným průchodem. V připnutém sestavení nemá sběrnice, odesílání, automatizační stopy pro stopy ani efekty a makra. Obálky zesílení klipu umožňují automatizovat hlasitost uvnitř klipu. Soundscaper zachovává tento model úprav a přidává automatizaci stop a efektů, mixování a distribuci i funkce nahrávání, videa a výměny, kterými se Audacity nezabývá.

Audition stále vyniká hloubkou obnovy, výměnou projektů s Premiere Pro a ambisonickým zvukem. Soundscaper nabízí lepší prostorovou distribuci, správu projektů a možnost běhu v prohlížeči na hardwaru, který ostatní dva nepodporují.

Pokud již pracujete v Audacity, v části [Soubory projektů a výměna s Audacity](/projects-and-data/project-files/) najdete informace o přenosu projektu.

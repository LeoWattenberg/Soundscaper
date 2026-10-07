---
title: "Místní zpracování, modely a pluginy"
description: "Najděte místní pomoc podle úkolu a spravujte modely a pluginy v desktopových editorech."
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"cs"} -->

Místní pomoc funguje na vašem zařízení v desktopových editorech Soundscaper a Framescaper. Vyberte média, pak zvolte úkol z jeho nabídky. Dialog zobrazuje výběr, nastavení úkolu a informace o tom, zda jsou jeho modely nainstalovány.

Desktopové balíčky neobsahují volitelné nativní procesory ani váhy modelů. Nainstalujte model pomocí Správce modelů, čímž stáhnete potřebný engine i váhy, a poté spusťte úlohu nad vybranými médii. První instalace vyžaduje připojení k síti; další zpracování probíhá místně. V příručce modelu najdete podporované platformy, položku nabídky a požadavky.

Další informace najdete v [příručky jednotlivých modelů](/reference/local-models/).

## Najít úkol {#find-a-task}

| Nabídka | Úkoly |
| --- | --- |
| Efekt → Odstranění a oprava šumu | Zlepšit dialog, snížit ozvěnu, vyčistit výplně a ticho |
| Efekt → Oddělení zdrojů | Oddělit dialog / hudbu / efekty |
| Analyzovat → Řeč | Přepis a titulky, identifikovat mluvčí, označit reakce |
| Analyzovat → Hudba | Detekce beatů a tempa |
| Analyzovat → Video | Označit střihy |
| Efekt → Video efekty | Přerámovat |
| Upravit | Vytvořit zvýraznění |
| Generovat | Generovat redakční text |
| Nástroje → Vyhledávání | Indexované vyhledávání, indexovat přepis, indexovat video |

Úkoly videa patří do Framescaperu. K dispozici jsou příkazy v závislosti na desktopovém runtime a schopnostech produktu. Možnost efektu v abecedním pořadí v Soundscaperu také řadí místní procesovací efekty podle názvu.

Zvolte **Spustit lokálně**, aby se spustilo zpracování a zobrazilo se místní výzva k souhlasu. Zpracování můžete zrušit. Po výběru **Zkontrolovat výsledek** vyberte požadované výsledky a zvolte **Použít vybrané**. Přijaté úpravy projektu lze vrátit. Zavření úkolu neuplatní jeho návrhy.

**Nástroje → Pokročilé místní zpracování** zachovává individuální výběr operací a modelů. Technické podrobnosti v dialozích úkolů zobrazují podkladové kroky a přesná nastavení, pokud je to nutné.

## Správa modelů {#manage-models}

Otevřete **Nástroje → Správce modelů** nebo použijte **Spravovat modely** uvnitř úkolu. Odkaz na úkol filtruje seznam kompatibilními identitami modelů; **Zobrazit všechny modely** tento omezení zruší. Vyhledejte podle názvu nebo úkolu a filtrujte podle stavu instalace.

Modely instalujte výslovně. První instalace stáhne také chybějící nativní běhové prostředí sdílené tímto modelem. U stahování se zobrazuje průběh a lze je zrušit. Po návratu k úloze zůstane její nastavení zachováno a obnoví se dostupnost modelu; zpracování se nespustí. Rozbalte **Úložiště a ověření** kvůli opravám, úklidu, přesunu úložiště, licencím a offline instalaci ze složky. Model nainstalovaný z offline souborů stále potřebuje před prvním použitím odpovídající běhové prostředí.

Pro každý publikovaný model naleznete v [průvodcích jednotlivými modely](/reference/local-models/) informace o účelu, položce nabídky, velikosti stažení, požadavcích, omezeních a skutečných kontrolách odvození provedených desktopovým balíčkem s nočním testováním.

## Správa pluginů a zařízení {#manage-plugins-and-devices}

**Efekt → Správce pluginů** zobrazuje seznam audio pluginů v Soundscaperu a OpenFX pluginů v Framescaperu. Vyhledejte nebo filtrujte seznam a vyberte plugin pro jeho verzi, oprávnění a ovládací prvky obnovy. **Skenování a nastavení** obsahuje nastavení objevování.

Použijte audio pluginy prostřednictvím **Efekt → Audio pluginy**. Příkazy pro přidání/úpravu video efektu v Framescaperu zůstávají pod **Efekt → Video efekty**.

Otevřete **Upravit → Preferenci → Nastavení zvuku** pro nativní audio zařízení a pomocné ovládací prvky. **Média** obsahují nativní nastavení médií; **Efekty** odkazují na Správce pluginů a obsahují přepínač objevování pluginů. Oprávnění pluginů a karanténa obnovy stále vyžadují explicitní akce.

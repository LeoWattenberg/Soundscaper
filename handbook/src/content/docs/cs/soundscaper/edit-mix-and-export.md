---
title: "Upravit, smíchat a exportovat"
description: "Uspořádejte klipy, vyvažte stopy, použijte efekty a vytvořte soubor pro dodání."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"bfda7c2ec70bde9259e6f3f3c0d5569fa2f06892db5d73c940df8d314dcfadb9","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"bfda7c2ec70bde9259e6f3f3c0d5569fa2f06892db5d73c940df8d314dcfadb9","targetLocale":"cs"} -->

## Uspořádání klipů

Před výběrem příkazu úpravy vyberte klipy nebo časový rozsah. Rozdělení vytváří
úpravovou hranici na časové ose. Varianty zachovávající mezeru a vlna určují, zda
pozdější materiál zůstane na místě nebo se posune, aby se uzavřel odstraněný region.

Používejte složky drah, skupiny klipů a Projektový koš k udržení větších projektů
organizovaných.

## Vytvoření mixu

Použijte ovládací prvky zisku, panoramatického zvuku, ztlumení a sóla pro vyvážení projektu. Panel Mixér
zobrazuje stejný stav projektu v rozvržení orientovaném na mix. Reálné efekty
zůstávají nastavitelné; destruktivní nebo vykreslené operace vytvářejí změny v projektu,
které lze vrátit zpět, dokud je k dispozici historie.

Použijte měřič přehrávání a analýzu hlasitosti ke kontrole výsledku. Vyhněte se
léčbě cílového měřiče jako náhražce poslechu kompletního exportu.

## Export

Vyberte **Soubor → Export zvuku** pro smíchaný výstup nebo **Export vybraného zvuku**,
když by měl být vykreslen pouze vybraný úsek. Soundscaper může také exportovat
stemy a štítky.

Komprimované formáty používají runtime FFmpeg. Přesné formáty a podmíněná dostupnost
sou uvedeny v [generované referenci formátu](/reference/).

Přehrávejte exportovaný soubor v jiné aplikaci, než odstraníte zdrojový materiál.

Pro práci s obrázky – skládání sekvence, video efekty a MP4 nebo WebM výstup –
předejte projekt [Framescaperu](/framescaper/) a podívejte se na
[export videa](/framescaper/video-export/).
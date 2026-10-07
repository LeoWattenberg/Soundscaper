---
title: "Export videa"
description: "Ověřte složenou sekvenci a vytvořte dodávací soubor MP4 nebo WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"cs"} -->

## Před exportem

- Projděte kompletní sekvenci a všechny hranice úprav.
- Ověřte, že viditelné a soloované stopy vytvářejí požadovaný obraz.
- Zkontrolujte, že propojený audio zůstává synchronizovaný.
- Potvrďte rozsah exportu a zda mají být zahrnuty titulky nebo audio.

## Vytvoření souboru

Otevřete dialog pro export a vyberte formát videa. Framescaper podporuje distribuci MP4 a
WebM prostřednictvím nakonfigurovaného video runtime. Zvolte rozměry,
snímkovou frekvenci a další možnosti vhodné pro cílové prostředí.

Video kódování je náročnější na zdroje než běžné přehrávání časové osy.
Nechte editor otevřený, dokud export neoznámí dokončení.

## Samostatný export zvukových klipů {#export-audio-clips}

Zvolte **Soubor → Exportovat video**, vyberte zvukový formát, například **WAV**, a nastavte **Výstup** na **Jednotlivé klipy (rozdělit podle klipů)**. Export stáhne archiv se souborem pro každý zvukový klip. Videoklipy se vynechají a každý zvukový soubor obsahuje pouze příslušný klip včetně ořezů a úprav klipu.

Soubory začínají na slyšitelném začátku klipu, bez doplnění do jeho polohy v projektu nebo dozvuku efektu. Číslované názvy klipů odlišují opakující se názvy.

Efekty stopy jsou zahrnuty; efekty masteru, ztlumení a sólo tento export neovlivní. Společný zvukový postup najdete v části [Export klipů jako samostatných souborů](/soundscaper/edit-mix-and-export/#export-clips).

## Ověření dodávky

Otevřete exportovaný soubor v samostatném přehrávači. Zkontrolujte jeho délku, první a poslední
snímky, orientaci obrazu, synchronizaci audio a očekávané titulky.

Vykreslené video nemůže nahradit editovatelný projekt. Pokud potřebujete zachovat časovou osu a média projektu, exportujte také kopii `.fscape`.

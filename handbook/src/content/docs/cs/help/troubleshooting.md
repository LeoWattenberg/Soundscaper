---
title: "Řešení problémů"
description: "Vyřešte běžné problémy s nahráváním, úložištěm, importem a exportem."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"cs"} -->

## Chybí vstupní zdroj nahrávání

Zkontrolujte oprávnění mikrofonu v operačním systému a prohlížeči, poté znovu otevřete
výběr zařízení. Při vícestopém nahrávání se ujistěte, že každá aktivovaná stopa má
přiřazený dostupný vstup.

## Příkaz je zakázán

Mnoho příkazů závisí na aktuálním stavu. Vyberte požadovaný projekt, stopu,
klip nebo časový rozsah a zkuste to znovu. Funkce může být také záměrně omezena
na Soundscaper nebo Framescaper.

## Import spotřebuje příliš mnoho paměti

Komprimované dekodování a některé velké operace mohou vyžadovat značnou dočasnou
paměť, i když je uložený zvuk projektu rozdělen do segmentů. Zavřete nesouvisející
záložky nebo aplikace, zkuste to znovu s menším zdrojem nebo použijte desktopovou
verzi, pokud je to vhodné.

## Projekt zmizel z prohlížeče

Ověřte, že jste otevřeli stejný profil prohlížeče, původ a web produktu.
Soundscaper a Framescaper sdílejí knihovnu na stejném `soundscaper.org`
původu, ale jiná doména, profil prohlížeče nebo vymazané úložiště webu má
jinou knihovnu.

Pokud byly vymazány data webu a neexistuje export projektu Scape, editor nemá
žádnou cloudovou kopii pro obnovení.

## AUP4 vynechal část projektu

Přečtěte si zprávu o kompatibilitě. AUP4 nese kompatibilní stav zvukového
úpravy, ale vynechává video a může převádět nebo vynechávat efekty a stav
míchání pouze pro Soundscaper. Pro úplný přenos projektu použijte soubor projektu
Scape — `.sscape` nebo `.fscape`, oba se dají otevřít v
kterémkoli produktu.

## Export selže nebo se nepřehraje

Zkuste to znovu po ověření, že vybraný rozsah obsahuje přehratelný materiál. Pro
komprimovaný zvuk nebo video ověřte, že se runtime assety mohou načíst. Po
úspěšném exportu otestujte skutečný soubor v jiném přehrávači.

Pro nevyřešené problémy použijte **Pomoc → Podpora** ke kontaktu s údržbářem a
zahrňte produkt, platformu, verzi prohlížeče nebo desktopu, kroky a přesnou chybu.

---
title: "Magazynowanie, kopie zapasowe i prywatność"
description: "Zrozumienie lokalnego priorytetu magazynowania i ochrona projektów przed utratą przeglądarki lub urządzenia."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"pl"} -->

## Co oznacza podejście lokalne najpierw

Projekty, nagrania i zaimportowane media są przetwarzane i przechowywane na Twoim
sprzęcie. Edytor nie wymaga konta ani nie synchronizuje projektów z usługą
Soundscaper.

W sieci web audio i media wykorzystują system plików pochodzenia prywatnego przeglądarki, gdy
jest dostępny, z IndexedDB jako rozwiązaniem zapasowym. Soundscaper żąda trwałego
magazynu, ale przeglądarka decyduje, czy zezwolić na to.

## Co może usunąć projekt

- Wyczyszczenie danych witryny usuwa lokalną bibliotekę projektów przeglądarki.
- Prywatne lub ograniczone konteksty przeglądarki mogą korzystać z pamięci tymczasowej.
- Polityki kwoty i usuwania przeglądarki pozostają autorytatywne.
- Ręczne usunięcie danych aplikacji pulpitu ręcznie usuwa jej lokalną bibliotekę.
- Awaria urządzenia lub pamięci masowej może usunąć każdą lokalną kopię na tym urządzeniu.

Odinstalowanie spakowanej wersji pulpitu ma na celu zachowanie jej biblioteki, ale
nie jest to strategia tworzenia kopii zapasowych.

## Rutynowa kopia zapasowa

W przydatnych punktach orientacyjnych i przed wyczyszczeniem lub migracją pamięci masowej:

1. Poczekaj na zakończenie lokalnego zapisywania.
2. Wyeksportuj plik projektu Scape (`.sscape` lub `.fscape`).
3. Wyeksportuj i odtwórz gotowy materiał do dostarczenia.
4. Skopiuj oba do pamięci masowej poza lokalnymi danymi edytora.

Użyj również AUP4, gdy wymiana Audacity jest ważna, a nie zamiast kopii projektu
Scape.

## Prywatność witryny dokumentacji

Podręcznik ten jest dostarczany jako pliki statyczne i wykorzystuje lokalne wyszukiwanie
przeglądarki. Strona V1 nie dodaje usługi analitycznej ani zaplecza AI/wyszukiwania.

Pełna [polityka prywatności Soundscaper i Framescaper](https://soundscaper.org/privacy/en/)
objjmuje również dostarczanie aplikacji, uprawnienia urządzenia, opcjonalne pobieranie,
sprawdzanie aktualizacji pulpitu i połączenia VCR sieci web Framescaper.

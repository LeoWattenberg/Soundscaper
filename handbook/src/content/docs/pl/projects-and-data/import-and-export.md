---
title: "Import i eksport"
description: "Poznaj różnice między materiałem źródłowym, plikami projektu, plikami wymiany i wyrenderowanymi plikami wynikowymi."
sidebar:
  order: 1
---

<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"pl"} -->

Soundscaper używa różnych typów plików do różnych zadań.

## Materiały źródłowe

Do importowania audio, wideo i etykiet użyj polecenia **Plik → Importuj**. Bieżąca podpowiedź edytora wymienia formaty AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF i WebM; ścieżka importu wideo obsługuje też dodatkowe kontenery. Dostępność może zależeć od aktywnego produktu i środowiska wykonawczego.

Import multimediów dodaje źródło należące do projektu. Nie zamienia oryginalnego pliku w edytowalny dokument projektu.

Import i eksport skompresowanego audio obsługują pliki o długości do jednej godziny lub rozmiarze 1 GB (1 000 000 000 bajtów), zależnie od tego, który limit zostanie osiągnięty pierwszy. Godzinny plik stereo 48 kHz jest obsługiwany, o ile mieści się w limicie rozmiaru. Długie zadania odczytują, kodują i zapisują dane porcjami; duże eksporty w przeglądarce wymagają prywatnego dla źródła magazynu plików i wystarczającej ilości wolnego miejsca. Duże importy wymagają trwałego magazynu lokalnego na zdekodowany dźwięk. Formatów PCM dotyczą osobne limity.

Wersja przeglądarkowa obsługuje MP3, MP2, FLAC, WavPack, Opus i Ogg Vorbis. Obsługa AAC/M4A zależy od kodeka przeglądarki. Strumieniowy eksport w wersji desktopowej obsługuje sześć dołączonych formatów, w tym 24-bitowy FLAC i bezstratny WavPack float32. Import na komputerze zależy od dostępności natywnych dekoderów; MP2 korzysta z mniejszego zestawu zgodności narzędzi. AAC i dostawcy zgodności w wersji desktopowej mają osobne limity.

Podczas aktywnego zadania pasek postępu jest widoczny nawet po ukryciu go przez **Widok → Pasek stanu**. Wybierz **Anuluj** obok paska, aby zatrzymać import lub eksport audio.

## Edytowalne pliki projektu

- Scape (`.sscape` z Soundscaper, `.fscape` z Framescaper; oba można otworzyć w obu produktach) to przenośny, bezstratny format projektu współdzielony przez Soundscaper i Framescaper.
- AUP4 służy do wymiany projektów audio z Audacity. Nie jest pełną kopią zapasową projektu Soundscaper zawierającego różne rodzaje mediów.

Przeczytaj [informacje o plikach projektu](/projects-and-data/project-files/), aby poznać skutki każdego z tych wyborów.

## Wyrenderowane pliki wynikowe

Eksport audio tworzy pliki przeznaczone do odsłuchu, publikacji lub dalszego przetwarzania. Eksport wideo tworzy pliki MP4 lub WebM. Wyrenderowany plik nie zachowuje edytowalnej osi czasu, routingu, efektów ani historii projektu.

Tabele wygenerowanych formatów i możliwości produktów znajdziesz w [sekcji dokumentacji](/reference/).

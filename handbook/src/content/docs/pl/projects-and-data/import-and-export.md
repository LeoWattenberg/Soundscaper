---
title: "Import i eksport"
description: "Poznaj różnice między materiałem źródłowym, plikami projektu, plikami wymiany i wyrenderowanymi plikami wynikowymi."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"pl"} -->

Soundscaper używa różnych typów plików do różnych zadań.

## Materiały źródłowe

Do importowania audio, wideo i etykiet użyj polecenia **Plik → Importuj**. Bieżąca podpowiedź edytora wymienia formaty AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF i WebM; ścieżka importu wideo obsługuje też dodatkowe kontenery. Dostępność może zależeć od aktywnego produktu i środowiska wykonawczego.

Import multimediów dodaje źródło należące do projektu. Nie zamienia oryginalnego pliku w edytowalny dokument projektu.

Eksport skompresowanego audio i import w przeglądarce obsługują pliki trwające do jednej godziny lub o rozmiarze 1 GB (1 000 000 000 bajtów), zależnie od tego, który limit zostanie osiągnięty pierwszy. Wybieranie plików na komputerze i import skompresowanego audio nie mają stałego limitu rozmiaru ani czasu trwania poniżej bezpiecznego zakresu liczb całkowitych. Długie zadania odczytują, kodują i zapisują dane porcjami; duże eksporty w przeglądarce wymagają magazynu plików prywatnego dla źródła i wystarczającej ilości wolnego miejsca. Duże importy wymagają wystarczającej ilości lokalnego magazynu na zdekodowany dźwięk. Ograniczeniem importu mogą być również struktura formatu, obsługa dekodera i dostępna przestrzeń.

Wersja przeglądarkowa obsługuje MP3, MP2, FLAC, WavPack, Opus i Ogg Vorbis. Obsługa AAC/M4A zależy od kodeka przeglądarki. Strumieniowy eksport w wersji desktopowej obsługuje sześć dołączonych formatów, a także bezstratny 24-bitowy FLAC i WavPack float32. Import na komputerze zależy od dostępności dekoderów; duże źródła MP2 korzystają z dekodera pakietowego, a mniejsze z warstwy zgodności narzędzi.

Podczas aktywnego zadania pasek postępu jest widoczny nawet po ukryciu go przez **Widok → Pasek stanu**. Wybierz **Anuluj** obok paska, aby zatrzymać import lub eksport audio.

## Edytowalne pliki projektu

- Scape (`.sscape` z Soundscaper, `.fscape` z Framescaper; oba można otworzyć w obu produktach) to przenośny, bezstratny format projektu współdzielony przez Soundscaper i Framescaper.
- AUP3 i AUP4 umożliwiają wymianę audio z Audacity. Wybierz AUP3 dla profilu projektu Audacity 3.7.9 lub AUP4 dla bieżącego profilu wymiany. Żaden z nich nie jest pełną kopią zapasową projektu Soundscaper zawierającego różne rodzaje mediów; po eksporcie sprawdź raport zgodności.
- Wersja desktopowa może otwierać sesje Adobe Audition SESX (`.sesx`), aby utworzyć lokalny projekt z plików audio, do których się odwołują. Zachowaj oryginalną sesję i multimedia; eksport do SESX nie jest dostępny.

Przeczytaj [informacje o plikach projektu](/projects-and-data/project-files/), aby poznać skutki każdego z tych wyborów.

## Wyrenderowane pliki wynikowe

Eksport audio tworzy pliki przeznaczone do odsłuchu, publikacji lub dalszego przetwarzania. Eksport wideo tworzy pliki MP4 lub WebM. Wyrenderowany plik nie zachowuje edytowalnej osi czasu, routingu, efektów ani historii projektu.

Tabele wygenerowanych formatów i możliwości produktów znajdziesz w [sekcji dokumentacji](/reference/).

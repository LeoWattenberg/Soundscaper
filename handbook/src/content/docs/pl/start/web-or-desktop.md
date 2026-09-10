---
title: "Aplikacja internetowa czy komputerowa"
description: "Zrozum, jak przeglądarki internetowe i wersje pakowane aplikacji komputerowych przechowują projekty i uzyskują dostęp do plików."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"pl"} -->

Oba wydania przetwarzają projekty lokalnie. Ich magazynowanie i dostęp do plików różnią się.

## Edytor internetowy

Wersja przeglądarkowa przechowuje projekty, nagrania i zaimportowane media w
przechowywaniu prywatnym źródła w przeglądarce. Nie przesyła projektu na konto Soundscaper
i nie wymaga konta.

Użyj edytora internetowego, gdy chcesz uzyskać natychmiastowy dostęp bez instalowania aplikacji.
Pamiętaj, że pamięć przeglądarki podlega limitom i zasadom usuwania przeglądarki. Wyczyszczenie danych witryny usuwa lokalną bibliotekę projektów.

## Podgląd na komputerze stacjonarnym

Opakowane podglądy na komputerze stacjonarnym przechowują automatycznie zapisywana lokalną bibliotekę wewnątrz aplikacji na komputerze stacjonarnym. Zawierają one środowisko uruchomieniowe edytora i wydane tłumaczenia dla
edytowania w trybie offline.

Pakiety na komputer stacjonarny są niepodpisane. macOS stosuje tylko bezpłatny kod ad-hoc
pieczęć jego ładowacza do uruchamiania Electron i binarnych natywnych; ta pieczęć nie stanowi
żadnego oświadczenia o wydawcy ani zaufaniu. Windows SmartScreen lub macOS Gatekeeper może
wyświetlić ostrzeżenie o nieznanym twórcy dla podglądu i pakietów stabilnych.

Otwarcie pliku `.aup4` importuje niezależny projekt do biblioteki komputerowej.
Późniejsze edycje nie przepisują pliku, który został otwarty. **Zapisz** aktualizuje
kopię biblioteki; **Zapisz jako** tworzy nowy plik wymiany Audacity.

## Telefony i tablety

Edytor internetowy zachowuje swój układ pulpitu na każdym ekranie, ale poniżej 900 pikseli szerokości
(telefon lub tablet w pozycji pionowej) składa on szuflady w celu zachowania
linii czasu:

- Przycisk **Menu** w lewym górnym rogu otwiera szufladę z pełnym menu aplikacji, kartami projektu,
paskiem akcji i pasem narzędzi. Odtwarzanie, zatrzymanie,
agrywanie i wyszukiwanie pozostają w pasku. Wybór polecenia zamyka szufladę.
- Nagłówki ścieżek przesuwają się nad ścieżki z uchwytu **Nagłówki ścieżek** w lewym górnym rogu
  linii czasu lub z **Widok › Nagłówki ścieżek**. Kliknięcie ścieżek lub naciśnięcie klawisza Escape
  ponownie je ukrywa.
- Wprowadzenie powyżej edytora jest zwinięte domyślnie na wąskich ekranach; **Pokaż wprowadzenie**
  je przywracają.

**Edytuj › Preferencje › Wygląd › Układ** przełącza między Automatycznym,
Kompaktowym i Pulpitem, więc małe okno na pulpicie może zachować układ pulpitu, a szeroki tablet może
wybrać szuflady.

## Projekty nie przenoszą się automatycznie

Biblioteki przeglądarki i komputera stacjonarnego są oddzielne. Przenieś projekt celowo:

- Użyj pliku projektu Soundscaper - `.sscape`, pliku projektu Framescaper - `.fscape`
- Użyj AUP4, gdy potrzebujesz wymiany audio z Audacity.
- Eksportuj renderowane audio lub wideo jako trwałą kopię odtwarzania.

Zobacz [Pliki projektów](/projects-and-data/project-files/) przed usunięciem danych witryny przeglądarki
lub danych aplikacji na komputerze stacjonarnym.

---
title: "Pliki projektu"
description: "Wybierz między lokalną biblioteką, plikami projektu Scape, AUP4 i renderowanymi kopiami zapasowymi."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"pl"} -->

## Lokalna biblioteka projektu

Edytor zapisuje pracujące projekty do swojej lokalnej biblioteki. W przeglądarce jest to magazyn prywatny dla pochodzenia; w edycji pulpitu jest to dane aplikacji. Jest to wygodna kopia robocza, nie jedyna, którą powinieneś zachować.

## Pliki projektu Scape

W wersji desktopowej zaimportowane audio i wideo domyślnie pozostają odwołaniami do oryginalnych plików. Przy ponownym otwieraniu projektu pozostaw te pliki w ich pierwotnych lokalizacjach. Lokalna biblioteka przechowuje również pamięć podręczną edycji. Nagrania oraz utworzone lub przetworzone multimedia są dołączane, ponieważ nie mają niezmienionego zewnętrznego oryginału.

Wybierz **Plik → Zarządzanie projektem → Konsoliduj multimedia**, aby spakować odwołane multimedia do pliku projektu. Konsolidacja natychmiast zapisuje projekt; wybierz miejsce docelowe w oknie zapisu. Po zapisaniu skonsolidowaną kopię można przenieść lub udostępnić bez oryginalnych plików multimedialnych. Jeśli jakichś multimediów nie można skonsolidować albo zapis się nie powiedzie, edytor zgłosi problem.

Eksporty przeglądarkowe automatycznie dołączają multimedia. Przed otwarciem w przeglądarce projektu desktopowego z zewnętrznymi odwołaniami skonsoliduj go na komputerze.


Użyj **Plik → Eksportuj plik projektu**, aby zapisać edytowany projekt. Każdy produkt zapisuje własny sufiks: Soundscaper zapisuje `.sscape`, a Framescaper zapisuje `.fscape`, a nazwa pozycji menu zależy od tego, który sufiks jest stosowany. Format za obu jest taki sam, więc jest to odpowiedni wybór, gdy musisz zachować stan edycji multimediów.

Każdy produkt otwiera oba sufiksy. `.sscape`, `.fscape`, zarezerwowany `.liscape` i starsze pliki `.scape`, które zostały wyeksportowane przed wprowadzeniem własnych sufiksów przez produkty, otwierają się wszędzie, a zapisanie jednego z innego produktu po prostu zmienia jego nazwę - na przykład plik `Mix.sscape` zapisany w Framescaper staje się `Mix.fscape`. Nic w projekcie nie zmienia się wraz ze zmianą nazwy.

Importowanie lub otwieranie kopii Scape może napotkać istniejący projekt o tym samym ID. Użyj oferowanego przepływu kopii, gdy obie wersje muszą pozostać w lokalnej bibliotece.

## Audacity AUP3 i AUP4

Eksport projektów Audacity jest dostępny przez **Plik → Eksportuj inne**. Wybierz **Eksportuj AUP3**, aby użyć profilu projektu Audacity 3.7.9, albo **Eksportuj AUP4**, aby użyć bieżącego profilu wymiany Audacity. Każdy eksport tworzy raport zgodności opisujący konwersje, niedostępne efekty i pominięty stan charakterystyczny dla Soundscaper.

Oba formaty zawierają wyłącznie audio. Wideo jest pomijane; nie są też przenoszone preferencje przeglądarki, historia cofania, routing miksera ani biblioteka projektów przeglądarki. Nie używaj żadnego z nich jako jedynej kopii zapasowej projektu Soundscaper lub Framescaper.

## Adobe Audition SESX

W wersji desktopowej użyj **Plik → Otwórz**, aby zaimportować sesję Adobe Audition `.sesx`. Zachowaj odwołane pliki audio w ich względnej strukturze folderów pod folderem sesji albo po wyświetleniu prośby wybierz folder multimediów. Import tworzy nowy lokalny projekt z obsługiwanymi ścieżkami audio, klipami, rozmieszczeniem, przycięciami, prostymi przejściami i statycznymi ustawieniami miksera.

Import SESX działa tylko w jedną stronę. Efekty Audition, automatyzacja, routing, wideo, znaczniki, pętle, rozciąganie, powiązane przenikania i dokładne krzywe przejść nie są przenoszone. Po imporcie otwórz **Plik → Raport dostawy**, aby sprawdzić brakujące multimedia i inną pominiętą zawartość. Zachowaj oryginalny plik SESX i multimedia do dalszej pracy w Audition.

## Zapisana kopia zapasowa

W przypadku ważnych prac zachowaj oba:

1. Kopię projektu Scape (`.sscape` lub `.fscape`) na przyszłą edycję.
2. Zapisany plik audio lub wideo, który można odtwarzać bez edytora.

Przechowuj te pliki poza katalogiem danych przeglądarki lub aplikacji.

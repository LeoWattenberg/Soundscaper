---
title: "Rozwiązywanie problemów"
description: "Rozwiąż częste problemy z nagrywaniem, pamięcią, importem i eksportem."
sidebar:
  order: 1
---

<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"pl"} -->

## Brak wejścia nagrywania

Sprawdź uprawnienia mikrofonu w systemie operacyjnym i przeglądarce, a następnie ponownie otwórz selektor urządzeń. Przy nagrywaniu wielościeżkowym upewnij się, że każda uzbrojona ścieżka ma przypisane dostępne wejście.

## Polecenie jest nieaktywne

Wiele poleceń zależy od bieżącego stanu. Zaznacz wymagany projekt, ścieżkę, klip lub zakres czasu i spróbuj ponownie. Dana funkcja może też być celowo ograniczona do Soundscaper albo Framescaper.

## Import wymaga zbyt dużo pamięci

Dekodowanie skompresowanych plików i niektóre duże operacje mogą wymagać sporo pamięci tymczasowej, mimo że dźwięk projektu jest przechowywany w porcjach. Zamknij niepowiązane karty lub aplikacje, spróbuj ponownie z mniejszym plikiem źródłowym albo w razie potrzeby użyj wersji desktopowej.

## Projekt zniknął z przeglądarki

Sprawdź, czy otwarto ten sam profil przeglądarki, źródło i witrynę produktu. Soundscaper i Framescaper współdzielą bibliotekę pod tym samym adresem `soundscaper.org`, ale inna domena, profil przeglądarki lub wyczyszczony magazyn witryny oznacza inną bibliotekę.

Jeśli dane witryny zostały wyczyszczone i nie masz eksportu projektu Scape, edytor nie dysponuje kopią w chmurze, którą mógłby przywrócić.

## W pliku AUP4 pominięto część projektu

Przeczytaj raport zgodności. AUP4 przenosi zgodny stan edycji audio, ale pomija wideo, a efekty i ustawienia miksowania dostępne tylko w Soundscaper może przekonwertować lub pominąć. Aby przenieść cały projekt, użyj pliku projektu Scape — `.sscape` lub `.fscape`; oba można otworzyć w dowolnym z produktów.

## Eksport nie powiódł się lub plik się nie odtwarza

Spróbuj ponownie po sprawdzeniu, czy zaznaczony zakres zawiera materiał, który można odtworzyć. W przypadku skompresowanego audio lub wideo sprawdź, czy zasoby środowiska wykonawczego mogą się załadować. Po pomyślnym eksporcie przetestuj sam plik w innym odtwarzaczu.

Jeśli problem nie ustąpi, użyj polecenia **Pomoc → Wsparcie**, aby skontaktować się z opiekunem projektu. Podaj produkt, platformę, wersję przeglądarkową lub desktopową, wykonane kroki i dokładny komunikat błędu.

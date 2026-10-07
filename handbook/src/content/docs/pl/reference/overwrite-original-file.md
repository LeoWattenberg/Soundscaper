---
title: "Nadpisywanie zaimportowanego pliku w wersji komputerowej"
description: "Zapisz edytowany projekt w oryginalnym pliku multimedialnym w Soundscaperze lub Framescaperze."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"pl"} -->

W wersjach Electron Soundscapera i Framescapera polecenie **Plik → Nadpisz nazwę pliku** eksportuje cały edytowany projekt do pierwotnie zaimportowanego pliku multimedialnego. Używa ustawień eksportu obsługiwanych przez oryginalny plik i zapisuje go od razu, bez otwierania okna eksportu ani selektora plików. Dźwięk zachowuje źródłowy format, częstotliwość próbkowania i liczbę kanałów. Obsługiwane filmy MP4 i WebM zachowują źródłowy kontener, wymiary i liczbę klatek na sekundę.

Zaimportuj jeden plik multimedialny przez **Plik → Importuj**, wprowadź zmiany i wybierz **Plik → Nadpisz nazwę pliku**. Możesz powtórzyć tę czynność po kolejnych zmianach. Zaznaczenie czasu nie ogranicza nadpisywania: zawsze renderowany jest cały projekt. Projekt zachowuje zaimportowane media i historię edycji.

Polecenie jest niedostępne, gdy projekt nie ma obsługiwanego pliku źródłowego, zaimportowano wiele plików źródłowych albo trwa importowanie, nagrywanie lub przetwarzanie. Wersje przeglądarkowe korzystają ze zwykłego okna eksportu.

Wybierz **Plik → Eksportuj audio** w Soundscaperze lub **Plik → Eksportuj wideo** w Framescaperze, jeśli chcesz wskazać inne miejsce docelowe albo zmienić ustawienia dostarczanego pliku. Nadpisanie zastępuje zawartość oryginalnego pliku; zachowaj osobną kopię, jeśli potrzebujesz nieedytowanego nagrania.

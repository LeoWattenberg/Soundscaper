---
title: "Twój pierwszy projekt animacji"
description: "Utwórz kompozycję, animuj warstwę i wyeksportuj zapisany projekt."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"pl"} -->

## Utwórz i dodaj warstwę {#create-and-add-a-layer}

1. Wybierz **Plik → Nowa kompozycja** i podaj tytuł, wymiary, liczbę klatek
   na sekundę oraz czas trwania w klatkach.
2. Wybierz **Warstwa → Nowy tekst** lub **Warstwa → Nowa jednolita warstwa**.
   Wybierz kompozycję docelową, jeśli projekt zawiera kilka kompozycji.
3. Otwórz **Warstwa → Tekst i wygląd**, aby edytować istniejącą warstwę tekstu
   lub wypełnienia i obrysy kształtu. Importowane tutaj czcionki pozostają w projekcie.

Użyj **Plik → Importuj media** dla źródeł obrazu, wideo lub dźwięku. Import
przekraczający bieżące limity dekodera lub pamięci jest odrzucany z wyjaśnieniem;
oryginalny plik źródłowy pozostaje nietknięty.

## Animacja i podgląd {#animate-and-preview}

Otwórz **Warstwa → Właściwości i klatki kluczowe**, wybierz właściwość warstwy
i dodaj klucze w dokładnych pozycjach klatek. Elementy sterowania krzywą zmieniają
interpolację; edycja przestrzenna zmienia ścieżki pozycji. **Widok → Oś czasu**
otwiera sterowanie czasem warstw, kolejnością, grupowaniem i obszarem roboczym.

Otwórz **Widok → Płótno kompozycji**, aby wybrać i przesunąć statyczną warstwę 2D.
Kwadrat ją skaluje, a koło obraca wokół ustalonej kotwicy. Każde ukończone
przeciągnięcie jest jednym krokiem cofania; Escape anuluje przeciąganie.
Transformacje animowane i sterowane wyrażeniami pozostają w panelu Właściwości
i klatki kluczowe.

Otwórz **Widok → Podgląd kompozycji**, aby przewijać lub odtwarzać kompozycję.
Podgląd używa zachowanych mediów źródłowych. Nieobsługiwane lub nieprawidłowe
ustawienia sceny powodują błąd zamiast obrazu zastępczego. Zamknij podgląd,
aby zwolnić jego aktywne zasoby renderowania.

## Zapisz przenośną kopię {#save-a-portable-copy}

Wybierz **Plik → Zapisz**, aby opublikować bieżącą rewizję, a następnie
**Plik → Zapisz kopię**, aby pobrać archiwum `.mscape`. Archiwum zawiera projekt
i oryginalne media potrzebne do ponownego otwarcia. Otwórz je przez
**Plik → Otwórz** na innym urządzeniu lub w nowej bibliotece przeglądarki.

## Renderowanie {#render}

Wybierz **Plik → Renderuj**. Wybierz kompozycję, format wyjściowy i zakres klatek.
Klatka końcowa nie jest wliczana: klatki od 0 do 29 używają zakresu `0` do `30`.
Ułamkowy obszar roboczy wybiera zawarte w nim całkowite czasy próbkowania;
obszar bez próbek wyjściowych trzeba zmienić przed renderowaniem.

Użyj **Przezroczysta sekwencja PNG (.tar)** dla alfy. Rozpakuj archiwum TAR,
aby uzyskać zwykłe obrazy PNG i metadane czasu. MP4 i WebM używają koloru tła
wybranego w oknie. Renderowanie przypina wysłaną rewizję, więc późniejsze zmiany
nie zmieniają już tworzonego wyniku. Zamknięcie okna renderowania nie przerywa
zadania. **Plik → Kolejka renderowania** pokazuje postęp, anulowanie, ponowienie
wysłanej rewizji i ukończone pobrania. Zamknięcie edytora anuluje niedokończone
zadania.

Wróć do [podręcznika Motionscaper](/motionscaper/).

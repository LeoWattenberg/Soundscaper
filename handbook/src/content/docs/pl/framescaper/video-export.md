---
title: "Eksportowanie wideo"
description: "Sprawdź zmontowaną sekwencję i przygotuj plik MP4 lub WebM."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"pl"} -->

## Przed eksportem

- Odtwórz całą sekwencję, zwracając uwagę na każde miejsce cięcia.
- Sprawdź, czy widoczne i odsłuchiwane osobno ścieżki tworzą zamierzony obraz.
- Upewnij się, że powiązany dźwięk pozostaje zsynchronizowany.
- Sprawdź zakres eksportu oraz to, czy plik ma zawierać napisy lub dźwięk.

## Utwórz plik

Otwórz okno eksportu i wybierz format wideo. Framescaper obsługuje eksport do
MP4 i WebM za pomocą skonfigurowanego środowiska uruchomieniowego wideo. Wybierz
wymiary, liczbę klatek na sekundę i pozostałe opcje odpowiednie dla miejsca
docelowego.

Kodowanie wideo wymaga więcej zasobów niż zwykłe odtwarzanie na osi czasu.
Pozostaw edytor otwarty, aż eksport zostanie ukończony.

## Eksportowanie klipów audio osobno {#export-audio-clips}

Wybierz **Plik → Eksportuj wideo**, wskaż format audio, np. **WAV**, i ustaw **Wyjście** na **Osobne klipy (podziel według klipów)**. Eksport pobiera archiwum zawierające plik dla każdego klipu audio. Klipy wideo są pomijane, a każdy plik audio zawiera tylko dany klip, łącznie z przycięciami i edycjami klipu.

Pliki zaczynają się od słyszalnego początku klipu, bez dopełnienia do jego pozycji w projekcie ani wybrzmienia efektu. Numerowane nazwy odróżniają klipy o tych samych nazwach.

Efekty ścieżki są uwzględniane; efekty główne, wyciszenie i solo nie wpływają na ten eksport. Wspólny przepływ pracy audio opisano w sekcji [Eksport klipów do osobnych plików](/soundscaper/edit-mix-and-export/#export-clips).

## Sprawdź gotowy plik

Otwórz wyeksportowany plik w osobnym odtwarzaczu. Sprawdź czas trwania, pierwszą
i ostatnią klatkę, orientację obrazu, synchronizację dźwięku oraz obecność
oczekiwanych napisów.

Wyrenderowane wideo nie zastępuje edytowalnego projektu. Jeśli chcesz zachować
oś czasu i pliki multimedialne projektu, wyeksportuj również jego kopię
`.fscape`.

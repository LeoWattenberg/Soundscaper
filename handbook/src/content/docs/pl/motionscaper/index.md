---
title: "Motionscaper"
description: "Twórz animowane kompozycje i przechowuj edytowalne projekty animacji lokalnie."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"pl"} -->

Motionscaper to edytor grafiki ruchomej z rodziny Scaper. Projekt zawiera
kompozycje, warstwy, animację i zachowane media. Rozszerzenie jego pliku
projektu to `.mscape`.

To wydanie rozwojowe. Zacznij od kopii ważnych materiałów źródłowych
i przechowuj wyeksportowane archiwa projektów obok biblioteki roboczej.

## Rozpocznij kompozycję {#start-a-composition}

Wybierz **Plik → Nowa kompozycja**. Menu **Warstwa** otwiera narzędzia tekstu,
kształtów, animacji, składania, śledzenia, wyrażeń i sceny 3D. **Widok →
Podgląd kompozycji** otwiera odtwarzanie; nowe powierzchnie edycji pojawiają się,
gdy wybierzesz je z menu.

Wybierz **Widok → Płótno kompozycji**, aby wybierać, przesuwać, skalować lub
obracać warstwy ze statycznymi transformacjami 2D. Animowane transformacje
pozostają edytowalne w narzędziach właściwości i osi czasu.

W **Widok → Oś czasu** wybierz istniejące warstwy, aby je przemianować, włączyć,
wyłączyć lub usunąć. Zmiana nazwy zachowuje odwołania do właściwości i animację.
Usunięcie warstwy zachowuje jej oryginalne media; uwzględnij warstwy zależne lub
najpierw odłącz ich powiązania. **Cofnij** przywraca usunięte warstwy. Wybrana
warstwa materiału oferuje też pole wyboru dźwięku, jeśli zachowane źródło go
zawiera.

Przejdź do [pierwszego projektu animacji](/motionscaper/first-project/), aby
utworzyć, animować, zapisać i wyrenderować kompozycję.

## Zapis i pliki wyjściowe {#save-and-deliver}

**Plik → Zapisz** publikuje zapisaną rewizję. **Zapisz kopię** eksportuje bieżący
stan jako archiwum `.mscape` bez publikowania nowej zapisanej rewizji.
Zaimportowane oryginalne media i czcionki trafiają do archiwum. **Biblioteka
projektów** otwiera projekty zachowane na tym urządzeniu.

**Plik → Renderuj** oferuje przezroczyste klatki PNG w archiwum TAR,
nieprzezroczyste wideo MP4 lub WebM oraz ProRes 4444, gdy dostępny jest koder
aplikacji desktopowej. Sekwencje PNG nie zawierają dźwięku. Wideo w przeglądarce
zachowuje utworzony dźwięk, jeśli koder obsługuje żądany format. Natywny ProRes
podaje efektywną precyzję koloru i alfy w oknie renderowania. **Plik → Kolejka
renderowania** zachowuje zadania po zamknięciu okien i przełączeniu projektu.
Przechowuje do ośmiu zadań i 128 MiB pobrań przeglądarki; pojedyncze pobranie
przyjmuje do 64 MiB. Dla większego wyniku wybierz strumieniowy zapis do pliku,
a ukończone zadania usuwaj, aby zwalniać zachowane pobrania. Jeśli czyszczenie
natywnego wyjścia nie powiedzie się, użyj **Ponów czyszczenie pliku wyjściowego**
w tej kolejce. Zadanie zachowuje miejsce docelowe do skutecznego czyszczenia;
potem można je usunąć lub ponowić wysłaną rewizję z nowym miejscem docelowym.

## Połącz z Framescaper {#link-to-framescaper}

Połączone kompozycje wymagają osobnej linii rozwojowej Framescaper 1.1.
W jej oknie **Plik → Połączone kompozycje** utwórz adres parowania. Wklej go do
okna **Plik → Wyślij kompozycję do Framescaper** w Motionscaper, połącz się
i pozostaw edytory oraz okna łącznika otwarte. Późniejsze operacje **Zapisz**
automatycznie wysyłają nowe rewizje; **Zapisz kopię** tego nie robi.

Framescaper zachowuje każdą przyjętą rewizję i pełny zestaw jej mediów do użytku
bez sieci. Cofnij przypina wcześniejszą rewizję do chwili wznowienia aktualizacji.
Zmiany rozmiaru wyjściowego, czasu lub siatki dźwięku wymagają jawnego przeglądu
dopasowania. Odbiornik desktopowy może zamiast tego obserwować wybrany zapisany
plik `.mscape`.

## Sprawdź aktualizacje aplikacji desktopowej {#check-desktop-updates}

W aplikacji desktopowej wybierz **Pomoc → Sprawdź aktualizacje**. Ta ręczna
kontrola szuka zgodnych wydań Motionscaper w repozytorium GitHub projektu.
Wersje przedpremierowe mogą otrzymywać nowsze wydania przedpremierowe; wersje
stabilne otrzymują wydania stabilne. Wybierz **Zobacz wydanie**, aby otworzyć
zweryfikowaną stronę wydania. Kontrola nie pobiera ani nie instaluje aktualizacji.
Wersje przeglądarkowe pomijają to polecenie menu.

## Wymiana z After Effects {#after-effects-exchange}

**Plik → Łącznik After Effects** udostępnia czytelne skrypty i sprawdza obsługiwane
dane wymiany przed importem. Pliki `.aep` i `.aepx` są otwierane przez
zainstalowany After Effects i skrypty łącznika. Łącznik rozwojowy nie został
jeszcze zweryfikowany w zainstalowanym After Effects. Sprawdź jego raport;
nieobsługiwany zamiar sceny i oryginalne media pozostają zachowane w projekcie.

Okno oferuje osobne opcje importu i eksportu obsługiwanych skalarnych wyrażeń
krycia z arytmetyką, czasem kompozycji, wartością sprzed wyrażenia i standardowymi
funkcjami Math. Obie opcje są początkowo wyłączone. Po zmianie opcji sprawdź nowy
raport; inne formy wyrażeń wymagają jawnego próbkowania lub renderowania.
Oryginalny kod wyrażenia pozostaje w zachowanych danych wymiany lub archiwum
`original.mscape`.

Renderer obsługuje kolor SDR i alfę z warstwami 2.5D, kamerami, światłami,
próbkowaniem migawki i głębią ostrości. Nie deklaruje HDR, pełnych siatek 3D,
zaawansowanego maskowania AI ani zgodności z dowolnymi wtyczkami After Effects.

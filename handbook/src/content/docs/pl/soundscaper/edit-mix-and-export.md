---
title: "Edytuj, miksuj i eksportuj"
description: "Rozmieść klipy, zrównoważ ścieżki, zastosuj efekty i przygotuj plik wynikowy."
sidebar:
  order: 4
---

<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"pl"} -->

## Rozmieszczaj klipy

Przed wybraniem polecenia edycji zaznacz klipy lub zakres czasu. Podzielenie tworzy granicę edycji w pozycji kursora odtwarzania. Warianty zachowujące przerwy i warianty ripple określają, czy późniejszy materiał pozostaje na miejscu, czy przesuwa się, by zamknąć usunięty fragment.

Organizuj większe projekty za pomocą folderów ścieżek, grup klipów i Kosza projektu.

### Dostosuj wyciszenia klipu {#clip-fades}

Zaznacz klip audio, aby wyświetlić małe trójkątne uchwyty u góry przebiegu fali, tuż pod nagłówkiem klipu.
Przeciągnij lewy trójkąt do środka, aby uzyskać narastanie dźwięku, albo prawy, aby go wygasić. Podczas przeciągania przebieg fali się zmienia, a obszar nad krzywą wyciszenia ciemnieje. Uchwyty podążają za granicami wyciszenia; przeciągnięcie uchwytu z powrotem do narożnika usuwa wyciszenie. Zmienia się tylko przeciągany klip, nawet jeśli zaznaczono kilka klipów.

Po odznaczeniu klipu uchwyty znikają, ale wyciszony przebieg i cieniowanie pozostają. Te wyciszenia nie zmieniają oryginalnego dźwięku i można je nadal dostosować po zapisaniu oraz ponownym otwarciu projektu. Puść przycisk myszy, aby zatwierdzić zmianę, lub podczas przeciągania naciśnij **Escape**, aby ją anulować. Polecenie **Cofnij** odwraca całe przeciągnięcie. Odtwarzanie i eksport korzystają z zatwierdzonych ustawień wyciszenia.

Gdy zaznaczony klip jest aktywny, naciśnij **Tab**, aby przejść do jego uchwytów wyciszenia. Strzałki zmieniają czas o 10 milisekund, a z **Shift** — o 100 milisekund. **Home** usuwa wyciszenie, a **End** rozciąga je na cały klip. Aby wpisać wartość liczbową, wybierz **Edycja → Klipy audio → Właściwości klipu** i użyj pola **Wyciszanie**.

## Zbuduj miks

Zrównoważ projekt za pomocą wzmocnienia ścieżek, panoramy oraz elementów sterujących wyciszeniem i solo. Panel Miksera pokazuje ten sam stan projektu w układzie ułatwiającym miksowanie. Efekty czasu rzeczywistego można nadal dostosowywać; operacje destrukcyjne lub renderowane zmieniają projekt, a ich skutki można cofnąć, dopóki historia jest dostępna.

Sprawdź wynik za pomocą miernika odtwarzania i analizy głośności. Nie traktuj docelowej wartości miernika jako zamiennika odsłuchu całego eksportu.

### Ogranicz sybilanty {#reduce-sibilance}

Wybierz **Efekt → Usuwanie szumu i naprawa → De-esser**. Ustaw **Częstotliwość** w pobliżu ostrego zakresu głosu, a następnie obniżaj **Próg**, aż sybilanty złagodnieją. **Maksymalne tłumienie** ogranicza redukcję; zacznij od około 6–9 dB. Krótszy czas **Ataku** szybciej reaguje na początek spółgłoski, a **Zwolnienie** określa, jak szybko wracają wysokie częstotliwości. Redukowany jest tylko górny zakres pasma.

### Kompresuj osobne pasma częstotliwości {#multiband-compression}

Wybierz **Efekt → Głośność i kompresja → Kompresor wielopasmowy**. Dwie częstotliwości podziału rozdzielają sygnał na niskie, średnie i wysokie pasmo. Każde pasmo ma własny próg, współczynnik kompresji i wzmocnienie wyjściowe. Współczynnik 1 nie zmienia dynamiki danego pasma. Atak i zwolnienie dotyczą wszystkich trzech pasm. Filtry podziału łagodnie nakładają się, z nachyleniem 6 dB/oktawę; gdy wszystkie współczynniki wynoszą 1, a wzmocnienie każdego pasma 0 dB, sygnał przechodzi bez zmian.

Oba efekty łączą kanały, aby zachować równowagę stereo, i są też dostępne w szafach efektów ścieżki i mastera. Ustawienia szafy są zapisywane w projekcie i można je zmieniać podczas odtwarzania. **Zastosuj do zaznaczenia** renderuje efekt w zaznaczonym dźwięku i obsługuje cofanie. Te dwa efekty nie udostępniają automatyzacji na osi czasu.

### Korzystaj z efektów LADSPA i analizatorów Vamp {#native-audio-plugins}

Aplikacja desktopowa może skanować wtyczki innych firm dopiero po zezwoleniu na dany format i jeden z jego folderów w **Efekt → Menedżer wtyczek**. Skanowanie nigdy nie odbywa się automatycznie. Zanim użyjesz wykrytej instalacji, zezwól na nią. Instaluj tylko zaufane wtyczki: natywne wtyczki uruchamiają kod wykonywalny, choć Soundscaper obsługuje je w nadzorowanych procesach pomocniczych.

Efekty LADSPA są dostępne w systemie Linux. Po włączeniu w Menedżerze otwórz je przez **Efekt → Wtyczki audio**. Soundscaper tworzy elementy sterujące na podstawie portów LADSPA, ponieważ ten format nie ma interfejsu dostawcy. Wartości elementów sterujących oraz stan włączenia lub pominięcia efektu są zapisywane w projekcie.

Wtyczki Vamp analizują dźwięk, ale go nie zmieniają. Po włączeniu wtyczki Vamp zaznacz ścieżkę audio, aby ją przeanalizować, albo nie zaznaczaj żadnej ścieżki audio, jeśli chcesz analizować miks mastera. Zaznaczenie czasu ogranicza analizę; w przeciwnym razie Soundscaper używa całego projektu. Wybierz **Analiza → Wtyczki Vamp**, wskaż wynik analizatora i jego ustawienia, a następnie uruchom analizę. Soundscaper dodaje zwrócone znaczniki czasu jako nową ścieżkę etykiet dopiero po pomyślnym zakończeniu całej analizy, więc anulowanie lub zmiana projektu nie pozostawi niekompletnych etykiet.

## Eksportuj

Wybierz **Plik → Eksportuj audio**, aby przygotować gotowy miks, lub **Eksportuj zaznaczone audio**, jeśli chcesz wyrenderować tylko zaznaczenie. Soundscaper może również eksportować stemsy i etykiety.

Formaty skompresowane korzystają ze środowiska FFmpeg. Dokładne formaty i warunki ich dostępności opisano w [wygenerowanej dokumentacji formatów](/reference/).

Przed przekazaniem pliku lub usunięciem materiału źródłowego odtwórz wyeksportowany plik w innej aplikacji.

Jeśli pracujesz z obrazem — montujesz sekwencję, stosujesz efekty wideo i przygotowujesz plik MP4 lub WebM — przekaż projekt do [Framescaper](/framescaper/) i zobacz [eksport wideo](/framescaper/video-export/).

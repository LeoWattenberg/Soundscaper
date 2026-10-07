---
title: "Edytuj, miksuj i eksportuj"
description: "Rozmieść klipy, zrównoważ ścieżki, zastosuj efekty i przygotuj plik wynikowy."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"pl"} -->

## Rozmieszczaj klipy

Przed wybraniem polecenia edycji zaznacz klipy lub zakres czasu. Podzielenie tworzy granicę edycji w pozycji kursora odtwarzania. Warianty zachowujące przerwy i warianty ripple określają, czy późniejszy materiał pozostaje na miejscu, czy przesuwa się, by zamknąć usunięty fragment.

Organizuj większe projekty za pomocą folderów ścieżek, grup klipów i Kosza projektu.

### Dostosuj wyciszenia klipu {#clip-fades}

Zaznacz klip audio, aby wyświetlić małe trójkątne uchwyty u góry przebiegu fali, tuż pod nagłówkiem klipu.
Przeciągnij lewy trójkąt do środka, aby uzyskać narastanie dźwięku, albo prawy, aby go wygasić. Podczas przeciągania przebieg fali się zmienia, a obszar nad krzywą wyciszenia ciemnieje. Uchwyty podążają za granicami wyciszenia; przeciągnięcie uchwytu z powrotem do narożnika usuwa wyciszenie. Zmienia się tylko przeciągany klip, nawet jeśli zaznaczono kilka klipów.

Po odznaczeniu klipu uchwyty znikają, ale wyciszony przebieg i cieniowanie pozostają. Te wyciszenia nie zmieniają oryginalnego dźwięku i można je nadal dostosować po zapisaniu oraz ponownym otwarciu projektu. Puść przycisk myszy, aby zatwierdzić zmianę, lub podczas przeciągania naciśnij **Escape**, aby ją anulować. Polecenie **Cofnij** odwraca całe przeciągnięcie. Odtwarzanie i eksport korzystają z zatwierdzonych ustawień wyciszenia.

Gdy zaznaczony klip jest aktywny, naciśnij **Tab**, aby przejść do jego uchwytów wyciszenia. Strzałki zmieniają czas o 10 milisekund, a z **Shift** — o 100 milisekund. **Home** usuwa wyciszenie, a **End** rozciąga je na cały klip. Aby wpisać wartość liczbową, wybierz **Edycja → Klipy audio → Właściwości klipu** i użyj pola **Wyciszanie**.

### Edytuj źródło klipu {#clip-source-properties}

Wybierz **Edycja → Klipy audio → Właściwości klipu**, aby otworzyć edytor źródła. Pełne nagranie pojawi się za klipem. Przeciągaj krawędzie klipu, aby zmienić początek i długość źródła bez zmiany jego początku na osi czasu projektu. Rozwijane **Normalizacja** zawiera wzmocnienie klipu oraz działania dotyczące poziomu szczytowego i głośności.

Otwórz **Wysokość dźwięku i tempo** i zaznacz **Połącz wysokość dźwięku i tempo**, aby zmieniać jednocześnie szybkość i wysokość dźwięku. Stosunek szybkości `1` i zmiana wysokości `0%` pozostawiają dźwięk bez zmian. Stosunek `2` odtwarza dwukrotnie szybciej i o oktawę wyżej; `0.5` odtwarza o połowę wolniej i o oktawę niżej. Edycja jednego połączonego parametru aktualizuje drugi. Wyłączenie połączenia przywraca niezależne ustawianie wysokości dźwięku, zachowując bieżący stosunek szybkości.

Kliknij przebieg falowy z wciśniętym **Ctrl**, aby dodać znacznik rozciągania powiązany z tą próbką źródłową. Przeciągnięcie zmienia czas po obu stronach; nakładka pokazuje obie szybkości odtwarzania. Sterowanie klipem nadal dotyczy poszczególnych klipów. Zaznaczenie źródłowego dźwięku i zastosowanie efektu aktualizuje każdy klip korzystający z tego źródła.

### Edytuj klipy w arkuszu kalkulacyjnym {#clip-spreadsheet}

Wybierz **Widok → Panele → Arkusz klipów**, aby zobaczyć wszystkie klipy w projekcie. Panel otwiera się pod osią czasu. Jego menu pozwala przenieść go do innego dokowania, odłączyć jako pływający albo zamknąć. Rozmiar i położenie są zapisywane w obszarze roboczym. Każdy wiersz pokazuje ścieżkę, położenie na osi czasu, plik źródłowy, przesunięcie źródła, czas trwania, wysokość dźwięku, szybkość, wzmocnienie, zanikanie i opcje odtwarzania. Czasy są w sekundach, wysokość w półtonach, a szybkość to stosunek: `1` oznacza normalną, a `2` dwukrotną szybkość.

Kliknij dwukrotnie komórkę albo zaznacz ją i naciśnij **Enter**, aby edytować wartość. Naciśnij **Enter**, aby zastosować zmianę, lub **Escape**, aby ją anulować. Komórki ścieżki i źródła pokazują rzeczywiste identyfikatory. Zmień identyfikator ścieżki, aby przenieść klip na istniejącą ścieżkę audio. Zmień identyfikator źródła lub wpisz lokalną ścieżkę pliku, aby zastąpić dźwięk, zachowując pozycję na osi czasu, czas trwania, szybkość i przesunięcie źródła w sekundach. Nowy plik musi zawierać wskazany zakres źródła. **Odwrócony** i **Zmieniona polaryzacja** to pola wyboru; zaznacz komórkę i naciśnij **Spacja**, aby przełączyć. Klipy na zablokowanych ścieżkach oraz klipy wideo są tylko do odczytu.

Zmiana czasu trwania skraca lub wydłuża zakres źródła od bieżącego przesunięcia. Zmiana szybkości zachowuje zakres źródła, chyba że wkleisz także czas trwania. Rozgrupuj lub rozłącz klipy przed zmianą ich czasu w tym miejscu; czas rozciągniętych klipów edytuj w edytorze źródła.

Zaznacz komórkę, przeciągnij przez zakres lub kliknij inną komórkę z wciśniętym **Shift**, aby rozszerzyć zaznaczenie. Kliknij numer wiersza lub nagłówek kolumny, aby zaznaczyć cały wiersz lub kolumnę. Użyj **Ctrl+C** i **Ctrl+V** (**Cmd+C** i **Cmd+V** w systemie macOS), aby wymienić zaznaczenie z arkuszem kalkulacyjnym. Kolumny oddzielają tabulatory, a wiersze znaki nowej linii. Wklejanie zaczyna się od zaznaczonej komórki i aktualizuje istniejące klipy. Wklejenie wykraczające poza istniejące wiersze zostaje odrzucone. Przy zaznaczeniu naciśnij **Escape** lub kliknij pusty obszar pod tabelą, aby je wyczyścić. Bez zaznaczenia wklejanie wstawia nowe wiersze, także do pustego projektu. Opcje odtwarzania są kopiowane jako `true` lub `false` i przy wklejaniu przyjmują te wartości. Nowe wiersze zachowują kolejność kolumn tabeli i wymagają nazwy pliku źródłowego lub identyfikatora źródła. Unikatowa istniejąca nazwa ścieżki umieszcza klip na tej ścieżce; nowa nazwa tworzy ścieżkę audio. Puste nazwy ścieżek używają nazwy źródła. Puste komórki liczbowe przyjmują wartości domyślne: pozycja i przesunięcie `0`, szybkość `1`, wysokość i wzmocnienie `0`, bez zanikania. Pusty czas trwania oznacza pozostały dźwięk odtwarzany z żądaną szybkością.

Panel najpierw szuka źródła w projekcie, także w Koszu projektu. Jeśli go brakuje, wybierz **Wczytaj pliki źródłowe** i wskaż pliki audio wymienione w oknie dialogowym. Ścieżki do plików na dysku również wymagają takiego wyboru: wklejenie ścieżki nie daje aplikacji dostępu do pliku. Wybrane pliki muszą jednoznacznie odpowiadać wskazanym nazwom. Panel importuje dźwięk, sprawdza granice źródła i właściwości klipów, po czym umieszcza nowe klipy w podanych pozycjach. **Ctrl+Z** (**Cmd+Z** w systemie macOS) cofa całe wklejenie jednym krokiem; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) ponawia je. Jeśli wklejenie zawiera nieprawidłową wartość, klipy pozostają bez zmian.

## Zbuduj miks

Zrównoważ projekt za pomocą wzmocnienia ścieżek, panoramy oraz elementów sterujących wyciszeniem i solo. Panel Miksera pokazuje ten sam stan projektu w układzie ułatwiającym miksowanie. Efekty czasu rzeczywistego można nadal dostosowywać; operacje destrukcyjne lub renderowane zmieniają projekt, a ich skutki można cofnąć, dopóki historia jest dostępna.

Sprawdź wynik za pomocą miernika odtwarzania i analizy głośności. Nie traktuj docelowej wartości miernika jako zamiennika odsłuchu całego eksportu.

### Odsłuchaj wybrane częstotliwości {#listen-to-selected-frequencies}

Zaznacz fragment do odsłuchania. W menu ścieżki wybierz **Wizualizacja ścieżki → Spektrogram**, a następnie otwórz **Opcje spektrogramu → Wybierz zakres częstotliwości widma**. Wpisz minimalną i maksymalną częstotliwość, po czym wybierz **Wybierz zakres**, albo dostosuj uchwyty zaznaczenia na spektrogramie.

Wybierz **Opcje odtwarzania → Odtwórz wybrane częstotliwości** lub **Zaznacz → Widmo → Odtwórz wybrane częstotliwości**. Zaznaczony przedział czasu zostanie odtworzony raz z normalną szybkością, nawet jeśli wcześniej wybrano inną szybkość lub odtwarzanie w pętli. Filtr odsłuchu dotyczy bieżącego miksu, wraz z ustawieniami wyciszenia, solo, wzmocnienia i efektów. Prostokąt widma wskazuje pasmo częstotliwości i przedział czasu, ale nie włącza solo dla ścieżki. Jeśli odtwarzanie już trwa, polecenie je wstrzymuje; wybierz je ponownie, aby rozpocząć odsłuch filtrowanego pasma.

Filtry częstotliwości działające w czasie rzeczywistym mają łagodne zbocza. Częstotliwości poza pasmem stają się cichsze, podobnie jak te w pobliżu jego granic. **Wstrzymaj** lub **Zatrzymaj** usuwa filtr, więc kolejne zwykłe odtwarzanie wykorzystuje cały zakres częstotliwości. Dźwięk, zaznaczenia, historia cofania i wyeksportowane pliki pozostają bez zmian.

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

### Eksportowanie klipów do osobnych plików {#export-clips}

Wybierz **Plik → Eksportuj dźwięk** i ustaw **Wyjście** na **Pojedyncze klipy (podziel według klipów)**. Wybierz format audio i naciśnij **Eksportuj**, aby pobrać archiwum zawierające jeden plik dla każdego klipu audio na ścieżkach audio projektu. Każdy plik zaczyna się w słyszalnym początku klipu i kończy w jego słyszalnym końcu — bez dopełniania do osi czasu projektu ani dodawania wybrzmienia efektu. Uwzględniane są przycięcia, wzmocnienie klipu, zanikanie oraz zmiany szybkości i wysokości dźwięku. Nakładające się klipy pozostają osobne.

Pliki używają nazw klipów z numerowanymi przedrostkami. Nieobsługiwane znaki w nazwach plików są zastępowane, a numery odróżniają powtarzające się nazwy klipów. Uwzględniane są efekty ścieżek; efekty główne, wyciszenie i solo nie wpływają na ten eksport. Przed osobnym eksportem edytowalnych klipów rozmroź zamrożone ścieżki.

Formaty skompresowane korzystają ze środowiska FFmpeg. Dokładne formaty i warunki ich dostępności opisano w [wygenerowanej dokumentacji formatów](/reference/).

### Osadź etykiety rozdziałów {#embedded-chapters}

W edytorze przeglądarkowym wybierz **Plik → Eksportuj dźwięk**, następnie **MP3** lub **AAC / M4A**, i włącz **Osadź etykiety jako rozdziały** w **Opcjach dźwięku**. Opcja jest domyślnie wyłączona i dodaje tytuły oraz czasy etykiet do jednego zmiksowanego pliku. Dodaj etykiety przed eksportem; stem, podział na rozdziały i sekwencje masteringu nie udostępniają tej opcji.

Uwzględniane są tylko etykiety przecinające dostarczany zakres. Eksport zaznaczenia przesuwa czasy rozdziałów na początek wynikowego pliku. MP3 zachowuje czasy końcowe etykiet obszaru; etykieta punktowa kończy się przy następnym rozdziale lub na końcu pliku. M4A zapisuje początki rozdziałów, a każdy rozdział trwa do następnego początku lub końca pliku. M4A obsługuje maksymalnie 255 rozdziałów i 255 bajtów UTF-8 na tytuł. To, czy odtwarzacz pokazuje osadzone rozdziały, zależy od odtwarzacza.

Przed przekazaniem pliku lub usunięciem materiału źródłowego odtwórz wyeksportowany plik w innej aplikacji.

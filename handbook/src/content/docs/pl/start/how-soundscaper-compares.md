---
title: "Jak Soundscaper wypada na tle konkurencji"
description: "Porównanie Soundscaper Web i Desktop z Audacity 4 oraz Adobe Audition pod kątem nagrywania, edycji, miksowania, przygotowania materiałów i wymiany projektów."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-5.6-luna"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"pl"} -->

Soundscaper odtwarza Audacity 4 w przeglądarce i dodaje do niego warstwę produkcyjną. Adobe Audition to komercyjne narzędzie postprodukcyjne, z którym zwykle porównuje się oba produkty. Ta strona zestawia Soundscaper Web, Soundscaper Desktop, Audacity 4 i Audition, aby pomóc ustalić, która wersja już spełnia Twoje potrzeby.

## Jak czytać tę stronę

Każda komórka zaczyna się od symbolu oznaczonego kolorem, po którym następuje objaśnienie:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — obsługiwane lub ma zastosowanie
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — ograniczony zakres, zależność od platformy albo obejście
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — niedostępne lub nie dotyczy

Czytaj objaśnienia razem z symbolami. Opcjonalna instalacja wtyczki, modelu lub kodeka sama w sobie nie ogranicza obsługiwanej funkcji desktopowej; objaśnienie wskazuje, co trzeba zainstalować. Web i Desktop mają osobne kolumny, więc ograniczenie przeglądarki nie obniża oceny wersji Desktop.

Wiersze opisują możliwości, a nie polecenia menu. Pełny wykaz poleceń znajdziesz w sekcji [Polecenia i skróty](/reference/generated/commands/), a informacje o funkcjach dostępnych w każdym programie — w sekcji
[Możliwości produktu](/reference/generated/product-capabilities/).

### Skąd pochodzą te twierdzenia

- Wiersze dotyczące **Soundscaper** opierają się na danych z tego repozytorium: profilach możliwości produktów, manifeście akcji środowiska uruchomieniowego, rejestrze formatów eksportu oraz kontrolach obsługi kodeków w przeglądarce i na desktopie.
  Natywne pakiety docelowe dla desktopu są generowane przez CI repozytorium lub pakowanie dla danego celu. Pakiet udostępnia funkcję dopiero po przygotowaniu i zweryfikowaniu dokładnie odpowiadającego mu pakietu; wiersze wskazują, kiedy pakiet nadal jest wymagany.
- Wiersze dotyczące **Audacity 4** bazują na inwentaryzacji upstream przypiętej w tym repozytorium: `4.0.0` w commicie `4c177d43`, z uwzględnieniem widocznych dla użytkownika zmian do oficjalnego wydania [`4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) w commicie `d82386ce`. Funkcja zarejestrowana upstream, lecz wyłączona lub zakomentowana w menu, jest tak oznaczona. Funkcja bez wpisu w sprawdzonej inwentaryzacji ani informacjach o wydaniu jest opisana jako nieobecna w tych materiałach, a nie jako trwale nieobecna. Rysowanie próbek, obwiednie głośności klipu i import starszych projektów opisano również w oficjalnym [dzienniku zmian 4.0](https://www.audacityteam.org/changelog/) i [podręczniku głośności klipu](https://www.audacityteam.org/manual/clips/clip-gain/).
- Wiersze dotyczące **Audition** pochodzą z opublikowanej dokumentacji Adobe dla bieżącej
  wersji. Nie są one weryfikowane w działającej kompilacji.

## Platforma i terminologia

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Licencja | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, open source | / — własnościowa i zamknięta |
| Koszt | + — bezpłatny | + — bezpłatny | + — bezpłatny | / — subskrypcja Creative Cloud |
| Działa w przeglądarce | + — Chromium, Firefox i WebKit | / — aplikacja desktopowa | / — tylko na komputerach | / — tylko na komputerach |
| Wersje komputerowe | / — użyj wersji przeglądarkowej | + — Windows i Linux na x64 i ARM64, macOS na ARM64 | + — Windows (instalator lub wersja przenośna), macOS, Linux | ~ — Windows i macOS, brak Linuxa |
| Działa bez konta | + — konto nie jest wymagane | + — konto nie jest wymagane | + — logowanie jest wymagane tylko w audio.com | / — wymagana jest aktywna subskrypcja i zalogowanie |
| Chmurowe przechowywanie projektów | / — wykluczone przez lokalny model działania | / — wykluczone przez lokalny model działania | + — zapisywanie i udostępnianie przez audio.com | ~ — pliki Creative Cloud, sesje nie są synchronizowane |
| Wymagania systemowe | + — działa wszędzie tam, gdzie działa aktualna przeglądarka | + — Windows, Linux lub macOS na obsługiwanych architekturach desktopowych | ~ — znacznie wyższe niż w Audacity 3 | ~ — wymagania typowe dla profesjonalnej stacji roboczej |

## Model projektu i sesji

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Natywny format projektu | + — `.sscape`, przenośne archiwum bezstratne | + — `.sscape`, przenośne archiwum bezstratne | + — `.aup4` | + — `.sesx` |
| Otwieranie projektów Audacity | + — import AUP, AUP3 i AUP4; eksport AUP3 i AUP4 | + — import AUP, AUP3 i AUP4; eksport AUP3 i AUP4 | + — import AUP, AUP3 i AUP4; eksport AUP4, bez eksportu AUP3 | / |
| Nieniszcząca oś czasu klipów | + | + | + | + — edytor wielościeżkowy |
| Dedykowany edytor pojedynczego pliku | + — edytor przebiegu źródłowego w ustawieniach klipu | + — edytor przebiegu źródłowego w ustawieniach klipu | ~ — zmiany są wprowadzane bezpośrednio na osi czasu | + — edytor przebiegu fali |
| Treść mono i stereo na jednej ścieżce | + — ścieżka zawiera jedno lub drugie | + — ścieżka zawiera jedno lub drugie | / — ścieżka jest mono lub stereo | / — format kanału jest ustalony dla ścieżki |
| Zagnieżdżone foldery ścieżek | + — dowolna głębokość, z możliwością cofania i kierowania sygnału | + — dowolna głębokość, z możliwością cofania i kierowania sygnału | / | ~ — tylko szyny miksów podrzędnych, brak folderów ścieżek |
| Zasobnik projektu | + — porządkuje pliki i pełni też funkcję schowka | + — porządkuje pliki i pełni też funkcję schowka | / | ~ — panel Pliki wyświetla otwarte pliki |
| Automatyczne zapisywanie i odzyskiwanie po awarii | + — automatyczny zapis, blokady i pakiety danych odzyskiwania | + — automatyczny zapis, blokady i pakiety danych odzyskiwania | + | + |
| Markery i nazwane regiony | + — pełnoprawne, z nawigacją i zachowaniem przesuwania przy edycji | + — pełnoprawne, z nawigacją i zachowaniem przesuwania przy edycji | ~ — ścieżki etykiet | + — markery i zakresy |
| Mapy tempa i metrum | + — uporządkowane mapy wyznaczane z dokładnością do próbki | + — uporządkowane mapy wyznaczane z dokładnością do próbki | ~ — jedno tempo i metrum projektu | ~ — jedno tempo sesji |

## Nagrywanie

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Nagrywanie wielościeżkowe | + — kilka źródeł jednocześnie | + — kilka źródeł jednocześnie | ~ — jedno urządzenie wejściowe naraz | + — interfejsy z wieloma wejściami i obsługą wielu kanałów |
| Jednoczesne nagrywanie mikrofonu i dźwięku z komputera | ~ — wbudowane, jeśli przeglądarka i system operacyjny udostępniają dźwięk ekranu | + — mikrofon i przechwytywanie dźwięku pulpitu w Windows; inne systemy wymagają wejścia loopback | / | ~ — wymaga systemowego urządzenia loopback |
| Nagrywanie o wyznaczonej porze | + | + | + | / |
| Nagrywanie aktywowane dźwiękiem | + — z ustawialnym progiem | + — z ustawialnym progiem | + — z ustawialnym progiem | / |
| Odliczanie przed nagraniem | + — uwzględnia mapę tempa i obsługuje metrum złożone | + — uwzględnia mapę tempa i obsługuje metrum złożone | ~ — nagrywanie z wyprzedzeniem | ~ — wstępne nagranie jako część dogrywania z przewijaniem |
| Nagrywanie z dogrywką | + — jedna operacja, przechwytywanie domyślne i kierowane sygnałem | + — jedna operacja, przechwytywanie domyślne i kierowane sygnałem | / | + — dogrywanie z przewijaniem |
| Nagrywanie w pętli do wielu ujęć | + — osobna ścieżka dla każdego przejścia, dodawana do tej samej grupy | + — osobna ścieżka dla każdego przejścia, dodawana do tej samej grupy | / | ~ — ujęcia na jednym klipie, wybierane z listy |
| Łączenie najlepszych fragmentów ujęć | + — odsłuchiwanie, wybór, edycja regionów złożonego ujęcia i spłaszczenie ich w jedną operację z możliwością cofnięcia | + — odsłuchiwanie, wybór, edycja regionów złożonego ujęcia i spłaszczenie ich w jedną operację z możliwością cofnięcia | / | / — brak edytora do łączenia ujęć |
| Monitorowanie i mierniki wejścia | + | + | + | + |

## Edycja osi czasu

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Warianty edycji z przesuwaniem | + — dla każdego klipu, dla każdej ścieżki i dla wszystkich ścieżek; przy wycinaniu i usuwaniu | + — dla każdego klipu, dla każdej ścieżki i dla wszystkich ścieżek; przy wycinaniu i usuwaniu | + — te same trzy warianty, przy wycinaniu i usuwaniu | ~ — usuwanie z przesuwaniem dla zaznaczenia lub luki |
| Dzielenie, łączenie i dzielenie w miejscach ciszy | + | + | + | ~ — dzielenie i przycinanie, brak łączenia klipów |
| Grupy klipów | + | + | + | + |
| Wzmocnienie klipu | + | + | + | + |
| Wysokość dźwięku i tempo dla każdego klipu | + — regulacja, renderowanie lub reset | + — regulacja, renderowanie lub reset | + — regulacja, renderowanie lub reset | ~ — rozciąganie pozostaje edytowalne, zmiana wysokości dźwięku jest efektem |
| Podążanie za zmianami tempa | + — klipy rozciągają się wraz ze zmianami mapy | + — klipy rozciągają się wraz ze zmianami mapy | + | / |
| Kwantyzacja i groove uwzględniające rytm | + — mapy rozciągania z regulowaną siłą groove | + — mapy rozciągania z regulowaną siłą groove | / | / |
| Przyciąganie do zerowych przejść | + | + | + | + |
| Rysowanie na poziomie próbek | + | + | + — dostępne po powiększeniu do pojedynczych próbek | + — w edytorze przebiegu fali |
| Edycja wyłącznie z klawiatury | + — każda podstawowa akcja edycji ma akcję nawigacji | + — każda podstawowa akcja edycji ma akcję nawigacji | + — operacje edycji, oś czasu i pionowe linijki ścieżek można obsługiwać klawiaturą | ~ — rozbudowane skróty klawiszowe, niektóre panele wymagają myszy |

## Prace spektralne i restaurowanie

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Widok spektrogramu | + — z ustawieniami dla każdej ścieżki | + — z ustawieniami dla każdej ścieżki | + — z ustawieniami dla każdej ścieżki | + — wyświetlacze częstotliwości i wysokości tonu |
| Zaznaczanie z ograniczeniem częstotliwości | + | + | + | + — ramka i lasso |
| Pędzel spektralny | + | + | + | + — pędzel i punktowa naprawa |
| Usuwanie lub wzmocnienie regionu spektralnego | + — oba jako bezpośrednie akcje | + — oba jako bezpośrednie akcje | + — oba jako bezpośrednie akcje | ~ — zastosowanie efektu do zaznaczenia |
| Naprawa krótkich uszkodzeń | + — Naprawa | + — Naprawa | + — Naprawa | + — Auto Heal i pędzel punktowej naprawy |
| Redukcja szumów szerokopasmowych | + — z przechwyconym profilem | + — z przechwyconym profilem | + — z przechwyconym profilem | + — Noise Reduction, Adaptive Noise Reduction, DeNoise |
| Redukcja pogłosu | / — asystent tylko w wersji Desktop | + — Reduce Reverb po zainstalowaniu opcjonalnego modelu i silnika | / | + — DeReverb |
| Narzędzia do usuwania trzasków, przydźwięku i sybilantów | ~ — Click Removal i De-esser; brak osobnego narzędzia do usuwania przydźwięku | ~ — Click Removal i De-esser; brak osobnego narzędzia do usuwania przydźwięku | ~ — tylko Click Removal | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Panel diagnostyczny | ~ — Find Clipping jako narzędzie analityczne | ~ — Find Clipping jako narzędzie analityczne | ~ — Find Clipping jako narzędzie analityczne | + — diagnostyka i naprawa poszczególnych problemów |

## Efekty i wtyczki

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Zestaw wbudowanych efektów | + — efekty pochodzące z Audacity, dołączone wtyczki Nyquist i własne efekty, takie jak Bitcrusher i De-esser | + — efekty pochodzące z Audacity, dołączone wtyczki Nyquist i własne efekty, takie jak Bitcrusher i De-esser | + — 30 wbudowanych efektów w przypiętej wersji | + — około pięćdziesięciu, w tym wielopasmowe efekty dynamiczne |
| Zestaw efektów działających w czasie rzeczywistym dla każdej ścieżki | + — szerszy zestaw efektów niż w wersji źródłowej | + — szerszy zestaw efektów niż w wersji źródłowej | + | + — szesnaście miejsc na efekty dla klipu, ścieżki i miksu głównego |
| Korektor parametryczny | + — nowy korektor parametryczny z pasmami obsługującymi automatykę | + — nowy korektor parametryczny z pasmami obsługującymi automatykę | ~ — Filter Curve i Graphic EQ | + — filtry parametryczne, graficzne i FFT |
| Presety efektów | + — stosowanie, zapisywanie, importowanie i eksportowanie | + — stosowanie, zapisywanie, importowanie i eksportowanie | + — stosowanie, zapisywanie, importowanie i eksportowanie | + |
| Makra i łańcuchy wsadowe | + — zapisana biblioteka makr z szablonami | + — zapisana biblioteka makr z szablonami | / — przypięta wersja wyłącza menu Makra | + — Ulubione i Batch Process |
| Formaty wtyczek innych firm | / — wtyczki natywne wymagają Desktop | + — VST3, CLAP, AU, LV2, Linux LADSPA i Vamp; zależnie od platformy, za zgodą i w izolacji | + — VST3, AU, LV2 i Nyquist, z menedżerem wtyczek | ~ — VST3 oraz AU na macOS, brak CLAP i LV2 |
| Skrypty Nyquist | + — dołączone wtyczki i konsola poleceń Nyquist | + — dołączone wtyczki i konsola poleceń Nyquist | + — dołączone wtyczki i konsola poleceń Nyquist | / |
| Izolowane pakiety efektów | ~ — sprawdzone pakiety WebAssembly; jeden jest dołączony, a zewnętrzne działają w izolacji | ~ — sprawdzone pakiety WebAssembly; jeden jest dołączony, a zewnętrzne działają w izolacji | / | / |
| Instrumenty wirtualne | / | / | / | / |

## Miksowanie, routing i automatyzacja

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Mikser z paskami kanałów | + | + | ~ — elementy sterujące ścieżką i ścieżka główna | + |
| Szyny i submiksy | + — zagnieżdżone, z walidacją cyklu | + — zagnieżdżone, z walidacją cyklu | / | + — ścieżki szyn |
| Wysyłki (Sends) | + — przed tłumikiem kanału i za nim, wiele przypisań | + — przed tłumikiem kanału i za nim, wiele przypisań | / | + — przed tłumikiem kanału i za nim |
| Grupy VCA | + | + | / | / |
| Wejście sygnału sterującego (sidechain) | + | + | / | + — przez wysyłki |
| Miksy odsłuchowe i reżyserskie | + | + | / | / |
| Kompensacja opóźnień wtyczek | + — odtwarzanie, monitorowanie, szyny, sidechainy, render i zamrażanie | + — odtwarzanie, monitorowanie, szyny, sidechainy, render i zamrażanie | ~ — niewidoczne w przypiętych źródłach | + |
| Ścieżki automatyzacji | + — wzmocnienie, panoramowanie, wyciszenie, wysyłki, szyny i parametry wtyczek | + — wzmocnienie, panoramowanie, wyciszenie, wysyłki, szyny i parametry wtyczek | ~ — obwiednie głośności klipu; brak ścieżek automatyzacji toru i efektów | + — głośność, panoramowanie i parametry efektów |
| Tryby automatyzacji | + — odczyt, korekta, dotyk, zatrzask i zapis | + — odczyt, korekta, dotyk, zatrzask i zapis | / | ~ — odczyt, zapis, zatrzask i dotyk; brak korekty |
| Kształty krzywych | + — linia, podtrzymanie i krzywa | + — linia, podtrzymanie i krzywa | ~ — tylko obwiednie głośności klipu | + — liniowa i spline |
| Zamrażanie ścieżki | + — zamrażanie, odmrażanie i zatwierdzanie bez utraty stanu | + — zamrażanie, odmrażanie i zatwierdzanie bez utraty stanu | / | ~ — konwersja do nowej ścieżki |

## Pomiar i analiza

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Miernik głośności | + — zgodny ze stylem EBU R 128, z historią | + — zgodny ze stylem EBU R 128, z historią | / — dostępny jest efekt normalizacji głośności, ale brak miernika | + — Loudness Radar zgodny z ITU-R BS.1770 |
| Miernik fazy i korelacji | + | + | / | + — miernik fazy i analiza |
| Pomiar dźwięku przestrzennego | + | + | / | ~ — do 5.1 |
| Wykres widma | + — Plot Spectrum | + — Plot Spectrum | ~ — polecenie jest zarejestrowane, ale w przypiętej wersji zakomentowane w menu Analiza | + — Frequency Analysis |
| Przesterowania i RMS na przebiegu fali | + — ustawienie projektu z możliwością nadpisania RMS dla ścieżek | + — ustawienie projektu z możliwością nadpisania RMS dla ścieżek | + — oba wskazania można włączać osobno dla projektu | ~ — wskaźniki przesterowania; RMS w statystykach amplitudy |
| Analiza kontrastu zrozumiałości mowy | + — analizator Contrast | + — analizator Contrast | ~ — polecenie jest zarejestrowane, ale w przypiętej wersji zakomentowane w menu Analiza | / |

W Soundscaper otwórz menu **Track visualization** ścieżki, aby włączyć lub wyłączyć **Half-wave** albo **Show RMS in waveform**. Widok domyślny, częstotliwości podziału pasm 3-drożnej zwrotnicy i ustawienia spektrogramu znajdują się w **Edit → Preferences → Track display**.

## Kanały i dźwięk immersyjny

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Liczba kanałów w pliku | + — do 32 dla formatów PCM | + — do 32 dla formatów PCM | ~ — ścieżki mono i stereo | + — do 32 w edytorze przebiegu fali |
| Miksowanie dźwięku przestrzennego | + — warstwy kanałów do 7.1.4 | + — warstwy kanałów do 7.1.4 | / | ~ — do 5.1 |
| Dźwięk oparty na obiektach | + — obiekty obok warstw kanałów | + — obiekty obok warstw kanałów | / | / |
| Tworzenie i przekazywanie ADM | + — BW64/ADM z kontrolą zgodności ze standardem | + — BW64/ADM z kontrolą zgodności ze standardem | / | / |
| Renderowanie binauralne | + — model binauralny o określonej nazwie | + — model binauralny o określonej nazwie | / | ~ — binauralizator dla ambisoniki |
| Ambisonika | / | / | / | + — pierwszego rzędu, z panoramowaniem VR |

## Eksport i dostawa

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Eksport bezstratny | + — natywny zapis WAV, AIFF, BWF i BW64; FLAC i WavPack przez dedykowane kodeki | + — natywny zapis WAV, AIFF, BWF i BW64; FLAC i WavPack przez dedykowane kodeki | + — WAV, AIFF i FLAC | + — WAV, AIFF, FLAC i inne |
| Eksport do formatów stratnych | ~ — MP3, MP2, Opus i Ogg Vorbis; AAC zależy od przeglądarki | + — MP3, MP2, Opus, Ogg Vorbis i AAC przez obsługiwane dostawcy kodeków, w tym skonfigurowany FFmpeg | + — MP3, Opus i Ogg Vorbis; dodatkowe formaty przez opcjonalny FFmpeg | ~ — MP2, MP3 i Ogg Vorbis; więcej przez Adobe Media Encoder, bez ogólnego celu FFmpeg |
| Niestandardowe ustawienia kodera | ~ — ustawienia dla każdego formatu; własne argumenty FFmpeg są niedostępne | ~ — ustawienia dla każdego formatu; własne argumenty FFmpeg są niedostępne | + — własny cel FFmpeg | + — opcje dla każdego formatu |
| Kolejka eksportu | + — pauza, anulowanie, ponowna próba i zmiana kolejności | + — pauza, anulowanie, ponowna próba i zmiana kolejności | / — Export Multiple to pojedyncza operacja sekwencyjna, a nie kolejka zadań | ~ — Batch Process bez kontroli kolejki |
| Ścieżki składowe i wersje alternatywne w jednym przebiegu | + — dodawane do kolejki razem z miksem | + — dodawane do kolejki razem z miksem | ~ — Export Multiple zapisuje każdą ścieżkę osobno, ale nie kolejkuje razem miksu i alternatywnych renderów | ~ — osobny miks dla każdej ścieżki składowej |
| Eksport region po regionie | + — sekwencje masteringu z metadanymi dla każdego regionu, przerwami i płynnymi przejściami | + — sekwencje masteringu z metadanymi dla każdego regionu, przerwami i płynnymi przejściami | + — Export Multiple zapisuje każdy oznaczony region do osobnego pliku | + — eksport znaczników do osobnych plików |
| Normalizacja głośności przy eksporcie | + — część planu dostarczenia materiału | + — część planu dostarczenia materiału | ~ — najpierw trzeba uruchomić efekt | + — Match Loudness |
| Dithering i mapowanie kanałów | + — jawne ustawienia | + — jawne ustawienia | ~ — dithering w preferencjach | + — jawne ustawienia |
| Raport dostawy | + — szczegółowe zestawienie dla każdego zadania | + — szczegółowe zestawienie dla każdego zadania | / | / |
| Kolejka renderowania zachowuje się po restarcie | / — trwałe odzyskiwanie renderowania wymaga Desktop | + — wznawia od zera, korzystając z dziennika awarii | / | / |

Soundscaper Desktop może używać skonfigurowanego FFmpeg dla obsługiwanych formatów eksportu; bieżący edytor nie udostępnia dowolnych argumentów FFmpeg ani wszystkich enkoderów FFmpeg. Zobacz [Formaty eksportu](/reference/generated/formats/) dla zarejestrowanych celów. [Eksport w Audacity](https://www.audacityteam.org/manual/getting-started/export-your-audio/) obsługuje dodatkowe formaty po opcjonalnej instalacji FFmpeg. Audition oferuje stały zestaw zapisujących formaty narzędzi oraz [przekazanie do Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Wymiana z innymi narzędziami

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Projekty Audacity | + — import AUP, AUP3 i AUP4; eksport AUP3 i AUP4 z raportem zgodności | + — import AUP, AUP3 i AUP4; eksport AUP3 i AUP4 z raportem zgodności | + — import AUP, AUP3 i AUP4; eksport AUP4, bez eksportu AUP3 | / |
| Sesje Audition | / — import SESX wymaga Desktop | ~ — import audio z `.sesx` z raportem pominięć; brak eksportu | / — brak importu SESX w przypiętej wersji | + — natywny |
| EDL | ~ — eksport w formacie klasy CMX3600, brak importu | ~ — eksport w formacie klasy CMX3600, brak importu | / | / |
| OpenTimelineIO | ~ — tylko eksport | ~ — tylko eksport | / | / |
| FCPXML | ~ — tylko eksport | ~ — tylko eksport | / | + — import i eksport |
| DAWproject | + — import i eksport, z raportem wymiany | + — import i eksport, z raportem wymiany | / | / |
| OMF | / | / | / | ~ — import i eksport |
| Współpraca z edytorem wideo | ~ — przekazuje ten sam projekt do Framescaper bez kopiowania plików multimedialnych | ~ — przekazuje ten sam projekt do Framescaper bez kopiowania plików multimedialnych | / | + — Dynamic Link z Premiere Pro |
| Wymiana etykiet i znaczników | + — import i eksport | + — import i eksport | + — import i eksport | + — listy znaczników |

Informacje o imporcie do Soundscaper plików `.sesx` pochodzących z Audition, obsługiwanych ustawieniach audio oraz pominięciach wymienionych w raporcie znajdziesz w sekcji [Pliki projektów](/projects-and-data/project-files/).

## Wideo

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Import wideo jako materiału referencyjnego | + — na osi czasu, z powiązanym dźwiękiem | + — na osi czasu, z powiązanym dźwiękiem | / | ~ — jedna ścieżka wideo, tylko podgląd |
| Edycja osi czasu wideo | ~ — podstawowy zakres edycji; pełny zestaw funkcji jest w Framescaper | ~ — podstawowy zakres edycji; pełny zestaw funkcji jest w Framescaper | / | / |
| Eksport wideo | ~ — MP4 i WebM, jeśli WebCodecs przeglądarki obsługuje wymagane kodeki | + — MP4 i WebM ze zweryfikowanym dostawcą kodeków Desktop | / | / — tylko dźwięk |
| Kompozycja, korekcja kolorów i efekty | ~ — w Framescaper, w tym samym projekcie | ~ — w Framescaper, w tym samym projekcie | / | / |

## Pomoc maszynowa

Funkcje asystenta są dostępne w Desktop po zainstalowaniu opcjonalnych wag modelu i pasującego natywnego silnika; w Web te procesy są niedostępne. Model Manager instaluje oba składniki. Zobacz [Lokalny asystent](/reference/generated/local-assistance/) — dostępne procesy i modele.

| Funkcja | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Poprawa jakości mowy | / — asystent tylko w wersji Desktop | + — po zainstalowaniu opcjonalnego modelu i silnika | / | + — Enhance Speech |
| Transkrypcja i diarizacja | / — asystent tylko w wersji Desktop | + — po zainstalowaniu opcjonalnych modeli i silników | / | / — transkrypcje są dostępne w Premiere Pro |
| Separacja źródeł na ścieżki składowe | / — asystent tylko w wersji Desktop | + — po zainstalowaniu opcjonalnego modelu i silnika | / | / |
| Automatyczne tłumienie | + — efekt Auto Duck | + — efekt Auto Duck | + — efekt Auto Duck | + — tłumienie Essential Sound |
| Wykrywanie rytmu i ujęć | / — wykrywanie rytmu wymaga Desktop; wykrywanie ujęć jest w Framescaper | ~ — wykrywanie rytmu z opcjonalnym modelem; wykrywanie ujęć jest w Framescaper | / | ~ — Remix automatycznie zmienia tempo muzyki |
| Całe przetwarzanie odbywa się na Twoim urządzeniu | + — lokalne przetwarzanie w przeglądarce; bez wnioskowania modelu | + — lokalne przetwarzanie i wnioskowanie offline po instalacji modelu | + — brak wnioskowania | ~ — niektóre funkcje są przetwarzane w chmurze Adobe |
| Modele są opcjonalne i można je usunąć | / — w Web nie trzeba instalować modeli | + — pobierane osobno, przypięte do sumy kontrolnej i możliwe do usunięcia | + — nic do instalacji | / — wbudowane w aplikację |

## Co oznaczają różnice

Audacity 4 to edytor działający w jednym przebiegu. Przypięta wersja nie ma magistral, wysyłek, ścieżek automatyzacji ścieżek ani efektów i makr. Obwiednie głośności klipu umożliwiają automatyzację głośności wewnątrz klipu. Soundscaper zachowuje ten model edycji, a ponadto dodaje automatyzację ścieżek i efektów, miksowanie i przygotowanie materiałów do dostarczenia, a także nagrywanie, wideo i wymianę projektów, których Audacity nie oferuje.

Audition nadal oferuje bardziej zaawansowane narzędzia restauracji dźwięku, wymianę projektów z Premiere Pro i obsługę ambisoniki. Soundscaper wyróżnia się przygotowaniem materiału immersyjnego do dostarczenia, obsługą projektów oraz działaniem w przeglądarce na sprzęcie, którego pozostałe programy nie obsługują.

Jeśli już pracujesz w Audacity, zobacz
[pliki projektowe i wymiana z Audacity](/projects-and-data/project-files/) ,
aby dowiedzieć się, jak przenieść projekt.

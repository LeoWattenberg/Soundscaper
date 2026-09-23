---
title: "Przetwarzanie lokalne, modele i wtyczki"
description: "Znajdź lokalne funkcje wspomagające według zadania oraz zarządzaj modelami i wtyczkami w edytorach desktopowych."
---

<!-- docs-ai-provenance: {"factPacketSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","model":"gpt-5.6-luna","modelDigest":"manual","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"922fb6c279e1a4499967f68b55d60fdc332bb1b2bd3144cff2f87824add1b7b7","targetLocale":"pl"} -->

Funkcje lokalne działają na Twoim urządzeniu w desktopowych edytorach Soundscaper i Framescaper. Zaznacz materiał, a następnie wybierz zadanie z menu. Okno dialogowe pokazuje zaznaczenie, ustawienia zadania i informację, czy jego modele są zainstalowane.

Pakiety desktopowe zawierają natywne silniki przetwarzania dla opublikowanych modeli lokalnych. Zainstaluj wagi modelu za pomocą Menedżera modeli, a następnie uruchom zadanie dla zaznaczonego materiału. Informacje o obsługiwanych platformach, pozycji w menu i wymaganiach znajdziesz w [przewodniku po danym modelu](/reference/local-models/).

## Znajdź zadanie {#find-a-task}

| Menu | Zadania |
| --- | --- |
| Efekt → Usuwanie szumu i naprawa | Ulepsz dialog, Zmniejsz rezonans, Wyczyść wypełniacze i ciszę |
| Efekt → Separacja źródeł | Oddziel dialog / muzykę / efekty |
| Analiza → Mowa | Transkrypcja i napisy, Identyfikuj mówców, Oznacz reakcje |
| Analiza → Muzyka | Wykryj bity i tempo |
| Analiza → Wideo | Oznacz cięcia |
| Efekt → Efekty wideo | Zmień kadr |
| Edytuj | Twórz wyróżnienia |
| Generuj | Generuj tekst redakcyjny |
| Narzędzia → Wyszukiwanie | Wyszukiwanie indeksowane, Indeksuj transkrypcję, Indeksuj wideo |

Zadania wideo są dostępne w Framescaper. Dostępne polecenia zależą od środowiska desktopowego i możliwości produktu. Opcja alfabetycznego sortowania menu efektów w Soundscaper porządkuje też efekty przetwarzania lokalnego według nazw.

Wybierz **Uruchom lokalnie**, aby rozpocząć przetwarzanie, i odpowiedz na monit o zgodę. W trakcie pracy możesz anulować zadanie. Wybierz **Przejrzyj wynik**, zaznacz wyniki, które chcesz przyjąć, i wybierz **Zastosuj wybrane**. Zaakceptowane zmiany w projekcie można cofnąć. Zamknięcie zadania nie stosuje proponowanych zmian.

Polecenie **Narzędzia → Zaawansowana obróbka lokalna** nadal udostępnia osobne selektory operacji i modeli. W razie potrzeby szczegóły techniczne w oknach zadań pokazują użyte kroki i dokładne ustawienia.

## Zarządzaj modelami {#manage-models}

Otwórz **Narzędzia → Menedżer modeli** albo wybierz **Zarządzaj modelami** wewnątrz zadania. Odnośnik z zadania filtruje listę według zgodnych identyfikatorów modeli; **Pokaż wszystkie modele** usuwa to ograniczenie. Wyszukuj według nazwy lub zadania, a listę filtruj według stanu instalacji.

Modele instaluj jawnie. Postęp pobierania jest widoczny; pobieranie można anulować. Powrót do zadania zachowuje jego ustawienia i odświeża dostępność modeli, ale nie rozpoczyna przetwarzania. Rozwiń **Zarządzanie magazynem i weryfikacja**, aby naprawiać i usuwać dane, przenosić magazyn, przeglądać informacje licencyjne oraz instalować modele offline z folderu.

Przewodniki po [poszczególnych modelach](/reference/local-models/) opisują przeznaczenie każdego opublikowanego modelu, pozycję w menu, rozmiar pobierania, wymagania i ograniczenia, a także rzeczywiste testy wnioskowania wykonywane przez nocny pakiet desktopowy z testami.

## Zarządzaj wtyczkami i urządzeniami {#manage-plugins-and-devices}

Polecenie **Efekt → Menedżer wtyczek** wyświetla wtyczki audio w Soundscaper oraz wtyczki OpenFX w Framescaper. Wyszukaj wtyczkę lub przefiltruj listę, a następnie wybierz ją, aby zobaczyć jej wersję, uprawnienia i opcje odzyskiwania. Ustawienia wykrywania znajdziesz w sekcji **Skanowanie i ustawienia**. Menedżer pozostaje dostępny również wtedy, gdy przetwarzanie jest wyłączone.

Używaj wtyczek audio przez **Efekt → Efekty wtyczek audio**. Polecenia Framescaper do dodawania i edycji efektów wideo znajdują się w menu **Efekt → Efekty wideo**.

Otwórz **Edycja → Ustawienia → Ustawienia audio**, aby skonfigurować natywne urządzenia audio i narzędzia pomocnicze. Sekcja **Multimedia** zawiera ustawienia mediów, a **Efekty** prowadzi do Menedżera wtyczek i zawiera przełącznik wykrywania wtyczek. Zmiana uprawnień wtyczek i odzyskiwanie z kwarantanny nadal wymagają jawnego działania.

---
title: "Pliki projektu"
description: "Wybierz między lokalną biblioteką, plikami projektu Scape, AUP4 i renderowanymi kopiami zapasowymi."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"pl"} -->

## Lokalna biblioteka projektu

Edytor zapisuje pracujące projekty do swojej lokalnej biblioteki. W przeglądarce jest to magazyn prywatny dla pochodzenia; w edycji pulpitu jest to dane aplikacji. Jest to wygodna kopia robocza, nie jedyna, którą powinieneś zachować.

## Pliki projektu Scape

Użyj **Plik → Eksportuj plik projektu** dla bezstratnego, przenośnego projektu. Każdy produkt zapisuje własny sufiks: Soundscaper zapisuje `.sscape`, a Framescaper zapisuje `.fscape`, a nazwa pozycji menu zależy od tego, który sufiks jest stosowany. Format za obu jest taki sam, więc jest to odpowiedni wybór, gdy musisz zachować stan edycji multimediów.

Każdy produkt otwiera oba sufiksy. `.sscape`, `.fscape`, zarezerwowany `.liscape` i starsze pliki `.scape`, które zostały wyeksportowane przed wprowadzeniem własnych sufiksów przez produkty, otwierają się wszędzie, a zapisanie jednego z innego produktu po prostu zmienia jego nazwę - na przykład plik `Mix.sscape` zapisany w Framescaper staje się `Mix.fscape`. Nic w projekcie nie zmienia się wraz ze zmianą nazwy.

Importowanie lub otwieranie kopii Scape może napotkać istniejący projekt o tym samym ID. Użyj oferowanego przepływu kopii, gdy obie wersje muszą pozostać w lokalnej bibliotece.

## AUP4

AUP4 istnieje dla kompatybilnej wymiany audio z Audacity. Eksport generuje raport kompatybilności opisujący konwersje, niedostępne efekty i pominięty stan Soundscaper-only.

AUP4 jest tylko audio. Wideo jest pomijane, a preferencje przeglądarki, historia cofania, routing miksera i biblioteka projektów przeglądarki nie są przenoszone. Nie używaj AUP4 jako jedynej kopii zapasowej projektu Soundscaper lub Framescaper.

## Zapisana kopia zapasowa

W przypadku ważnych prac zachowaj oba:

1. Kopię projektu Scape (`.sscape` lub `.fscape`) na przyszłą edycję.
2. Zapisany plik audio lub wideo, który można odtwarzać bez edytora.

Przechowuj te pliki poza katalogiem danych przeglądarki lub aplikacji.

---
title: "Skórki edytora"
description: "Wybierz wizualną skórkę lub wypróbuj tymczasowo jedną za pomocą adresu URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"pl"} -->

Skiny zmieniają kolory, czcionki, obramowania i dekoracyjne tła edytora.
Dostępne są w Soundscaper i Framescaper. Każdy produkt pamięta własny wybór. Przestrzenie robocze nadal kontrolują układ paneli i narzędzi.

## Wybierz skórkę {#choose-a-skin}

Otwórz **Edytuj → Preferencje → Wygląd** i wybierz skórkę:

- **Domyślny** zachowuje oryginalny projekt edytora.
- **Sakura** łączy kwiaty wiśni, różowe akcenty i zaokrąglone litery.
- **Fioletowy** wykorzystuje chłodne fiolety i warstwowe fioletowe tekstury.
- **Techno** łączy grafiki niebieskich obwodów z czcionką monospacowaną.

Wybierz **Jasny**, **Ciemny** lub **Postępuj zgodnie z motywem systemu** oddzielnie. Każda skórka ma zarówno jasną, jak i ciemną wersję. **Styl wcięcia** pozostaje osobnym wyborem; paleta Kolorowa jest skoordynowana z każdą skórką, jednocześnie zachowując odrębne kolory wcięć.

Wysoki kontrast ma priorytet przed dekoracją skóry. Wyłączenie wysokiego kontrastu przywraca wybraną skórkę. Zmiana skórki nigdy nie zmienia dźwięku wcięcia, zawartości projektu ani układu przestrzeni roboczej.

## Wypróbuj skórkę z linku {#try-a-skin-from-a-link}

Dodaj `?useskin=sakura` do adresu URL edytora, aby tymczasowo wyświetlić podgląd Sakura. Użyj
`default`, `sakura`, `lilac` lub `techno` jako wartości. Jeśli adres URL już zawiera parametr zapytania, dołącz `&useskin=sakura`. Nieznana wartość jest ignorowana.

Podgląd URL nie zastępuje zapisanej skórki, nawet jeśli zmienisz inne preferencje. Odświeżenie adresu URL podglądu nadal wyświetla podgląd; odwiedzenie bez parametru używa Twojego zapisanych wyborów. Parametr nie wybiera światła ani ciemności.

W **Preferencje → Wygląd**, wybierz **Zachowaj tę skórkę**, aby zapisać podgląd, lub **Zakończ podgląd**, aby powrócić do zapisanej skórki. Wybieranie dowolnej skórki również zapisuje ten wybór i kończy podgląd. Te akcje usuwają tylko parametr skóry z bieżącego adresu URL, bez odświeżania edytora.

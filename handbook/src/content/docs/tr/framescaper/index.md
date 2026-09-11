---
title: "Framescaper"
description: "Video düzenleyin, kompozit görüntü oluşturun ve yerel öncelikli bir video projesini teslim edin."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"6193de9a731d010659be03c1372890bf230bb54161c79a2aa1e3ffe4a63c51bd","targetLocale":"tr"} -->

Framescaper, ortak düzenleyiciye odaklanan video odaklı görünümdür. Video önizleme, kaynak izleme, resim efektleri, kompozisyon, iç içe geçmiş diziler ve çoklu kamera işini vurgular.

Soundscaper ve Framescaper, birbirlerinin proje dosyalarını açar: `.sscape`, `.fscape` ve eski `.scape`, her ikisinde de çalışır. Ayrıntılı ses üretimi için Soundscaper'ı kullanın ve ardından projeyi Framescaper'a geri verin.

## Nerede ne var

Framescaper, resme sahiptir: video içeri aktarma, Kaynak İzleyici ve Video Önizleme, resim efektleri, geometri ve kompozisyon, iç içe geçmiş diziler, çoklu kamera işi ve video teslimatı. Bağlı resim ve ses şeritleri burada ayrılana kadar senkronize kalır.

Soundscaper, sese sahiptir: ses kaydı, efektler ve analiz, karıştırma ve ses teslimatı. Framescaper farklı bir yakalama iş akışı kullanır ve Soundscaper'ın ses kaydı araç setini göstermez, bu nedenle Soundscaper'da kaydedin ve projeyi geri getirin. Adım adım [kılavuzlar](/guides/), Soundscaper için yazılmıştır ve doğrulanmıştır ve bir video projesinin ses tarafını da kapsar.

## Önerilen yol
1. [İlk Framescaper projesini oluşturun](/framescaper/first-project/).
2. [Video'yu hazırlayın ve dışa aktarın](/framescaper/video-export/).
3. [Proje dosyası ve yedekleme davranışını](/projects-and-data/project-files/) gözden geçirin.

Tarayıcı düzenleyicisini [soundscaper.org/framescaper/en](https://soundscaper.org/framescaper/en/) adresinden açın.

---
title: "Framescaper"
description: "Video düzenleyin, kompozit görüntü oluşturun ve yerel öncelikli bir video projesini teslim edin."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"fe5df8f699907289847a5d9022c094e32168b502a532ebdf7708436a99db38b7","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fe5df8f699907289847a5d9022c094e32168b502a532ebdf7708436a99db38b7","targetLocale":"tr"} -->

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

Masaüstü yardımı için [yerel işleme, modeller ve eklentiler](/help/local-processing/) konusuna bakın.

---
title: "İthalat ve ihracat"
description: "Kaynak medyayı, proje dosyalarını, değişim dosyalarını ve işlenmiş teslimatları ayırt edin."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"tr"} -->

Soundscaper, farklı görevler için farklı dosya türleri kullanır.

## Kaynak medya

Ses, video ve etiketler için **Dosya → İçeri Aktar**'ı kullanın. Mevcut düzenleyici ipucu,
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF ve WebM listeler; video içe aktarma yolu ek video
kaplarını destekler. Kullanılabilirlik, etkin ürüne ve çalışma zamanına bağlı olabilir.

Medya içe aktarma, projeye ait bir kaynak ekler. Orijinal dosyanın düzenlenebilir proje belgeniz olmadığını unutmayın.

Sıkıştırılmış ses dışa aktarımları ve tarayıcı içe aktarımları, önce ulaşılan sınır geçerli olmak üzere, en fazla bir saat veya 1 GB (1,000,000,000 dosya baytı) destekler. Masaüstünde dosya seçiminin ve sıkıştırılmış ses içe aktarımının güvenli tamsayı aralığının altında sabit dosya boyutu ya da süre sınırı yoktur. Uzun işler verileri parçalar halinde okur, kodlar ve kaydeder; büyük tarayıcı dışa aktarımları origin-private file storage ve yeterli boş alan gerektirir. Büyük içe aktarımlar, çözülen ses için yeterli yerel depolama alanı gerektirir. Biçim yapısı, kod çözücü desteği ve kullanılabilir depolama da içe aktarmayı sınırlayabilir.

Tarayıcı katmanı MP3, MP2, FLAC, WavPack, Opus ve Ogg Vorbis biçimlerini kapsar. AAC/M4A desteği tarayıcı codec bileşenine bağlıdır. Masaüstü akışlı dışa aktarma, birlikte sunulan altı biçimi, 24 bit kayıpsız FLAC'i ve float32 kayıpsız WavPack'i kapsar. Masaüstü içe aktarımları kod çözücü kullanılabilirliğine bağlıdır; büyük MP2 kaynaklarında paket kod çözücü, küçük MP2 kaynaklarında yardımcı araç uyumluluk katmanı kullanılır.

Etkin bir iş, **Görünüm → Durum çubuğu** gizli olsa bile ilerleme çubuğu gösterir. Bir içe aktarmayı veya ses dışa aktarmayı durdurmak için çubuğun yanındaki **İptal**'i seçin.

## Düzenlenebilir proje dosyaları

- Scape (Soundscaper'dan `.sscape`, Framescaper'dan `.fscape` ve her ikisi de açılabilir), Soundscaper ve Framescaper tarafından paylaşılan taşınabilir, tam sadakatli proje formatıdır.
- AUP3 ve AUP4, Audacity ile ses alışverişi sağlar. Audacity 3.7.9 proje profili için AUP3'ü, güncel alışveriş profili için AUP4'ü seçin. İkisi de karma medyalı bir Soundscaper projesinin tam yedeği değildir; dışa aktarımdan sonra uyumluluk raporunu inceleyin.
- Masaüstü sürümü, referans verilen ses dosyalarından yerel proje oluşturmak için Adobe Audition SESX (`.sesx`) oturumlarını açabilir. Özgün oturumu ve medyayı saklayın; SESX dışa aktarımı kullanılamaz.

Her seçeneğin sonuçlarını [Proje dosyaları](/projects-and-data/project-files/)'nda görün.

## Oluşturulan teslimatlar

Ses dışa aktarmaları, dinlemek, yayınlamak veya daha fazla işlem için tasarlanmış dosyalar oluşturur. Video dışa aktarmaları MP4 veya WebM teslimatları oluşturur. Oluşturulan bir dosya, düzenlenebilir zaman çizelgesi, yönlendirme, efektler veya proje geçmişini tutmaz.

Oluşturulan format ve ürün yetenek tabloları için [referans bölümüne](/reference/) danışın.

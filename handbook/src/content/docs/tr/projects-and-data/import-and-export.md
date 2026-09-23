---
title: "İthalat ve ihracat"
description: "Kaynak medyayı, proje dosyalarını, değişim dosyalarını ve işlenmiş teslimatları ayırt edin."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"tr"} -->

Soundscaper, farklı görevler için farklı dosya türleri kullanır.

## Kaynak medya

Ses, video ve etiketler için **Dosya → İçeri Aktar**'ı kullanın. Mevcut düzenleyici ipucu,
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF ve WebM listeler; video içe aktarma yolu ek video
kaplarını destekler. Kullanılabilirlik, etkin ürüne ve çalışma zamanına bağlı olabilir.

Medya içe aktarma, projeye ait bir kaynak ekler. Orijinal dosyanın düzenlenebilir proje belgeniz olmadığını unutmayın.

Sıkıştırılmış ses içe aktarımları ve dışa aktarımları, önce ulaşılan sınır geçerli olmak üzere, en fazla bir saat veya 1 GB (1,000,000,000 dosya baytı) destekler. Bir saatlik 48 kHz stereo dosyası, dosya sınırının altındaysa desteklenir. Uzun işler verileri parçalara bölerek okur, kodlar ve kaydeder; büyük tarayıcı dışa aktarımları origin-private file storage ve yeterli boş alan gerektirir. Büyük içe aktarımlar, çözülen ses için kalıcı yerel depolama gerektirir. PCM biçimlerinin ayrı sınırları değişmez.

Tarayıcı katmanı MP3, MP2, FLAC, WavPack, Opus ve Ogg Vorbis biçimlerini kapsar. Tarayıcıdaki AAC/M4A desteği, tarayıcı kodeğine bağlıdır. Masaüstünde akışlı dışa aktarma, birlikte sunulan altı biçimi; 24 bit FLAC ile kayıpsız float32 WavPack'i kapsar. Masaüstü içe aktarımları yerel kod çözücü kullanılabilirliğine bağlıdır; MP2, daha küçük yardımcı araç uyumluluk katmanını kullanır. Masaüstü AAC ve uyumluluk sağlayıcılarının ayrı sınırları vardır.

Etkin bir iş, **Görünüm → Durum çubuğu** gizli olsa bile ilerleme çubuğu gösterir. Bir içe aktarmayı veya ses dışa aktarmayı durdurmak için çubuğun yanındaki **İptal**'i seçin.

## Düzenlenebilir proje dosyaları

- Scape (Soundscaper'dan `.sscape`, Framescaper'dan `.fscape` ve her ikisi de açılabilir), Soundscaper ve Framescaper tarafından paylaşılan taşınabilir, tam sadakatli proje formatıdır.
- AUP4, Audacity ile yalnızca ses değişimi yapar. Karışık medya Soundscaper projesinin tam bir yedeklemesi değildir.

Her seçeneğin sonuçlarını [Proje dosyaları](/projects-and-data/project-files/)'nda görün.

## Oluşturulan teslimatlar

Ses dışa aktarmaları, dinlemek, yayınlamak veya daha fazla işlem için tasarlanmış dosyalar oluşturur. Video dışa aktarmaları MP4 veya WebM teslimatları oluşturur. Oluşturulan bir dosya, düzenlenebilir zaman çizelgesi, yönlendirme, efektler veya proje geçmişini tutmaz.

Oluşturulan format ve ürün yetenek tabloları için [referans bölümüne](/reference/) danışın.

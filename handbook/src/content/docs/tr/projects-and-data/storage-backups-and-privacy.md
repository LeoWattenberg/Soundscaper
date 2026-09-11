---
title: "Depolama, yedeklemeler ve gizlilik"
description: "Yerel-önceli depolamayı anlayın ve projeleri tarayıcı veya cihaz kaybından koruyun."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"tr"} -->

## Yerel-öncelikli olmanın anlamı

Projeler, kayıtlar ve içe aktarılan medya, cihazınızda işlenir ve depolanır. Düzenleyici, bir hesap gerektirmez veya projeleri bir Soundscaper hizmetine senkronize etmez.

Web'de, ses ve medya, mevcut olduğunda tarayıcının köken-özel dosya sistemini, IndexedDB yedekleri ile kullanır. Soundscaper, kalıcı depolama talep eder, ancak tarayıcı bunu vermeye karar verir.

## Bir projeyi kaldırabilecek şeyler

- Site verilerini temizlemek, tarayıcının yerel proje kütüphanesini kaldırır.
- Özel veya kısıtlı tarayıcı bağlamları, geçici belleğe geri dönebilir.
- Tarayıcı kota ve tahliye politikaları otoriter kalır.
- Masaüstü uygulama verilerini el ile kaldırmak, yerel kütüphanesini kaldırır.
- Bir cihaz veya depolama hatası, o cihazdaki tüm yerel kopyaları kaldırabilir.

Paketlenmiş bir masaüstü sürümünün kaldırılması, kütüphanesini korumaya tasarlanmıştır, ancak bu bir yedekleme stratejisi değildir.

## Yedekleme rutini

Kullanışlı kilometre taşlarında ve depolama alanını temizlemeden veya geçirmeden önce:

1. Yerel kaydetmenin tamamlanmasını bekleyin.
2. Bir Scape proje dosyası (`.sscape` veya `.fscape`) dışa aktarın.
3. İşlenmiş bir teslimat dışa aktarın ve oynatın.
4. Her ikisini de düzenleyicinin yerel verilerinin dışındaki depolama alanına kopyalayın.

Audacity değişimi önemli olduğunda AUP4'ü de kullanın, Scape proje kopyasının yerine değil.

## Dokümantasyon sitesi gizliliği

Bu el kitabı, statik dosyalar olarak sunulur ve tarayıcı-yerel arama kullanır. V1 sitesi, bir analiz hizmeti veya AI/arama arka ucu eklemez.

Tam [Soundscaper ve Framescaper gizlilik politikası](https://soundscaper.org/privacy/en/), aynı zamanda uygulama teslimatı, cihaz izinleri, isteğe bağlı indirmeler, masaüstü güncelleme kontrolleri ve Framescaper Web VCR bağlantıları kapsar.

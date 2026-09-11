---
title: "Web veya masaüstü"
description: "Tarayıcı ve paketlenmiş masaüstü sürümlerinin projeleri nasıl depoladığı ve dosyalara nasıl eriştiği hakkında bilgi edinin."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"tr"} -->

Her iki sürüm projeleri yerel olarak işler. Depolama ve dosya erişimleri farklıdır.

## Web editörü

Tarayıcı sürümü, projeleri, kayıtları ve içe aktarılan medyaları köken-özel tarayıcı depolama alanında saklar. Bir projeyi Soundscaper hesabına yüklemez ve hesap gerektirmez.

Tarayıcı sürümünü, bir uygulamayı yüklemeden hemen erişmek istediğinizde kullanın. Tarayıcı depolama alanının tarayıcı kota ve tahliye kurallarına tabi olduğunu unutmayın. Site verilerini temizlemek, yerel proje kütüphanesini kaldırır.

## Masaüstü önizlemesi

Paketlenmiş masaüstü önizlemeleri, masaüstü uygulaması içinde otomatik kaydedilen yerel bir kütüphane saklar. Düzenleyici çalışma zamanını ve çevrimdışı düzenleme için yayınlanan çevirileri birleştirir.

Masaüstü paketleri imzalanmamıştır. macOS, Electron ve yerel ikili dosyaları çalıştırmak için yükleyicinin ihtiyaç duyduğu kimliksiz reklam hocası kod mühürünü uygular; bu mühür, yayıncı veya güven iddiasında bulunmaz. Bu nedenle, Windows SmartScreen veya macOS Gatekeeper, önizleme ve kararlı paketlerde bilinmeyen bir geliştirici uyarısı gösterebilir.

Bir `.aup4` dosyası açmak, masaüstü kütüphanesine bağımsız bir proje aktarır. Sonraki düzenlemeler, açtığınız dosyayı yeniden yazmaz. **Kaydet** kütüphane kopyasını günceller; **Farklı Kaydet** yeni bir Audacity değişim dosyası oluşturur.

## Telefonlar ve tabletler

Web editörü, her ekranda masaüstü düzenini korur, ancak 900 pikselden daha dar (bir telefon veya dikey olarak tutulan bir tablet) olduğunda, zaman çizelgesine yer açmak için kromu çekmecelere katlar:

- Sol üstteki **Menü** düğmesi, tam uygulama menüsü, proje sekmeleri, eylem çubuğu ve araç çubuğunu içeren bir çekmece açar. Oynat, durdur, kaydet ve arama çubuğu içinde kalır. Bir komut seçmek çekmeceyi kapatır.
- İz başlıkları, zaman çizelgesinin sol üst köşesindeki **İz başlıkları** tutamaçından veya **Görünüm › İz başlıkları** üzerinden izlerin üzerine kayar. İzlerin üzerine tıklamak veya Escape tuşuna basmak onları tekrar kaldırır.
- Dar ekranlarda, editörün üzerindeki tanıtım varsayılan olarak daraltılır; **Tanıtımı Göster** onu geri getirir.

**Düzenle › Tercihler › Görünüm › Düzen**, Otomatik, Kompakt ve Masaüstü arasında geçiş yapar, böylece masaüstünde küçük bir pencere masaüstü kromunu korur ve geniş bir tablet çekmeceleri tercih edebilir.

## Projeler otomatik olarak taşınmaz

Tarayıcı ve masaüstü kütüphaneleri ayrıdır. Bir projeyi kasıtlı olarak taşıyın:

- Bir Scape proje dosyası kullanın - `.sscape` Soundscaper'dan, `.fscape` Framescaper'dan - tam proje için.
- Ses değişimi için Audacity ile AUP4 kullanın.
- İşlenmiş ses veya video için dayanıklı bir oynatma kopyası olarak dışa aktarın.

Tarayıcı site verilerini veya masaüstü uygulama verilerini silmeden önce [Proje dosyaları](/projects-and-data/project-files/)'na bakın.

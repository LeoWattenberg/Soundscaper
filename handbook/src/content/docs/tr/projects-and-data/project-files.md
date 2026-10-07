---
title: "Proje dosyaları"
description: "Yerel kütüphane, Scape dosyaları, Audacity alışverişi, SESX içe aktarımı ve işlenmiş yedekler arasında seçim yapın."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"tr"} -->

## Yerel proje kütüphanesi

Editör, çalışma projelerini yerel kütüphanesine kaydeder. Bir tarayıcıda bu, köken-özel depolamadır; masaüstü sürümünde ise uygulama verileridir. Bu, kullanışlı bir çalışma kopyasıdır, saklamanız gereken tek kopya değildir.

## Scape proje dosyaları

Masaüstünde içe aktarılan ses ve video, varsayılan olarak özgün dosyalarına referans olarak kalır. Projeyi yeniden açarken bu dosyaları özgün konumlarında tutun. Yerel kütüphane düzenleme önbelleklerini de saklar. Kayıtlar ile oluşturulan veya işlenen medya, değişmemiş harici bir asılları olmadığı için projeye eklenir.

Referans verilen medyayı proje dosyasına paketlemek için **Dosya → Proje yönetimi → Medyayı birleştir**'i seçin. Birleştirme projeyi hemen kaydeder; kaydetme iletişim kutusunda bir hedef seçin. Kaydedildikten sonra birleştirilmiş kopya, özgün medya dosyaları olmadan taşınabilir veya paylaşılabilir. Bir medya birleştirilemiyorsa ya da kayıt başarısız olursa editör sorunu bildirir.

Tarayıcı dışa aktarımları medyayı otomatik olarak paketler. Harici referansları olan masaüstü projesini tarayıcıda açmadan önce masaüstünde birleştirin.


Düzenleme projesini kaydetmek için **Dosya → Proje dosyasını dışa aktar**'ı kullanın. Her ürün kendi son ekini yazar: Soundscaper, `.sscape` kaydeder ve Framescaper, `.fscape` kaydeder, menü girişi hangi ürünün uygulandığını belirtir. Her ikisinin arkasında da aynı biçim vardır, bu nedenle karma medya düzenleme durumunu korumak gerektiğinde uygun seçimdir.

Herhangi bir ürün, her iki son ekli dosya da açabilir. `.sscape`, `.fscape`, ayrılmış `.liscape` ve ürünlerin kendi son eklerine sahip olmadığı daha eski `.scape` dosyaları her yerde açılır ve farklı bir üründen kaydedilen bir dosya sadece yeniden adlandırılır - örneğin, Framescaper'dan kaydedilen bir `Mix.sscape` dosyası, `Mix.fscape` olur. Proje, isimle birlikte hiçbir şekilde değişmez.

Bir Scape kopyasını içe aktarma veya açma, yerel kütüphanede aynı Kimliğe sahip mevcut bir proje ile karşılaşabilir. Her iki sürümün de yerel kütüphanede kalması gerekiyorsa sunulan kopyalama iş akışını kullanın.

## Audacity AUP3 ve AUP4

Audacity proje dışa aktarımı **Dosya → Diğer dışa aktarma** altında bulunur. Audacity 3.7.9 proje profili için **AUP3 Dışa Aktar**'ı, güncel Audacity alışveriş profili için **AUP4 Dışa Aktar**'ı seçin. Her dışa aktarma; dönüşümleri, kullanılamayan efektleri ve atlanan Soundscaper'a özgü durumu açıklayan bir uyumluluk raporu oluşturur.

Her iki biçim de yalnızca ses içerir. Video atılır; tarayıcı tercihleri, geri alma geçmişi, mikser yönlendirmesi ve tarayıcı proje kütüphanesi aktarılmaz. Bunlardan hiçbirini Soundscaper veya Framescaper projesinin tek yedeği olarak kullanmayın.

## Adobe Audition SESX

Masaüstü sürümünde Adobe Audition `.sesx` oturumunu içe aktarmak için **Dosya → Aç**'ı kullanın. Referans verilen ses dosyalarını oturum klasörünün altındaki göreli klasör yapısında tutun veya sorulduğunda bir medya klasörü seçin. İçe aktarma, desteklenen ses parçaları, klipler, konumlandırma, kırpmalar, basit solmalar ve statik mikser ayarlarıyla yeni bir yerel proje oluşturur.

SESX içe aktarımı tek yönlüdür. Audition efektleri, otomasyon, yönlendirme, video, işaretçiler, döngüler, uzatma, bağlı çapraz solmalar ve tam solma eğrileri aktarılmaz. İçe aktarmadan sonra eksik medyayı ve atlanan diğer içeriği incelemek için **Dosya → Teslimat raporu**'nu açın. Audition'da çalışmaya devam etmek için özgün SESX dosyasını ve medyayı saklayın.

## İşlenmiş yedek

Önemli işler için her ikisini de saklayın:

1. Gelecekteki düzenleme için bir Scape proje kopyası (`.sscape` veya `.fscape`).
2. Editör olmadan oynatılabilen işlenmiş bir ses veya video dosyası.

Bu dosyaları tarayıcı veya uygulama veri dizini dışında saklayın.

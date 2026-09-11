---
title: "Proje dosyaları"
description: "Yerel kütüphane, Scape proje dosyaları, AUP4 ve işlenmiş yedekler arasında seçim yapın."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"tr"} -->

## Yerel proje kütüphanesi

Editör, çalışma projelerini yerel kütüphanesine kaydeder. Bir tarayıcıda bu, köken-özel depolamadır; masaüstü sürümünde ise uygulama verileridir. Bu, kullanışlı bir çalışma kopyasıdır, saklamanız gereken tek kopya değildir.

## Scape proje dosyaları

Kayıpsız taşınabilir bir proje için **Dosya → Proje dosyasını dışa aktar**'ı kullanın. Her ürün kendi son ekini yazar: Soundscaper, `.sscape` kaydeder ve Framescaper, `.fscape` kaydeder, menü girişi hangi ürünün uygulandığını belirtir. Her ikisinin arkasında da aynı biçim vardır, bu nedenle karma medya düzenleme durumunu korumak gerektiğinde uygun seçimdir.

Herhangi bir ürün, her iki son ekli dosya da açabilir. `.sscape`, `.fscape`, ayrılmış `.liscape` ve ürünlerin kendi son eklerine sahip olmadığı daha eski `.scape` dosyaları her yerde açılır ve farklı bir üründen kaydedilen bir dosya sadece yeniden adlandırılır - örneğin, Framescaper'dan kaydedilen bir `Mix.sscape` dosyası, `Mix.fscape` olur. Proje, isimle birlikte hiçbir şekilde değişmez.

Bir Scape kopyasını içe aktarma veya açma, yerel kütüphanede aynı Kimliğe sahip mevcut bir proje ile karşılaşabilir. Her iki sürümün de yerel kütüphanede kalması gerekiyorsa sunulan kopyalama iş akışını kullanın.

## AUP4

AUP4, Audacity ile uyumlu ses değişimi için vardır. Dışa aktarma, dönüşümler, kullanılamayan etkiler ve atılan Soundscaper-sadece durum hakkında bir uyumluluk raporu üretir.

AUP4 sadece seslidir. Video atılır ve tarayıcı tercihleri, geri alma geçmişi, mikser yönlendirme ve tarayıcının proje kütüphanesi aktarılmaz. AUP4'ü Soundscaper veya Framescaper projesinin tek yedeklemesi olarak kullanmayın.

## İşlenmiş yedek

Önemli işler için her ikisini de saklayın:

1. Gelecekteki düzenleme için bir Scape proje kopyası (`.sscape` veya `.fscape`).
2. Editör olmadan oynatılabilen işlenmiş bir ses veya video dosyası.

Bu dosyaları tarayıcı veya uygulama veri dizini dışında saklayın.

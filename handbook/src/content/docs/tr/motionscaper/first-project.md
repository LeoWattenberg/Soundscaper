---
title: "İlk Hareket Projeniz"
description: "Bir kompozisyon oluşturun, katmanı canlandırın ve kayıtlı projeyi dışa aktarın."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"tr"} -->

## Oluşturma ve katman ekleme {#create-and-add-a-layer}

1. **Dosya → Yeni Kompozisyon** seçeneğini kullanıp başlık, boyutlar, kare hızı
   ve kare cinsinden süre girin.
2. **Katman → Yeni metin** veya **Katman → Yeni düz renk** seçeneğini kullanın. Projede birden fazla
   kompozisyon varsa hedef kompozisyonu seçin.
3. Mevcut bir metin katmanını veya şeklin dolgu ve konturlarını düzenlemek için
   **Katman → Metin ve Görünüm** seçeneğini açın. Buradan içe aktarılan yazı tipleri projeyle korunur.

Görüntü, video veya ses kaynakları için **Dosya → Medya İçe Aktar** seçeneğini kullanın. Geçerli kod çözücü
veya bellek sınırlarını aşan içe aktarma açıklamayla reddedilir;
özgün kaynak dosyası değiştirilmez.

## Canlandırma ve önizleme {#animate-and-preview}

Katman özelliğini seçip kesin kare konumlarına anahtarlar eklemek için
**Katman → Özellikler ve Anahtar Kareler** seçeneğini açın. Eğri denetimleri ara değerlemeyi değiştirir;
uzamsal düzenleme konum yollarını değiştirir. **Görünüm → Zaman Çizelgesi** katman zamanlaması,
sıralama, gruplama ve çalışma alanı denetimlerini açar.

Statik bir 2D katmanı seçip taşımak için **Görünüm → Kompozisyon Tuvali** seçeneğini açın.
Kare katmanı ölçekler, daire tanımlı bağlantı noktasının çevresinde döndürür. Tamamlanan her
sürükleme tek bir geri alma adımıdır; Escape sürüklemeyi iptal eder. Animasyonlu ve
ifade güdümlü dönüşümler Özellikler ve Anahtar Kareler'de kalır.

Kompozisyon içinde gezinmek veya oynatmak için **Görünüm → Kompozisyon Önizlemesi** seçeneğini açın. Önizleme,
korunan kaynak medyayı kullanır. Desteklenmeyen veya geçersiz sahne ayarları yedek görüntü
yerine hata üretir. Etkin işleme kaynaklarını serbest bırakmak için
önizlemeyi kapatın.

## Taşınabilir kopya kaydetme {#save-a-portable-copy}

Geçerli revizyonu yayımlamak için **Dosya → Kaydet**, ardından `.mscape` arşivi indirmek için
**Dosya → Kopyasını Kaydet** seçeneğini kullanın. Arşiv, projeyi ve yeniden açılması için gereken
özgün medyayı içerir. Başka cihazda veya yeni bir tarayıcı kitaplığında
**Dosya → Aç** ile açın.

## İşleme {#render}

**Dosya → İşle** seçeneğini kullanın. Kompozisyonu, çıktı biçimini ve
kare aralığını seçin. Bitiş karesi hariçtir: 0–29 kareleri için aralık
`0` ile `30` olur. Kesirli çalışma alanı, içerdiği tam sayı örnek zamanlarını seçer;
çıktı örneği olmayan alan işleme öncesinde değiştirilmelidir.

Alfa için **Saydam PNG dizisi (.tar)** kullanın. Normal PNG görüntülerini ve
zamanlama meta verilerini almak için TAR arşivini çıkarın. MP4 ve WebM, pencerede seçilen
arka plan rengini kullanır. İşleme, gönderilen revizyonu sabitler; böylece sonraki düzenlemeler
zaten süren çıktıyı değiştirmez. İşleme penceresini kapatmak
işi çalışır bırakır. **Dosya → İşleme Kuyruğu**, ilerlemeyi, iptali,
gönderilen revizyonu yeniden denemeyi ve tamamlanan indirmeleri gösterir. Düzenleyiciyi kapatmak
tamamlanmamış işleri iptal eder.

[Motionscaper el kitabına](/motionscaper/) dönün.

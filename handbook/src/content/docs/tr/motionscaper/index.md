---
title: "Motionscaper"
description: "Animasyonlu kompozisyonlar oluşturun ve düzenlenebilir hareket projelerini yerel olarak koruyun."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"tr"} -->

Motionscaper, Scaper ailesinin hareketli grafik düzenleyicisidir. Bir proje
kompozisyonlar, katmanlar, animasyon ve korunan medya içerir. Proje dosyasının
uzantısı `.mscape` şeklindedir.

Bu bir geliştirme sürümüdür. Önemli kaynak malzemenin bir kopyasıyla başlayın
ve dışa aktarılan proje arşivlerini çalışma kitaplığınızın yanında tutun.

## Kompozisyon başlatın {#start-a-composition}

**Dosya → Yeni Kompozisyon** seçeneğini kullanın. **Katman** menüsü metin, şekil,
animasyon, birleştirme, izleme, ifade ve 3D sahne araçlarını açar. **Görünüm →
Kompozisyon Önizlemesi** oynatmayı açar; yeni düzenleme yüzeyleri menüden
seçtiğinizde görünür.

Statik 2D dönüşümlü katmanları seçmek, taşımak, ölçeklemek veya döndürmek için
**Görünüm → Kompozisyon Tuvali** seçeneğini kullanın. Animasyonlu dönüşümler özellik
ve zaman çizelgesi araçlarıyla düzenlenebilir kalır.

**Görünüm → Zaman Çizelgesi** içinde mevcut katmanları seçerek yeniden adlandırın, etkinleştirin,
devre dışı bırakın veya kaldırın. Yeniden adlandırma özellik referanslarını ve animasyonu korur. Katman
kaldırma özgün medyasını korur; bağımlı katmanlarını dahil edin veya önce onların
bağlantılarını ayırın. **Geri al**, kaldırılan katmanları geri yükler. Seçili video katmanı,
korunan kaynağı ses içeriyorsa bir ses onay kutusu da sunar.

Kompozisyon oluşturmak, canlandırmak, kaydetmek ve işlemek için
[ilk hareket projenizi](/motionscaper/first-project/) izleyin.

## Kaydetme ve teslim {#save-and-deliver}

**Dosya → Kaydet** kayıtlı bir revizyon yayımlar. **Kopyasını Kaydet**, yeni kayıtlı
revizyon yayımlamadan geçerli anlık görüntüyü `.mscape` arşivi olarak dışa aktarır.
İçe aktarılan özgün medya ve yazı tipleri arşivle birlikte taşınır. **Proje
Kitaplığı** bu cihazda korunan projeleri açar.

**Dosya → İşle**, TAR arşivinde saydam PNG kareler,
opak MP4 veya WebM video ve masaüstü kodlayıcısı kullanılabiliyorsa ProRes 4444 sunar.
PNG dizileri ses içermez. Tarayıcı videosu, kodlayıcısı istenen biçimi destekliyorsa
tanımlanmış sesi korur. Yerel ProRes, etkili renk ve alfa
hassasiyetini işleme penceresinde bildirir. **Dosya → İşleme Kuyruğu**, pencere kapatma
ve proje değişiklikleri boyunca işleri kullanılabilir tutar. En fazla sekiz
iş ve 128 MiB tarayıcı indirmesi tutar; her indirme en fazla 64 MiB kabul eder.
Daha büyük çıktılar için akışla yazılan dosya hedefi seçin ve tutulan indirmeleri
serbest bırakmak için biten işleri kaldırın. Yerel çıktı temizliği başarısız olursa bu kuyrukta
**Çıktı temizliğini yeniden dene** seçeneğini kullanın. İş, temizlik tamamlanana kadar hedefini tutar;
ardından işi kaldırabilir veya gönderilmiş revizyonu yeni bir hedefle yeniden deneyebilirsiniz.

## Framescaper'a bağlama {#link-to-framescaper}

Bağlı kompozisyonlar, ayrı Framescaper 1.1 geliştirme hattını gerektirir.
Oradaki **Dosya → Bağlı kompozisyonlar** penceresinde eşleştirme URL'si oluşturun. Bunu
Motionscaper'ın **Dosya → Kompozisyonu Framescaper'a Gönder** penceresine yapıştırın, bağlanın
ve düzenleyicileri ve köprü pencerelerini açık tutun. Sonraki **Kaydet** işlemleri
yeni revizyonları otomatik gönderir; **Kopyasını Kaydet** göndermez.

Framescaper, çevrimdışı kullanım için kabul ettiği her revizyonu ve onun tam medya
kümesini korur. Geri al, güncellemeleri yeniden başlatana kadar önceki revizyonu sabitler.
Çıktı boyutu, zamanlama veya ses ızgarası değişiklikleri açık bir Uyum incelemesi gerektirir.
Masaüstü alıcısı bunun yerine seçtiğiniz kayıtlı `.mscape` dosyasını izleyebilir.

## Masaüstü güncellemelerini denetleme {#check-desktop-updates}

Masaüstü uygulamasında **Yardım → Güncellemeleri Denetle** seçeneğini kullanın. Bu elle denetim,
projenin GitHub deposunda uyumlu Motionscaper sürümlerini arar. Önizleme
sürümleri daha yeni önizleme sürümlerini; kararlı sürümler kararlı
sürümleri alabilir. Doğrulanmış sürüm sayfasını açmak için **Sürümü görüntüle** seçeneğini kullanın. Denetim
bir güncelleme indirmez veya kurmaz. Tarayıcı derlemeleri bu menü komutunu içermez.

## After Effects alışverişi {#after-effects-exchange}

**Dosya → After Effects Köprüsü** okunabilir betikler sağlar ve desteklenen alışveriş
verilerini içe aktarmadan önce inceler. `.aep` ve `.aepx` dosyaları kurulu bir
After Effects kopyası ve köprü betikleri aracılığıyla açılır. Geliştirme aşamasındaki köprü,
kurulu After Effects'e karşı henüz doğrulanmamıştır. Raporunu inceleyin;
desteklenmeyen sahne amacı ve özgün medya proje korumasında tutulur.

Pencere; aritmetik, kompozisyon zamanı, ifade öncesi değer ve standart Math işlevlerini
kullanan desteklenen skaler opaklık ifadeleri için ayrı içe ve dışa aktarma
seçenekleri sunar. İki seçenek de başlangıçta kapalıdır. Bir seçenek değiştirdikten sonra yeni
raporu inceleyin; diğer ifade biçimleri açıkça örnekleme
veya işleme gerektirir. Özgün ifade kaynağı korunan alışverişte
veya `original.mscape` arşivinde kalır.

İşleyici; 2.5D katmanlar, kameralar, ışıklar, obtüratör örneklemesi ve alan derinliğiyle
SDR renk ve alfayı destekler. HDR, tam 3D ağlar,
gelişmiş AI maskeleme veya rastgele After Effects eklentileriyle uyumluluk iddiasında bulunmaz.

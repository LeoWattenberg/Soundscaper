---
title: "Düzenle, karıştır ve dışa aktar"
description: "Klipleri düzenle, parçaları dengele, efektler uygula ve teslim dosyası oluştur."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"d4b354ffb5d6a4d35fcb20ac6bb1e0191746badd98ca8f5b476a286e068a3c26","targetLocale":"tr"} -->

## Klipleri Düzenle

Bir düzenleme komutu seçmeden önce klipleri veya bir zaman aralığı seçin. Bölme, oynatma başlığında bir düzenleme sınırı oluşturur. Boşluk koruyan ve kıvrım çeşitleri, daha sonraki materyalin yerinde kalıp kalmayacağını veya kaldırılan bölgeyi kapatmak için hareket edip etmeyeceğini belirler.

Daha büyük projeleri düzenlemek için parça klasörleri, klip grupları ve Proje Çöp Kutusu'nu kullanın.

### Klip soluklarını ayarla {#clip-fades}

Bir ses klipi seçin ve küçük üçgen tutamacın klibin dalga formunun üst kısmına, klip başlığının hemen altına görüneceğini açın.
Sol üçgeni içe sürükleyerek soluk açın veya sağ üçgeni içe sürükleyerek soluk kapatın. Dalga formu sürüklerken değişir ve soluk eğrisi üzerindeki alan daha karanlık hale gelir. Üçgenler soluk sınırlarını takip eder; birini köşesine geri sürükleyerek o soluk kaldırılır. Sürüklediğiniz klip değişir, hatta birden fazla klip seçilmiş olsa bile.

Klipi seçmeyi bıraktığınızda tutamaklar kaybolur, ancak soluklu dalga formu ve gölgelendirme kalır. Bu soluklar orijinal sesin korunmasını sağlar ve projeyi kaydedip yeniden açtıktan sonra bile ayarlanabilir. Soluğu kaydetmek için bırakın veya sürüklerken **Escape**'e basın işlemi iptal edin. **Geri Al** bir sürüklemeyi tamamen tersine çevirir.
Çalma ve dışa aktarma, kaydedilmiş soluk ayarlarını kullanır.

Seçili ve odaklı bir klip ile **Tab**'a basın, soluk tutamaklarına ulaşın. Ok tuşları süreyi 10 milisaniye veya **Shift** ile 100 milisaniye ayarlar. **Home** soluğu kaldırır; **Son** onu kliptin tamamına uzatır.
Sayısal giriş için **Düzenle → Ses klipleri → Klip özellikleri**'ni seçin ve **Soluk**'u kullanın.

## Karışımı Oluştur

Parça kazancı, pan, susturma ve solo kontrollerini kullanarak projeyi dengeli hale getirin. Karıştırıcı paneli, karışım odaklı bir düzenlemede aynı proje durumunu ortaya koyar. Gerçek zamanlı etkiler ayarlanabilir olmaya devam eder; yok edici veya işlenmiş işlemler, geri alma işlemi mevcut olduğu sürece projede değişiklikler oluşturur.

Sonucu incelemek için çalma ölçerini ve ses analizini kullanın. Metre hedefini, tam dışa aktarma dinlemek yerine bir yer tutucu olarak kullanmaktan kaçının.

### Sibilansı Azalt {#reduce-sibilance}

**Etki → Gürültü kaldırma ve onarım → De-esser**'i seçin. **Frekans**'ı sesin sert kısmına yakın ayarlayın, ardından **Eşik**'i sibilantları yumuşatana kadar düşürün. **Maksimum azaltma** kesimi sınırlar; yaklaşık 6-9 dB ile başlayın. Daha kısa bir **Saldırı** ünsüzün başlangıcını yakalar, **Salınım** ise yüksek frekansların ne kadar hızlı iyileştiğini kontrol eder. Sadece üst bant azaltılır.

### Farklı frekans bantlarını sıkıştır {#multiband-compression}

**Etki → Ses seviyesi ve sıkıştırma → Çok bantlı sıkıştırıcı**'yı seçin. İki geçiş, sinyali düşük, orta ve yüksek bantlara böler. Her bant, kendi eşiği, oranını ve çıkış kazancına sahiptir. 1'lik bir oran, o bantın dinamiklerini değiştirmez. Saldırı ve salınım, üç bantın tamamına uygulanır. Geçişler, tüm oranları 1 ve bant kazançları 0 dB olduğunda orijinal sinyalin değişmeden geçtiği, 6 dB/okta eğimli, yumuşak, çakışan eğimlerle nazik bir şekilde ayarlanır.

Her iki etki de stereo dengesini korumak için kanallarını birbirine bağlar ve ayrıca parça ve ana etki raflarında da mevcuttur. Raf ayarları projeyle birlikte kaydedilir ve çalma sırasında ayarlanabilir. **Seçime uygula** etkiyi seçili ses üzerine işler ve **Geri Al**'a destek olur. Zaman çizelgesi otomasyonu bu iki etki için kullanılamaz.

## Dışa Aktar

Karışık bir teslimat için **Dosya → Ses dışa aktar**'ı veya yalnızca bir seçim dışa aktarılacaksa **Seçili sesi dışa aktar**'ı seçin. Soundscaper ayrıca saplar ve etiketleri de dışa aktarabilir.

Sıkıştırılmış formatlar FFmpeg çalışma zamanını kullanır. Kesin formatlar ve koşullu kullanılabilirlik [oluşturulan format başvurusunda](/reference/) listelenmiştir.

Kaynak materyali silmeden veya teslim etmeden önce dışa aktarılan dosyayı başka bir uygulamada oynatın.

Görüntü işi - bir dizi oluşturma, video efektleri ve MP4 veya WebM teslimatı - [Framescaper](/framescaper/)'e projeyi verin ve [video dışa aktar](/framescaper/video-export/)'a bakın.

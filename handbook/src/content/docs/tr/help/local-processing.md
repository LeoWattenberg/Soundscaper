---
title: "Yerel işleme, modeller ve eklentiler"
description: "Masaüstü düzenleyicilerde göreve göre yerel yardımı bulun, modelleri ve eklentileri yönetin."
---
<!-- docs-ai-provenance: {"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"tr"} -->

Yerel yardım, Soundscaper ve Framescaper masaüstü düzenleyicilerinde aygıtınızda
çalışır. Medyayı seçip menüden görevi belirleyin. Pencerede seçim, görev ayarları
ve görev için gereken modellerin yüklü olup olmadığı gösterilir.

Masaüstü paketleri isteğe bağlı yerel işleme motorlarını ve model ağırlıklarını içermez. Gerekli motoru ve ağırlıkları indirmek için Model Yöneticisi üzerinden bir model yükleyin, ardından görevi seçtiğiniz medyada çalıştırın. İlk yükleme ağ bağlantısı gerektirir; sonraki işlemler yerel olarak yürütülür. Desteklenen platformlar, menü girdisi ve gereksinimler için her modelin kılavuzuna bakın.

Ayrıntılar için [tek tek modellere ait kılavuzlar](/reference/local-models/).

## Görev bulma {#find-a-task}

| Menü | Görevler |
| --- | --- |
| Effect → Noise removal and repair | Enhance Dialogue, Reduce Reverb, Clean Filler & Silence |
| Effect → Source Separation | Separate Dialogue / Music / Effects |
| Analyze → Speech | Transcribe & Captions, Identify Speakers, Mark Reactions |
| Analyze → Music | Detect Beats & Tempo |
| Analyze → Video | Mark Cuts |
| Effect → Video effects | Reframe |
| Edit | Make Highlights |
| Generate | Generate Editorial Text |
| Tools → Search | Indexed Search, Index Transcript, Index Video |

Video görevleri Framescaper'a aittir. Kullanılabilir komutlar masaüstü çalışma
zamanına ve ürün özelliklerine bağlıdır. Soundscaper'ın efekt menüsünü alfabetik
sıralama seçeneği, yerel işleme efektlerini de ada göre sıralar.

İşlemeyi başlatmak için **Run locally** seçeneğini kullanın ve yerel izin
istemine yanıt verin. İşlem sırasında iptal edebilirsiniz. **Review result**
seçeneğini kullanıp istediğiniz sonuçları seçin, ardından **Apply selected**
seçeneğine basın. Kabul edilen proje düzenlemeleri geri alınabilir. Bir görevi
kapatmak, önerilerini uygulamaz.

**Tools → Advanced Local Processing**, tek tek işlem ve model seçicilerini
sunar. Gerektiğinde görev pencerelerindeki teknik ayrıntılarda temel adımlar ve
kesin ayarlar gösterilir.

## Modelleri yönetme {#manage-models}

**Tools → Model Manager**'ı açın veya bir görevin içindeki **Manage Models**
seçeneğini kullanın. Görev bağlantısı listeyi uyumlu model kimlikleriyle
sınırlar; **Show all models** bu kısıtlamayı kaldırır. Ada veya göreve göre
arama yapın ve kurulum durumuna göre filtreleyin.

Modelleri açıkça yükleyin. İlk yükleme, modelin kullandığı ve eksik olan yerel çalışma ortamını da indirir. İndirme ilerlemesi gösterilir ve indirme iptal edilebilir. Bir göreve döndüğünüzde ayarları korunur ve model kullanılabilirliği yenilenir; işleme başlamaz. Onarım, temizleme, depolamayı taşıma, lisans bildirimleri ve klasörden çevrimdışı yükleme için **Depolama ve doğrulama** bölümünü genişletin. Çevrimdışı dosyalardan yüklenen model de ilk kullanımdan önce eşleşen çalışma ortamına ihtiyaç duyar.

Her yayımlanmış modelin kullanım amacı, menü girişi, indirme boyutu,
gereksinimleri, sınırlamaları ve nightly-with-tests masaüstü paketinin yaptığı
gerçek çıkarım kontrolleri için [tek tek model kılavuzlarına](/reference/local-models/) bakın.

## Eklentileri ve aygıtları yönetme {#manage-plugins-and-devices}

**Effect → Plugin Manager**, Soundscaper'daki ses eklentilerini ve
Framescaper'daki OpenFX eklentilerini listeler. Listeyi arayın veya filtreleyin,
ardından sürüm, izin ve kurtarma denetimlerini görmek için bir eklenti seçin.
**Scanning & Settings** bölümünde keşif ayarları bulunur. İşleme devre dışı
olduğunda da yönetim kullanılabilir.

Ses eklentilerini **Effect → Audio Plugins** üzerinden kullanın. Framescaper'ın
video efektlerini ekleme/düzenleme komutları **Effect → Video effects** altında
bulunur.

Yerel ses aygıtları ve yardımcı denetimler için **Edit → Preferences → Audio
settings** bölümünü açın. Yerel medya ayarları **Media** altında bulunur;
**Effects**, Plugin Manager'a bağlantı verir ve eklenti keşfi anahtarını içerir.
Eklenti izinleri ve karantinadan kurtarma yine de açıkça başlatılmalıdır.

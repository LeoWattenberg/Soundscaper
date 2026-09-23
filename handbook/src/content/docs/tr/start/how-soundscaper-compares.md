---
title: "Soundscaper'ın karşılaştırması"
description: "Kayıt, düzenleme, karıştırma, teslim ve değişim alanlarında Soundscaper'ı Audacity 4 ve Adobe Audition ile karşılaştırın."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"tr"} -->

Soundscaper, Audacity 4'ü web üzerinde yeniden uygular ve bunun üzerine bir üretim katmanı ekler. Adobe Audition, her ikisinin de genellikle kıyaslandığı ticari son işleme aracıdır. Bu sayfa, hangisinin zaten elinizdeki işi yaptığını anlamanız için üçünün tamamını karşılaştırır.

## Bu sayfanın nasıl okunacağı

Her hücre **Evet**, **Kısmi** veya **Hayır** olarak okunur ve ardından bunu nitelendiren detay gelir.

**Kısmi**, üç farklı durumu kapsar ve not hangisinin geçerli olduğunu belirtir: yetenek mevcut ancak başka yerlere göre daha dar, mevcut ancak sizin sağlamanız gereken bir şeye bağlı veya yalnızca bir eksikliğin etrafından dolaşarak erişilebilir.

Satırlar menü komutları değil, yetenekleri açıklar. Kesin komut envanteri için bkz. [Komutlar ve kısayollar](/reference/generated/commands/), her bir ürünün neyi mümkün kıldığı için bkz.
[Ürün yetenekleri](/reference/generated/product-capabilities/).

### Bu iddiaların kaynağı

- **Soundscaper** satırları bu depodan gelir: ürün yetenek profilleri, çalışma zamanı eylem manifestosu ve dışa aktarma biçimi kayıt defteri.
  Masaüstü yerel hedef yüklemeleri, depo CI'ı veya hedef paketleme tarafından üretilir. Bir paket, yalnızca tam eşleşen sonucu evreleyip doğruladıktan sonra bunu etkinleştirir; bu satırlar, bir yüklemenin hâlâ gerekli olduğu zamanları belirtir.
- **Audacity 4** satırları, bu depoda sabitlenmiş olan `4.0.0` üst akım envanterinden gelir, `4c177d43` commit'inde. Üst akımın kaydettiği ancak devre dışı bıraktığı veya menüden yorum satırı olarak çıkardığı bir yetenek, böyle kaydedilir ve sabitlenmiş derlemede kaydı olmayan bir yetenek, kalıcı olarak yok olarak değil, o derlemede mevcut değil olarak raporlanır.
- **Audition** satırları, güncel sürüm için Adobe'ın yayımladığı belgelerden gelir. Çalışan bir derlemeyle doğrulanmamışlardır.

## Platform ve terimler

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Lisans | Evet — AGPL-3.0-only | Evet — GPL, açık kaynak | Hayır — mülkiyetçi ve kapalı |
| Maliyet | Evet — ücretsiz | Evet — ücretsiz | Hayır — Creative Cloud aboneliği |
| Tarayıcıda çalışır | Evet — Chromium, Firefox ve WebKit | Hayır — yalnızca masaüstü | Hayır — yalnızca masaüstü |
| Masaüstü derlemeleri | Evet — x64 ve ARM64'te Windows ve Linux, ARM64'te macOS | Evet — Windows, macOS, Linux | Kısmi — Windows ve macOS, Linux yok |
| Hesap olmadan çalışır | Evet — hesap mevcut değil | Evet — yalnızca audio.com için oturum açma | Hayır — oturum açılmış abonelik gerekli |
| Bulut proje depolama | Hayır — yerel öncelikli tasarım tarafından hariç tutulur | Evet — audio.com üzerinden kaydetme ve paylaşma | Kısmi — Creative Cloud dosyaları, oturumlar senkronize edilmez |
| Sistem gereksinimleri | Evet — güncel bir tarayıcının çalıştığı her yerde çalışır | Kısmi — Audacity 3'e göre önemli ölçüde artmıştır | Kısmi — profesyonel iş istasyonu sınıfı |

## Proje ve oturum modeli

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Yerel proje biçimi | Evet — `.sscape`, kayıpsız taşınabilir bir arşiv | Evet — `.aup4` | Evet — `.sesx` |
| Audacity projelerini açma | Evet — AUP4 içe ve dışa aktarma | Evet — yerel | Hayır |
| Yıkıcı olmayan klip zaman çizelgesi | Evet | Evet | Evet — çok kanallı düzenleyici |
| Özel tek dosya düzenleyici | Kısmen — örnek düzenleme zaman çizelgesinde yapılır | Kısmen — düzenlemeler zaman çizelgesinde yerinde uygulanır | Evet — dalga formu düzenleyici |
| Tek parçada mono ve stereo içerik | Evet — bir parça bunlardan birini tutar | Hayır — bir parça mono veya stereodur | Hayır — kanal biçimi parça başına sabittir |
| İçe içe geçmiş parça klasörleri | Evet — herhangi bir derinlikte, geri alınabilir, yönlendirme ile | Hayır | Kısmen — yalnızca alt karışım hatları, klasör parçaları yok |
| Proje kutusu | Evet — dosyaları düzenler ve pano olarak da işlev görür | Hayır | Kısmen — Dosyalar paneli açık dosyaları listeler |
| Otomatik kaydetme ve çökme kurtarma | Evet — otomatik kaydetme, kilitler ve kurtarma zarfları | Evet | Evet |
| İşaretçiler ve adlandırılmış bölgeler | Evet — birinci sınıf, gezinme ve akışkan davranış ile | Kısmen — etiket parçaları | Evet — işaretçiler ve aralıklar |
| Tempo ve zaman imzası haritaları | Evet — örnek hassasiyetinde çözümlenen sıralı haritalar | Kısmen — tek proje temposu ve imzası | Kısmen — tek oturum temposu |

## Kayıt

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Çok kanallı kayıt | Evet — birden fazla kaynağı aynı anda | Kısmen — aynı anda bir giriş cihazı | Evet — çoklu giriş ve çok kanallı arayüzler |
| Mikrofon ve masaüstü sesini birlikte | Evet — yerleşik | Hayır | Kısmen — işletim sistemi döngü geri besleme cihazı gerektirir |
| Zamanlanmış kayıt | Evet | Evet | Hayır |
| Sesle tetiklenen kayıt | Evet — ayarlanabilir eşik ile | Evet — ayarlanabilir eşik ile | Hayır |
| Alım öncesi geri sayım | Evet — tempo haritası farkında, bileşik ölçüyü işler | Kısmen — giriş kaydı | Kısmen — vuruş ve yuvarlamanın bir parçası olarak ön kaydırma |
| Vuruş kaydı | Evet — tek işlem, varsayılan ve yönlendirilmiş yakalama | Hayır | Evet — vuruş ve yuvarlama |
| Alımlara döngü kaydı | Evet — geçiş başına bir şerit, aynı gruba eklenir | Hayır | Kısmen — bir klipteki alımlar, listeden seçilir |
| Alım birleştirme | Evet — deneme, yükseltme, birleştirme bölgelerini düzenleme, tek geri alınabilir düzenleme olarak düzleştirme | Hayır | Hayır — birleştirme düzenleyicisi yok |
| Giriş izleme ve ölçüm | Evet | Evet | Evet |

## Zaman çizelgesi düzenleme

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ripple düzenleme varyantları | Evet — kesme ve silme işlemlerinde klip başına, iz başına ve tüm izler için | Evet — kesme ve silme işlemlerinde aynı üç varyant | Kısmi — bir seçim veya boşlukta ripple silme |
| Bölme, birleştirme ve sessizliklerde bölme | Evet | Evet | Kısmi — bölme ve kırpma, klip birleştirme yok |
| Klip grupları | Evet | Evet | Evet |
| Klip kazancı | Evet | Evet | Evet |
| Klip başına perde ve hız | Evet — ayarla, işle veya sıfırla | Evet — ayarla, işle veya sıfırla | Kısmi — esnetme düzenlenebilir kalır, perde bir efekttir |
| Tempo değişikliklerini takip etme | Evet — harita hareket ettiğinde klipler esner | Evet | Hayır |
| Vuruş duyarlı kuantizasyon ve groove | Evet — ayarlanabilir groove gücüne sahip warp haritaları | Hayır | Hayır |
| Sıfır geçişlerine yapışma | Evet | Evet | Evet |
| Örnek düzeyinde çizim | Evet | Kısmi — sabitlenmiş derlemede kayıtlı bir çizim eylemi yok | Evet — dalga formu düzenleyicide |
| Yalnızca klavye ile düzenleme | Evet — her düzenleme ilkesi için bir gezinme eylemi var | Evet — her düzenleme ilkesi için bir gezinme eylemi var | Kısmi — kapsamlı kısayollar, bazı paneller fare gerektirir |

## Spektral iş ve onarım

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Spektrogram görünümü | Evet — iz başına ayarlarla | Evet — iz başına ayarlarla | Evet — frekans ve perde görüntülemeleri |
| Frekans sınırlı seçim | Evet | Evet | Evet — çerçeve ve lasso |
| Spektral fırça | Evet | Evet | Evet — boyama fırçası ve nokta iyileştirme |
| Spektral bir bölgeyi silme veya güçlendirme | Evet — her ikisi de doğrudan eylem olarak | Evet — her ikisi de doğrudan eylem olarak | Kısmi — seçime bir etki uygulama |
| Kısa hasarları onarma | Evet — Onarım | Evet — Onarım | Evet — Otomatik İyileştirme ve Nokta İyileştirme Fırçası |
| Geniş bantlı gürültü azaltma | Evet — yakalanmış bir profille | Evet — yakalanmış bir profille | Evet — Gürültü Azaltma, Uyarlanabilir Gürültü Azaltma, DeNoise |
| Yankı giderme | Hayır | Hayır | Evet — DeReverb |
| Tıklama, uğultu ve sibilans araçları | Kısmi — yalnızca Tıklama Kaldırma | Kısmi — yalnızca Tıklama Kaldırma | Evet — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Teşhis paneli | Kısmi — analizör olarak Find Clipping | Kısmi — analizör olarak Find Clipping | Evet — sorun başına onarım ile teşhisler |

## Efektler ve eklentiler

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Yerleşik efekt paketi | Evet — 30 Audacity efekti, paketlenmiş Nyquist eklentileri ve bitcrusher gibi üst akışa eşdeğeri olmayan birinci taraf efektleri | Evet — aynı 30 efektlik yerleşik koleksiyon | Evet — çok bantlı dinamikler dahil yaklaşık elli |
| İzlere özel gerçek zamanlı efekt rafı | Evet — üst akıştan daha geniş bir gerçek zamanlı set | Evet | Evet — klip, iz ve master başına on altı slot |
| Parametrik EQ | Evet — otomatikleştirilebilir bantlara sahip yeni bir parametrik EQ | Kısmen — Filter Curve ve Graphic EQ | Evet — parametrik, grafik ve FFT filtreleri |
| Efekt ön ayarları | Evet — uygula, kaydet, içe aktar, dışa aktar | Evet — uygula, kaydet, içe aktar, dışa aktar | Evet |
| Makrolar ve toplu zincirler | Evet — şablonlarla birlikte kayıtlı makro kütüphanesi | Hayır — sabitlenmiş derlemede Makrolar menüsü yorum satırı olarak devre dışı bırakılmış | Evet — Favoriler ve Batch Process |
| Üçüncü taraf eklenti biçimleri | Kısmen — masaüstünde izin ve yalıtım arkasında VST3, CLAP, AU, LV2, Linux LADSPA efektleri ve Vamp çözümleyicileri; tarayıcıda hiçbiri yok | Evet — eklenti yöneticisiyle birlikte VST3, AU, LV2 ve Nyquist | Kısmen — VST3 ve macOS'te AU, CLAP veya LV2 yok |
| Nyquist betikleme | Evet — paketlenmiş eklentiler ve Nyquist istemi | Evet — paketlenmiş eklentiler ve Nyquist istemi | Hayır |
| Yalıtılmış efekt paketleri | Kısmen — incelenmiş WebAssembly paketleri, biri gönderiliyor ve dışarıdakiler çitle çevrili | Hayır | Hayır |
| Sanal enstrümanlar | Hayır — 1.0'dan sonra | Hayır | Hayır |

## Karıştırma, yönlendirme ve otomasyon

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Kanal şeritli mikser | Evet | Kısmen — iz kontrolleri ve bir master izi | Evet |
| Bus'lar ve alt karışımlar | Evet — iç içe, döngü doğrulamasıyla | Hayır | Evet — bus izleri |
| Gönderimler (Sends) | Evet — fader öncesi ve sonrası, birden fazla atama | Hayır | Evet — fader öncesi ve sonrası |
| VCA grupları | Evet | Hayır | Hayır |
| Sidechain girişi | Evet | Hayır | Evet — gönderimler aracılığıyla |
| Cue ve kontrol odası karışımları | Evet | Hayır | Hayır |
| Eklenti gecikme telafisi | Evet — oynatma, izleme, bus'lar, sidechain'ler, render ve dondurma | Kısmen — sabitlenmiş kaynaklarda açıkça belirtilmemiş | Evet |
| Otomasyon yolları | Evet — kazanç, pan, susturma, gönderimler, bus'lar ve eklenti parametreleri | Hayır — sabitlenmiş derlemede yol ve zarf aracı yok | Evet — ses, pan ve efekt parametreleri |
| Otomasyon modları | Evet — oku, kırp, dokun, kilitle ve yaz | Hayır | Kısmen — oku, yaz, kilitle ve dokun, kırpma yok |
| Eğri şekilleri | Evet — çizgi, tut ve eğri | Hayır | Evet — doğrusal ve spline |
| İz dondurma | Evet — durumu kaybetmeden dondur, çöz ve taahhüt et | Hayır | Kısmen — yeni bir izde bounce yap |

## Ölçüm ve analiz

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ses düzeyi ölçer | Evet — EBU R 128 tarzı, geçmiş ile birlikte | Hayır — Ses Düzeyi Normalizasyonu efekti var ancak ölçer yok | Evet — ITU-R BS.1770'e uygun Ses Düzeyi Radarı |
| Faz ve korelasyon ölçer | Evet | Hayır | Evet — faz ölçer ve analizi |
| Surround ölçümü | Evet | Hayır | Kısmen — 5.1'e kadar |
| Spektrum grafiği | Evet — Spektrumu Çiz | Kısmen — kayıtlı, ancak sabitlenmiş derlemede Analiz menüsünden yorum satırı olarak devre dışı bırakılmış | Evet — Frekans Analizi |
| Dalga formundaki kırpma ve RMS | Evet — her ikisi de, proje bazında açılıp kapatılabilir | Evet — her ikisi de, proje bazında açılıp kapatılabilir | Kısmen — kırpma göstergeleri, Genlik İstatistiklerinde RMS |
| Konuşma anlaşılabilirlik kontrastı | Evet — Kontrast analizörü | Kısmen — kayıtlı, ancak sabitlenmiş derlemede Analiz menüsünden yorum satırı olarak devre dışı bırakılmış | Hayır |

## Kanallar ve sürükleyici ses

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Dosya başına kanal | Evet — PCM formatları için 32'ye kadar | Kısmen — mono ve stereo parçalar | Evet — dalga formu düzenleyicide 32'ye kadar |
| Surround karışımı | Evet — 7.1.4'e kadar yataklar | Hayır | Kısmen — 5.1'e kadar |
| Nesne tabanlı ses | Evet — yatakların yanında nesneler | Hayır | Hayır |
| ADM yazarlığı ve geçiş | Evet — uygunluk denetimleriyle BW64/ADM | Hayır | Hayır |
| Binaural render | Evet — adlandırılmış bir binaural model | Hayır | Kısmen — ambisonics için binauraliser |
| Ambisonics | Hayır | Hayır | Evet — birinci sıra, VR panner ile birlikte |

## Dışa aktarma ve teslimat

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Kayıpsız çıktı | Evet — WAV, AIFF, BWF ve BW64 yerel olarak yazılır | Evet — WAV, AIFF ve FLAC | Evet — WAV, AIFF, FLAC ve daha fazlası |
| Kayıplı çıktı | Kısmen — MP3, AAC, Opus, Vorbis, MP2, FLAC ve WavPack, tümü FFmpeg çalışma zamanı üzerinden | Kısmen — MP3 yerleşik, geri kalanı isteğe bağlı FFmpeg kurulumu üzerinden | Evet — yerleşik |
| Özel kodlayıcı ayarları | Evet — özel bir FFmpeg hedefi | Evet — özel bir FFmpeg hedefi | Evet — format başına seçenekler |
| Dışa aktarma kuyruğu | Evet — duraklat, iptal et, yeniden dene ve yeniden sırala | Hayır — aynı anda tek dışa aktarma | Kısmen — kuyruk kontrolü olmadan Toplu İşleme |
| Tek geçişte stemler ve alternatifler | Evet — karışım ile birlikte kuyruğa alınır | Hayır | Kısmen — stem başına tek karışım indirme |
| Bölge bazlı teslimat | Evet — bölge başına meta veri, boşluklar ve solmalar ile mastering dizileri | Kısmen — etiket dışa aktarma, sabitlenmiş derlemede çoklu dosya dışa aktarma yok | Evet — ayrı dosyalara dışa aktarma işaretçileri |
| Dışa aktarmada ses düzeyi normalizasyonu | Evet — teslimat planının bir parçası | Kısmen — önce efekti çalıştırın | Evet — Ses Düzeyini Eşleştir |
| Dither ve kanal eşleme | Evet — açık kontroller | Kısmen — tercihlerde dither | Evet — açık kontroller |
| Teslimat raporu | Evet — iş başına kalemlendirilmiş | Hayır | Hayır |
| Render kuyruğu yeniden başlatmadan sonra korunur | Evet — masaüstünde, çökme günlüğü ile bayt sıfırdan yeniden başlatma | Hayır | Hayır |

## Diğer araçlarla değişim

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Audacity projeleri | Evet — AUP4 girişi ve çıkışı, bir atılma raporu ile | Evet — yerel | Hayır |
| EDL | Kısmi — CMX3600 sınıfı dışa aktarma, içe aktarma yok | Hayır | Hayır |
| OpenTimelineIO | Kısmi — yalnızca dışa aktarma | Hayır | Hayır |
| FCPXML | Kısmi — yalnızca dışa aktarma | Hayır | Evet — içe ve dışa aktarma |
| DAWproject | Evet — bir değişim raporu ile içe ve dışa aktarma | Hayır | Hayır |
| OMF | Hayır | Hayır | Kısmi — içe ve dışa aktarma |
| Bir video editörüyle çift yönlü geçiş | Kısmi — medyayı kopyalamadan aynı projeyi Framescaper'a devreder | Hayır | Evet — Premiere Pro ile Dynamic Link |
| Etiket ve işaretçi değişimi | Evet — içe ve dışa aktarma | Evet — içe ve dışa aktarma | Evet — işaretçi listeleri |

## Video

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Referans için video içe aktarma | Evet — zaman çizelgesinde, bağlı ses ile | Hayır | Kısmi — tek video izi, yalnızca önizleme |
| Video zaman çizelgesi düzenleme | Kısmi — temel düzenleme, tam yüzey Framescaper'da | Hayır | Hayır |
| Video dışa aktarma | Evet — FFmpeg çalışma zamanı üzerinden MP4 ve WebM | Hayır | Hayır — yalnızca ses |
| Kompozit, renk düzeltme ve efektler | Kısmi — Framescaper'da, aynı projede | Hayır | Hayır |

## Makine yardımı

| Yetenek | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Konuşma iyileştirme | Kısmi — yalnız masaüstü, model yüklemesi kurulduktan sonra | Hayır | Evet — Enhance Speech |
| Transkripsiyon ve konuşmacı ayırma | Kısmi — yalnız masaüstü, isteğe bağlı modeller | Hayır | Hayır — transkripsiyonlar Premiere Pro'da bulunur |
| Kaynak ayırma (stemlere bölme) | Kısmi — yalnız masaüstü, isteğe bağlı modeller | Hayır | Hayır |
| Otomatik kısma (ducking) | Evet — Auto Duck efekti | Evet — Auto Duck efekti | Evet — Essential Sound ducking |
| Ritim ve çekim algılama | Kısmi — yalnız masaüstü, isteğe bağlı modeller | Hayır | Kısmi — Remix müziği otomatik olarak yeniden zamanlar |
| Tamamen kendi makinenizde çalışır | Evet — çıkarım yalnız masaüstünde ve kurulumdan sonra çevrimdışıdır | Evet — hiç çıkarım yok | Kısmi — bazı özellikler Adobe bulutunda işlenir |
| Modeller isteğe bağlı ve kaldırılabilir | Evet — ayrı indirilen, özet sabitli, silinebilir | Evet — kurulacak bir şey yok | Hayır — uygulama ile birlikte paketlenmiştir |

## Farkların toplamı

Audacity 4 tek geçişli bir editördür. Sabitlenmiş derlemede bus'ları, gönderimleri, otomasyon yolları ve makroları yoktur. Soundscaper bu düzenleme modelini korur ve üzerine karıştırma, otomasyon ve teslimat katmanını ekler; ayrıca Audacity'nin denemediği kayıt, video ve değişim işlerini de içerir.

Audition hâlâ restorasyon derinliğinde, Premiere Pro çift yönlü geçişlerinde ve ambisoniklerde öndedir. Soundscaper'ın önde olduğu alanlar ise immersif teslimat, proje yönetimi ve diğer ikisinin de desteklemediği donanımlarda tarayıcıda çalışmasıdır.

Zaten Audacity ile çalışıyorsanız, projeyi nasıl taşıyacağınızı görmek için
[proje dosyaları ve Audacity değişimi](/projects-and-data/project-files/) bölümüne bakın.

---
title: "Soundscaper karşılaştırması"
description: "Kayıt, düzenleme, miksaj, teslim ve alışveriş açısından Soundscaper Web ve Desktop'ı Audacity 4 ve Adobe Audition ile karşılaştırın."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"tr"} -->

Soundscaper, Audacity 4'ü web üzerinde yeniden uygular ve üzerine bir prodüksiyon katmanı ekler. Adobe Audition, ikisinin de genellikle karşılaştırıldığı ticari post prodüksiyon aracıdır. Bu sayfa Soundscaper Web, Soundscaper Desktop, Audacity 4 ve Audition'ı karşılaştırarak hangi sürümün işinizi karşıladığını anlamanıza yardımcı olur.

## Bu sayfanın nasıl okunacağı

Her hücre, renk kodlu bir simgeyle ve ardından bunu açıklayan ayrıntıyla başlar:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — destekleniyor veya geçerli
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — kapsamı sınırlı, platforma bağlı ya da geçici çözüm gerektiriyor
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — kullanılamıyor veya geçerli değil

Notları simgelerle birlikte okuyun. İsteğe bağlı eklenti, model veya kodek kurulumu tek başına desteklenen bir Desktop özelliğini kısıtlı hâle getirmez; notta ne kurmanız gerektiği belirtilir. Web ve Desktop ayrı sütunlarda gösterilir; böylece tarayıcı kısıtlaması Desktop değerlendirmesini düşürmez.

Satırlar menü komutları değil, yetenekleri açıklar. Kesin komut envanteri için bkz. [Komutlar ve kısayollar](/reference/generated/commands/), her bir ürünün neyi mümkün kıldığı için bkz.
[Ürün yetenekleri](/reference/generated/product-capabilities/).

### Bu iddiaların kaynağı

- **Soundscaper** satırları bu depodaki ürün özellik profillerine, çalışma zamanı eylem bildirimine, dışa aktarma biçimi kaydına ve tarayıcı ile masaüstü kodek destek denetimlerine dayanır.
  Masaüstüne özgü yerel hedef yükleri depo CI'sı veya hedef paketleme süreci tarafından oluşturulur. Bir paket, tam olarak eşleşen sonuç hazırlanıp doğrulandıktan sonra özelliği etkinleştirir; satırlarda yükün ne zaman hâlâ gerekli olduğu belirtilir.
- **Audacity 4** satırları bu depoda sabitlenmiş upstream envanterini temel alır: `4.0.0` sürümü `4c177d43` commit'ine sabitlenmiştir; ayrıca [`4.0.1` resmî sürümüne](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) kadar, `d82386ce` commit'i dâhil kullanıcıya görünen değişiklikler de kapsanır. Upstream'de kayıtlı olup devre dışı bırakılan veya menüden yorum satırıyla çıkarılan bir özellik bu şekilde belirtilir. Denetlenen envanterde ve sürüm notlarında bulunmayan özellik, kalıcı olarak mevcut değil şeklinde değil, bu kaynaklarda yer almıyor şeklinde bildirilir. Örnek çizimi, klip kazanç zarfları ve eski proje içe aktarma da resmî [4.0 değişiklik günlüğünde](https://www.audacityteam.org/changelog/) ve [klip kazancı kılavuzunda](https://www.audacityteam.org/manual/clips/clip-gain/) belgelenmiştir.
- **Audition** satırları, güncel sürüm için Adobe'ın yayımladığı belgelerden gelir. Çalışan bir derlemeyle doğrulanmamışlardır.

## Platform ve terimler

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Lisans | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, açık kaynak | / — mülkiyetçi ve kapalı |
| Maliyet | + — ücretsiz | + — ücretsiz | + — ücretsiz | / — Creative Cloud aboneliği |
| Tarayıcıda çalışır | + — Chromium, Firefox ve WebKit | / — paketlenmiş uygulama | / — yalnızca masaüstü | / — yalnızca masaüstü |
| Masaüstü derlemeleri | / — tarayıcı sürümünü kullanın | + — x64 ve ARM64'te Windows ve Linux, ARM64'te macOS | + — Windows (yükleyici veya taşınabilir sürüm), macOS, Linux | ~ — Windows ve macOS, Linux yok |
| Hesap olmadan çalışır | + — hesap mevcut değil | + — hesap mevcut değil | + — yalnızca audio.com için oturum açma | / — oturum açılmış abonelik gerekli |
| Bulut proje depolama | / — yerel öncelikli tasarım tarafından hariç tutulur | / — yerel öncelikli tasarım tarafından hariç tutulur | + — audio.com üzerinden kaydetme ve paylaşma | ~ — Creative Cloud dosyaları, oturumlar senkronize edilmez |
| Sistem gereksinimleri | + — güncel bir tarayıcının çalıştığı her yerde çalışır | + — desteklenen masaüstü mimarilerinde Windows, Linux veya macOS | ~ — Audacity 3'e göre önemli ölçüde artmıştır | ~ — profesyonel iş istasyonu sınıfı |

## Proje ve oturum modeli

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Yerel proje biçimi | + — `.sscape`, kayıpsız taşınabilir bir arşiv | + — `.sscape`, kayıpsız taşınabilir bir arşiv | + — `.aup4` | + — `.sesx` |
| Audacity projelerini açma | + — AUP, AUP3 ve AUP4 içe aktarma; AUP3 ve AUP4 dışa aktarma | + — AUP, AUP3 ve AUP4 içe aktarma; AUP3 ve AUP4 dışa aktarma | + — AUP, AUP3 ve AUP4 içe aktarma; AUP4 dışa aktarma, AUP3 dışa aktarma yok | / |
| Yıkıcı olmayan klip zaman çizelgesi | + | + | + | + — çok kanallı düzenleyici |
| Özel tek dosya düzenleyici | + — Klip özelliklerindeki kaynak dalga biçimi düzenleyicisi | + — Klip özelliklerindeki kaynak dalga biçimi düzenleyicisi | ~ — düzenlemeler zaman çizelgesinde yerinde uygulanır | + — dalga formu düzenleyici |
| Tek parçada mono ve stereo içerik | + — bir parça bunlardan birini tutar | + — bir parça bunlardan birini tutar | / — bir parça mono veya stereodur | / — kanal biçimi parça başına sabittir |
| İçe içe geçmiş parça klasörleri | + — herhangi bir derinlikte, geri alınabilir, yönlendirme ile | + — herhangi bir derinlikte, geri alınabilir, yönlendirme ile | / | ~ — yalnızca alt karışım hatları, klasör parçaları yok |
| Proje kutusu | + — dosyaları düzenler ve pano olarak da işlev görür | + — dosyaları düzenler ve pano olarak da işlev görür | / | ~ — Dosyalar paneli açık dosyaları listeler |
| Otomatik kaydetme ve çökme kurtarma | + — otomatik kaydetme, kilitler ve kurtarma zarfları | + — otomatik kaydetme, kilitler ve kurtarma zarfları | + | + |
| İşaretçiler ve adlandırılmış bölgeler | + — birinci sınıf, gezinme ve akışkan davranış ile | + — birinci sınıf, gezinme ve akışkan davranış ile | ~ — etiket parçaları | + — işaretçiler ve aralıklar |
| Tempo ve zaman imzası haritaları | + — örnek hassasiyetinde çözümlenen sıralı haritalar | + — örnek hassasiyetinde çözümlenen sıralı haritalar | ~ — tek proje temposu ve imzası | ~ — tek oturum temposu |

## Kayıt

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Çok kanallı kayıt | + — birden fazla kaynağı aynı anda | + — birden fazla kaynağı aynı anda | ~ — aynı anda bir giriş cihazı | + — çoklu giriş ve çok kanallı arayüzler |
| Mikrofon ve masaüstü sesini birlikte | ~ — tarayıcı ve işletim sistemi ekran sesini sunduğunda yerleşik olarak kullanılabilir | + — mikrofon ve Windows masaüstü döngü yakalaması; diğer sistemlerde döngü girişi kullanılır | / | ~ — işletim sistemi döngü geri besleme cihazı gerektirir |
| Zamanlanmış kayıt | + | + | + | / |
| Sesle tetiklenen kayıt | + — ayarlanabilir eşik ile | + — ayarlanabilir eşik ile | + — ayarlanabilir eşik ile | / |
| Alım öncesi geri sayım | + — tempo haritası farkında, bileşik ölçüyü işler | + — tempo haritası farkında, bileşik ölçüyü işler | ~ — giriş kaydı | ~ — vuruş ve yuvarlamanın bir parçası olarak ön kaydırma |
| Vuruş kaydı | + — tek işlem, varsayılan ve yönlendirilmiş yakalama | + — tek işlem, varsayılan ve yönlendirilmiş yakalama | / | + — vuruş ve yuvarlama |
| Alımlara döngü kaydı | + — geçiş başına bir şerit, aynı gruba eklenir | + — geçiş başına bir şerit, aynı gruba eklenir | / | ~ — bir klipteki alımlar, listeden seçilir |
| Alım birleştirme | + — deneme, yükseltme, birleştirme bölgelerini düzenleme, tek geri alınabilir düzenleme olarak düzleştirme | + — deneme, yükseltme, birleştirme bölgelerini düzenleme, tek geri alınabilir düzenleme olarak düzleştirme | / | / — birleştirme düzenleyicisi yok |
| Giriş izleme ve ölçüm | + | + | + | + |

## Zaman çizelgesi düzenleme

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ripple düzenleme varyantları | + — kesme ve silme işlemlerinde klip başına, iz başına ve tüm izler için | + — kesme ve silme işlemlerinde klip başına, iz başına ve tüm izler için | + — kesme ve silme işlemlerinde aynı üç varyant | ~ — bir seçim veya boşlukta ripple silme |
| Bölme, birleştirme ve sessizliklerde bölme | + | + | + | ~ — bölme ve kırpma, klip birleştirme yok |
| Klip grupları | + | + | + | + |
| Klip kazancı | + | + | + | + |
| Klip başına perde ve hız | + — ayarla, işle veya sıfırla | + — ayarla, işle veya sıfırla | + — ayarla, işle veya sıfırla | ~ — esnetme düzenlenebilir kalır, perde bir efekttir |
| Tempo değişikliklerini takip etme | + — harita hareket ettiğinde klipler esner | + — harita hareket ettiğinde klipler esner | + | / |
| Vuruş duyarlı kuantizasyon ve groove | + — ayarlanabilir groove gücüne sahip warp haritaları | + — ayarlanabilir groove gücüne sahip warp haritaları | / | / |
| Sıfır geçişlerine yapışma | + | + | + | + |
| Örnek düzeyinde çizim | + | + | + — tek tek örneklere yakınlaştırıldığında kullanılabilir | + — dalga formu düzenleyicide |
| Yalnızca klavye ile düzenleme | + — her düzenleme ilkesi için bir gezinme eylemi var | + — her düzenleme ilkesi için bir gezinme eylemi var | + — düzenleme eylemleri, zaman çizelgesi ve parça dikey cetvelleri klavyeyle kullanılabilir | ~ — kapsamlı kısayollar, bazı paneller fare gerektirir |

## Spektral iş ve onarım

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Spektrogram görünümü | + — iz başına ayarlarla | + — iz başına ayarlarla | + — iz başına ayarlarla | + — frekans ve perde görüntülemeleri |
| Frekans sınırlı seçim | + | + | + | + — çerçeve ve lasso |
| Spektral fırça | + | + | + | + — boyama fırçası ve nokta iyileştirme |
| Spektral bir bölgeyi silme veya güçlendirme | + — her ikisi de doğrudan eylem olarak | + — her ikisi de doğrudan eylem olarak | + — her ikisi de doğrudan eylem olarak | ~ — seçime bir etki uygulama |
| Kısa hasarları onarma | + — Onarım | + — Onarım | + — Onarım | + — Otomatik İyileştirme ve Nokta İyileştirme Fırçası |
| Geniş bantlı gürültü azaltma | + — yakalanmış bir profille | + — yakalanmış bir profille | + — yakalanmış bir profille | + — Gürültü Azaltma, Uyarlanabilir Gürültü Azaltma, DeNoise |
| Yankı giderme | / — yalnızca Desktop asistanı | + — isteğe bağlı model ve motor kurulduğunda Reduce Reverb | / | + — DeReverb |
| Tıklama, uğultu ve sibilans araçları | ~ — Click Removal ve De-esser; özel bir uğultu giderici yok | ~ — Click Removal ve De-esser; özel bir uğultu giderici yok | ~ — yalnızca Tıklama Kaldırma | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Teşhis paneli | ~ — analizör olarak Find Clipping | ~ — analizör olarak Find Clipping | ~ — analizör olarak Find Clipping | + — sorun başına onarım ile teşhisler |

## Efektler ve eklentiler

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Yerleşik efekt paketi | + — Audacity tabanlı efektler, birlikte gelen Nyquist eklentileri ve Bitcrusher ile De-esser gibi yerel efektler | + — Audacity tabanlı efektler, birlikte gelen Nyquist eklentileri ve Bitcrusher ile De-esser gibi yerel efektler | + — sabitlenmiş sürümde 30 yerleşik efekt | + — çok bantlı dinamikler dahil yaklaşık elli |
| İzlere özel gerçek zamanlı efekt rafı | + — üst akıştan daha geniş bir gerçek zamanlı set | + — üst akıştan daha geniş bir gerçek zamanlı set | + | + — klip, iz ve master başına on altı slot |
| Parametrik EQ | + — otomatikleştirilebilir bantlara sahip yeni bir parametrik EQ | + — otomatikleştirilebilir bantlara sahip yeni bir parametrik EQ | ~ — Filter Curve ve Graphic EQ | + — parametrik, grafik ve FFT filtreleri |
| Efekt ön ayarları | + — uygula, kaydet, içe aktar, dışa aktar | + — uygula, kaydet, içe aktar, dışa aktar | + — uygula, kaydet, içe aktar, dışa aktar | + |
| Makrolar ve toplu zincirler | + — şablonlarla birlikte kayıtlı makro kütüphanesi | + — şablonlarla birlikte kayıtlı makro kütüphanesi | / — sabitlenmiş derlemede Makrolar menüsü yorum satırı olarak devre dışı bırakılmış | + — Favoriler ve Batch Process |
| Üçüncü taraf eklenti biçimleri | / — yerel eklentiler Desktop gerektirir | + — VST3, CLAP, AU, LV2, Linux LADSPA ve Vamp; platforma özgüdür, izin ve yalıtım gerektirir | + — eklenti yöneticisiyle birlikte VST3, AU, LV2 ve Nyquist | ~ — VST3 ve macOS'te AU, CLAP veya LV2 yok |
| Nyquist betikleme | + — paketlenmiş eklentiler ve Nyquist istemi | + — paketlenmiş eklentiler ve Nyquist istemi | + — paketlenmiş eklentiler ve Nyquist istemi | / |
| Yalıtılmış efekt paketleri | ~ — incelenmiş WebAssembly paketleri, biri gönderiliyor ve dışarıdakiler çitle çevrili | ~ — incelenmiş WebAssembly paketleri, biri gönderiliyor ve dışarıdakiler çitle çevrili | / | / |
| Sanal enstrümanlar | / | / | / | / |

## Karıştırma, yönlendirme ve otomasyon

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Kanal şeritli mikser | + | + | ~ — iz kontrolleri ve bir master izi | + |
| Bus'lar ve alt karışımlar | + — iç içe, döngü doğrulamasıyla | + — iç içe, döngü doğrulamasıyla | / | + — bus izleri |
| Gönderimler (Sends) | + — fader öncesi ve sonrası, birden fazla atama | + — fader öncesi ve sonrası, birden fazla atama | / | + — fader öncesi ve sonrası |
| VCA grupları | + | + | / | / |
| Sidechain girişi | + | + | / | + — gönderimler aracılığıyla |
| Cue ve kontrol odası karışımları | + | + | / | / |
| Eklenti gecikme telafisi | + — oynatma, izleme, bus'lar, sidechain'ler, render ve dondurma | + — oynatma, izleme, bus'lar, sidechain'ler, render ve dondurma | ~ — sabitlenmiş kaynaklarda açıkça belirtilmemiş | + |
| Otomasyon yolları | + — kazanç, pan, susturma, gönderimler, bus'lar ve eklenti parametreleri | + — kazanç, pan, susturma, gönderimler, bus'lar ve eklenti parametreleri | ~ — klip kazanç zarfları; parça veya efekt otomasyon şeridi yok | + — ses, pan ve efekt parametreleri |
| Otomasyon modları | + — oku, kırp, dokun, kilitle ve yaz | + — oku, kırp, dokun, kilitle ve yaz | / | ~ — oku, yaz, kilitle ve dokun, kırpma yok |
| Eğri şekilleri | + — çizgi, tut ve eğri | + — çizgi, tut ve eğri | ~ — yalnızca klip kazanç zarfları | + — doğrusal ve spline |
| İz dondurma | + — durumu kaybetmeden dondur, çöz ve taahhüt et | + — durumu kaybetmeden dondur, çöz ve taahhüt et | / | ~ — yeni bir izde bounce yap |

## Ölçüm ve analiz

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ses düzeyi ölçer | + — EBU R 128 tarzı, geçmiş ile birlikte | + — EBU R 128 tarzı, geçmiş ile birlikte | / — Ses Düzeyi Normalizasyonu efekti var ancak ölçer yok | + — ITU-R BS.1770'e uygun Ses Düzeyi Radarı |
| Faz ve korelasyon ölçer | + | + | / | + — faz ölçer ve analizi |
| Surround ölçümü | + | + | / | ~ — 5.1'e kadar |
| Spektrum grafiği | + — Spektrumu Çiz | + — Spektrumu Çiz | ~ — kayıtlı, ancak sabitlenmiş derlemede Analiz menüsünden yorum satırı olarak devre dışı bırakılmış | + — Frekans Analizi |
| Dalga formundaki kırpma ve RMS | + — proje genelinde ayarlanabilir, parça başına RMS geçersiz kılmalarıyla | + — proje genelinde ayarlanabilir, parça başına RMS geçersiz kılmalarıyla | + — her ikisi de, proje bazında açılıp kapatılabilir | ~ — kırpma göstergeleri, Genlik İstatistiklerinde RMS |
| Konuşma anlaşılabilirlik kontrastı | + — Kontrast analizörü | + — Kontrast analizörü | ~ — kayıtlı, ancak sabitlenmiş derlemede Analiz menüsünden yorum satırı olarak devre dışı bırakılmış | / |

Soundscaper'da **Half-wave** veya **Show RMS in waveform** seçeneklerini açıp kapatmak için parçanın **Track visualization** menüsünü açın. Varsayılan görünüm, 3 bantlı crossover frekansları ve spektrogram ayarları **Edit → Preferences → Track display** bölümündedir.

## Kanallar ve sürükleyici ses

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Dosya başına kanal | + — PCM formatları için 32'ye kadar | + — PCM formatları için 32'ye kadar | ~ — mono ve stereo parçalar | + — dalga formu düzenleyicide 32'ye kadar |
| Surround karışımı | + — 7.1.4'e kadar yataklar | + — 7.1.4'e kadar yataklar | / | ~ — 5.1'e kadar |
| Nesne tabanlı ses | + — yatakların yanında nesneler | + — yatakların yanında nesneler | / | / |
| ADM yazarlığı ve geçiş | + — uygunluk denetimleriyle BW64/ADM | + — uygunluk denetimleriyle BW64/ADM | / | / |
| Binaural render | + — adlandırılmış bir binaural model | + — adlandırılmış bir binaural model | / | ~ — ambisonics için binauraliser |
| Ambisonics | / | / | / | + — birinci sıra, VR panner ile birlikte |

## Dışa aktarma ve teslimat

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Kayıpsız çıktı | + — yerel WAV, AIFF, BWF ve BW64; özel kodeklerle FLAC ve WavPack | + — yerel WAV, AIFF, BWF ve BW64; özel kodeklerle FLAC ve WavPack | + — WAV, AIFF ve FLAC | + — WAV, AIFF, FLAC ve daha fazlası |
| Kayıplı çıktı | ~ — MP3, MP2, Opus ve Ogg Vorbis; AAC tarayıcıya bağlıdır | + — yapılandırılmış FFmpeg dâhil, desteklenen kodek sağlayıcılarıyla MP3, MP2, Opus, Ogg Vorbis ve AAC | + — MP3, Opus ve Ogg Vorbis; ek biçimler isteğe bağlı FFmpeg ile | ~ — MP2, MP3 ve Ogg Vorbis; daha fazlası Adobe Media Encoder ile, genel FFmpeg hedefi yok |
| Özel kodlayıcı ayarları | ~ — biçim başına denetimler; özel FFmpeg bağımsız değişkenleri kullanılamaz | ~ — biçim başına denetimler; özel FFmpeg bağımsız değişkenleri kullanılamaz | + — özel bir FFmpeg hedefi | + — format başına seçenekler |
| Dışa aktarma kuyruğu | + — duraklat, iptal et, yeniden dene ve yeniden sırala | + — duraklat, iptal et, yeniden dene ve yeniden sırala | / — Export Multiple bir iş kuyruğu değil, sıralı tek bir işlemdir | ~ — kuyruk kontrolü olmadan Toplu İşleme |
| Tek geçişte stemler ve alternatifler | + — karışım ile birlikte kuyruğa alınır | + — karışım ile birlikte kuyruğa alınır | ~ — Export Multiple her parçayı ayrı yazar, ancak miks ile alternatif renderları birlikte kuyruğa almaz | ~ — stem başına tek karışım indirme |
| Bölge bazlı teslimat | + — bölge başına meta veri, boşluklar ve solmalar ile mastering dizileri | + — bölge başına meta veri, boşluklar ve solmalar ile mastering dizileri | + — Export Multiple etiketli her bölgeyi kendi dosyasına yazar | + — ayrı dosyalara dışa aktarma işaretçileri |
| Dışa aktarmada ses düzeyi normalizasyonu | + — teslimat planının bir parçası | + — teslimat planının bir parçası | ~ — önce efekti çalıştırın | + — Ses Düzeyini Eşleştir |
| Dither ve kanal eşleme | + — açık kontroller | + — açık kontroller | ~ — tercihlerde dither | + — açık kontroller |
| Teslimat raporu | + — iş başına kalemlendirilmiş | + — iş başına kalemlendirilmiş | / | / |
| Render kuyruğu yeniden başlatmadan sonra korunur | / — kalıcı render kurtarma Desktop gerektirir | + — çökme günlüğüyle sıfırıncı bayttan yeniden başlar | / | / |

Soundscaper Desktop, desteklenen dışa aktarma biçimlerinde yapılandırılmış FFmpeg'i kullanabilir; mevcut düzenleyici rastgele FFmpeg bağımsız değişkenlerini veya tüm FFmpeg kodlayıcılarını sunmaz. Kayıtlı hedefler için [Dışa aktarma biçimleri](/reference/generated/formats/) sayfasına bakın. Audacity'nin [dışa aktarma akışı](https://www.audacityteam.org/manual/getting-started/export-your-audio/), isteğe bağlı FFmpeg kurulumu ile biçimler ekler. Audition sabit bir dosya yazıcıları kümesi ve [Adobe Media Encoder'a aktarma](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html) sunar.

## Diğer araçlarla değişim

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Audacity projeleri | + — AUP, AUP3 ve AUP4 içe; uyumluluk raporuyla AUP3 ve AUP4 dışa | + — AUP, AUP3 ve AUP4 içe; uyumluluk raporuyla AUP3 ve AUP4 dışa | + — AUP, AUP3 ve AUP4 içe aktarma; AUP4 dışa aktarma, AUP3 dışa aktarma yok | / |
| Audition oturumları | / — SESX içe aktarma Desktop gerektirir | ~ — atlanan öğeleri bildiren raporla `.sesx` ses içe aktarma; dışa aktarma yok | / — sabitlenmiş sürümde SESX içe aktarma yok | + — yerel |
| EDL | ~ — CMX3600 sınıfı dışa aktarma, içe aktarma yok | ~ — CMX3600 sınıfı dışa aktarma, içe aktarma yok | / | / |
| OpenTimelineIO | ~ — yalnızca dışa aktarma | ~ — yalnızca dışa aktarma | / | / |
| FCPXML | ~ — yalnızca dışa aktarma | ~ — yalnızca dışa aktarma | / | + — içe ve dışa aktarma |
| DAWproject | + — bir değişim raporu ile içe ve dışa aktarma | + — bir değişim raporu ile içe ve dışa aktarma | / | / |
| OMF | / | / | / | ~ — içe ve dışa aktarma |
| Bir video editörüyle çift yönlü geçiş | ~ — medyayı kopyalamadan aynı projeyi Framescaper'a devreder | ~ — medyayı kopyalamadan aynı projeyi Framescaper'a devreder | / | + — Premiere Pro ile Dynamic Link |
| Etiket ve işaretçi değişimi | + — içe ve dışa aktarma | + — içe ve dışa aktarma | + — içe ve dışa aktarma | + — işaretçi listeleri |

Audition kaynaklı `.sesx` dosyasını Soundscaper'a aktarma ve hangi ses ayarlarının taşındığıyla raporda nelerin atlandığı için [Proje dosyaları](/projects-and-data/project-files/) bölümüne bakın.

## Video

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Referans için video içe aktarma | + — zaman çizelgesinde, bağlı ses ile | + — zaman çizelgesinde, bağlı ses ile | / | ~ — tek video izi, yalnızca önizleme |
| Video zaman çizelgesi düzenleme | ~ — temel düzenleme, tam yüzey Framescaper'da | ~ — temel düzenleme, tam yüzey Framescaper'da | / | / |
| Video dışa aktarma | ~ — tarayıcı WebCodecs gerekli kodekleri desteklediğinde MP4 ve WebM | + — doğrulanmış masaüstü kodek sağlayıcısıyla MP4 ve WebM | / | / — yalnızca ses |
| Kompozit, renk düzeltme ve efektler | ~ — Framescaper'da, aynı projede | ~ — Framescaper'da, aynı projede | / | / |

## Makine yardımı

Desktop asistanı, isteğe bağlı model ağırlıkları ve eşleşen yerel motor kurulduktan sonra kullanılabilir; bu iş akışları Web'de kullanılamaz. Model Manager ikisini de kurar. Kullanılabilir iş akışları ve modeller için [Yerel asistan](/reference/generated/local-assistance/) bölümüne bakın.

| Yetenek | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Konuşma iyileştirme | / — yalnızca Desktop asistanı | + — isteğe bağlı model ve motor kurulu olduğunda | / | + — Enhance Speech |
| Transkripsiyon ve konuşmacı ayırma | / — yalnızca Desktop asistanı | + — isteğe bağlı modeller ve motorlar kurulu olduğunda | / | / — transkripsiyonlar Premiere Pro'da bulunur |
| Kaynak ayırma (stemlere bölme) | / — yalnızca Desktop asistanı | + — isteğe bağlı model ve motor kurulu olduğunda | / | / |
| Otomatik kısma (ducking) | + — Auto Duck efekti | + — Auto Duck efekti | + — Auto Duck efekti | + — Essential Sound ducking |
| Ritim ve çekim algılama | / — ritim algılama Desktop gerektirir; çekim algılama Framescaper'dadır | ~ — isteğe bağlı modelle ritim algılama; çekim algılama Framescaper'dadır | / | ~ — Remix müziği otomatik olarak yeniden zamanlar |
| Tamamen kendi makinenizde çalışır | + — tarayıcıda yerel işleme; model çıkarımı yok | + — model kurulumundan sonra yerel işleme ve çevrimdışı çıkarım | + — hiç çıkarım yok | ~ — bazı özellikler Adobe bulutunda işlenir |
| Modeller isteğe bağlı ve kaldırılabilir | / — Web'de model kurulumu gerekmez | + — ayrı indirilen, özet sabitli, silinebilir | + — kurulacak bir şey yok | / — uygulama ile birlikte paketlenmiştir |

## Farkların toplamı

Audacity 4 tek geçişli bir düzenleyicidir. Sabitlenmiş sürümde veri yolları, gönderimler, parça veya efekt otomasyon şeritleri ve makrolar yoktur. Klip kazanç zarfları, klip içindeki ses düzeyinin otomasyonunu sağlar. Soundscaper bu düzenleme modelini korur; ayrıca parça ve efekt otomasyonu, miksaj ve teslimatın yanı sıra Audacity'nin sunmadığı kayıt, video ve alışveriş özelliklerini ekler.

Audition, restorasyon derinliği, Premiere Pro ile çift yönlü proje aktarımı ve ambisonics konularında hâlâ öndedir. Soundscaper ise sürükleyici ses teslimatı, proje yönetimi ve diğer ikisinin desteklemediği donanımlarda tarayıcıda çalışmasıyla öne çıkar.

Audacity kullanıyorsanız, projeyi nasıl taşıyacağınızı öğrenmek için [Proje dosyaları ve Audacity alışverişi](/projects-and-data/project-files/) bölümüne bakın.

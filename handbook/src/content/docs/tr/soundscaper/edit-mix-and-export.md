---
title: "Düzenle, karıştır ve dışa aktar"
description: "Klipleri düzenle, parçaları dengele, efektler uygula ve teslim dosyası oluştur."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"tr"} -->

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

### Klip kaynağını düzenleme {#clip-source-properties}

Kaynak düzenleyiciyi açmak için **Düzenle → Ses klipleri → Klip özellikleri** seçeneğini belirleyin. Klip arkasında kaydın tamamı görünür. Klip başlangıcını proje zaman çizelgesindeki yerinde tutarak kaynak başlangıcını ve süreyi değiştirmek için klip kenarlarını sürükleyin. **Normalleştir** bölmesinde klip kazancı, tepe ve ses yüksekliği işlemleri bulunur.

Hız ve perdeyi birlikte değiştirmek için **Perde ve tempo** bölümünü açıp **Perde ve tempoyu bağla** seçeneğini işaretleyin. `1` hız oranı ve `0%` perde değişikliği sesi değiştirmez. `2` oranı iki kat hızlı ve bir oktav yüksek çalar; `0.5` yarı hızda ve bir oktav düşük çalar. Bağlı denetimlerden birini düzenlemek diğerini günceller. Bağlantıyı kaldırmak, geçerli hız oranını korurken bağımsız perde ayarını geri getirir.

Kaynak örneğine bağlı bir esnetme işaretçisi eklemek için dalga biçimine **Ctrl+tıklayın**. İşaretçiyi sürüklemek iki taraftaki zamanlamayı değiştirir; kaplama her iki oynatma hızını gösterir. Klip denetimleri klip başına uygulanmaya devam eder. Kaynak sesini seçip efekt uygulamak, bu kaynağı kullanan tüm klipleri günceller.

### Klipleri elektronik tabloda düzenleme {#clip-spreadsheet}

Projede bulunan tüm klipleri görmek için **Görünüm → Paneller → Klip elektronik tablosu** seçeneğini belirleyin. Panel zaman çizelgesinin altında açılır. Panel menüsünden başka bir kenet alanına taşıyabilir, kayan pencere yapabilir veya kapatabilirsiniz. Boyut ve konum çalışma alanıyla kaydedilir. Her satırda parça, zaman çizelgesi konumu, kaynak dosyası, kaynak ofseti, süre, perde, hız, kazanç, solmalar ve oynatma seçenekleri yer alır. Süreler saniye, perde yarım ses aralığıdır; hız oranı `1` normal, `2` iki kat hızlı anlamına gelir.

Bir hücreye çift tıklayın veya seçip **Enter** tuşuna basarak değerini düzenleyin. Değişikliği uygulamak için **Enter**, iptal etmek için **Escape** tuşuna basın. Parça ve kaynak hücrelerinde gerçek kimlikler görünür. Klip mevcut bir ses parçasına taşımak için parça kimliğini değiştirin. Sesi değiştirmek için kaynak kimliğini değiştirin veya yerel bir dosya yolu girin; zaman çizelgesi konumu, süre, hız ve saniye cinsinden kaynak ofseti korunur. Yeni dosya belirtilen kaynak aralığını içermelidir. **Ters** ve **Ters çevrilmiş** onay kutularıdır; hücreyi seçip **Boşluk** tuşuna basarak değiştirin. Kilitli parçalardaki klipler ve video klipleri salt okunurdur.

Süreyi değiştirmek, geçerli ofsetten başlayarak kaynak aralığını kısaltır veya uzatır. Hız değişikliği, aynı anda süre de yapıştırılmadıkça kaynak aralığını korur. Zamanlamayı burada değiştirmeden önce kliplerin grubunu veya bağlantısını kaldırın; esnetilmiş kliplerin zamanlamasını kaynak düzenleyicide ayarlayın.

Bir hücre seçin, aralık boyunca sürükleyin veya seçimi genişletmek için başka bir hücreye **Shift+tıklayın**. Satır numarasına ya da sütun başlığına tıklayarak tüm satır veya sütunu seçin. Seçimi elektronik tabloyla değiştirmek için **Ctrl+C** ve **Ctrl+V** (**macOS'te Cmd+C** ve **Cmd+V**) kullanın. Sütunlar sekmelerle, satırlar yeni satırlarla ayrılır. Yapıştırma seçili hücreden başlar ve mevcut klipleri günceller. Var olan satırların dışına taşan yapıştırma reddedilir. Seçim varken **Escape** tuşuna basın veya tablonun altındaki boşluğa tıklayarak seçimi temizleyin. Seçim yokken yapıştırma, boş proje dahil, yeni satırlar ekler. Oynatma seçenekleri `true` veya `false` olarak kopyalanır ve yapıştırılırken bu değerleri kabul eder. Yeni satırlar tablonun sütun sırasını izler ve kaynak dosya adı veya kaynak kimliği gerektirir. Benzersiz bir mevcut parça adı klibi o parçaya yerleştirir; yeni ad bir ses parçası oluşturur. Boş parça adlarında kaynak adı kullanılır. Boş sayı hücreleri varsayılanları kullanır: konum ve ofset `0`, hız `1`, perde ve kazanç `0`, solma yok. Süre boşsa istenen hızda kalan ses kullanılır.

Panel önce kaynağı proje içinde, proje kutusu dahil, arar. Kaynak yoksa **Başvurulan dosyaları yükle** seçeneğini belirleyip iletişim kutusunda listelenen ses dosyalarını seçin. Disk yolları da dosya seçimi gerektirir; bir yolu yapıştırmak uygulamaya dosyaya erişim izni vermez. Seçilen dosyalar başvurulan adlarla açıkça eşleşmelidir. Panel sesi içe aktarır, kaynak sınırlarını ve klip özelliklerini doğrular ve yeni klipleri belirtilen konumlara yerleştirir. **Ctrl+Z** (**macOS'te Cmd+Z**) tüm yapıştırmayı tek adımda geri alır; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) yeniden uygular. Yapıştırma geçersiz bir değer içeriyorsa klipler değişmeden kalır.

## Karışımı Oluştur

Parça kazancı, pan, susturma ve solo kontrollerini kullanarak projeyi dengeli hale getirin. Karıştırıcı paneli, karışım odaklı bir düzenlemede aynı proje durumunu ortaya koyar. Gerçek zamanlı etkiler ayarlanabilir olmaya devam eder; yok edici veya işlenmiş işlemler, geri alma işlemi mevcut olduğu sürece projede değişiklikler oluşturur.

Sonucu incelemek için çalma ölçerini ve ses analizini kullanın. Metre hedefini, tam dışa aktarma dinlemek yerine bir yer tutucu olarak kullanmaktan kaçının.

### Seçilen frekansları dinleme {#listen-to-selected-frequencies}

Dinlemek istediğiniz bölümü seçin. Parça menüsünden **Parça görselleştirme → Spektrogram** seçeneğini belirleyin, ardından **Spektrogram seçenekleri → Spektral frekans aralığını seç** bölümünü açın. En düşük ve en yüksek frekansı girip **Aralığı seç** seçeneğini belirleyin veya spektrogramdaki seçim tutamaçlarını ayarlayın.

**Oynatma seçenekleri → Seçilen frekansları çal** ya da **Seç → Spektral → Seçilen frekansları çal** seçeneğini belirleyin. Daha önce farklı oynatma hızı veya döngü seçilmiş olsa bile seçilen zaman aralığı normal hızda bir kez çalar. Dinleme filtresi; sessize alma, solo, kazanç ve efekt ayarları dahil geçerli karışıma uygulanır. Spektral dikdörtgen frekans bandını ve zaman aralığını gösterir, ancak parçayı solo yapmaz. Oynatma zaten sürüyorsa komut duraklatır; frekans önizlemesini başlatmak için komutu yeniden seçin.

Gerçek zamanlı frekans filtrelerinin kenarları yumuşaktır. Bandın dışındaki frekanslar, ayrıca sınırlara yakın olanlar kısılabilir. **Duraklat** veya **Durdur** filtreyi kaldırır; böylece sonraki normal oynatma tüm frekans aralığını kullanır. Ses, seçimler, geri alma geçmişi ve dışa aktarılan dosyalar değişmeden kalır.

### Sibilansı Azalt {#reduce-sibilance}

**Etki → Gürültü kaldırma ve onarım → De-esser**'i seçin. **Frekans**'ı sesin sert kısmına yakın ayarlayın, ardından **Eşik**'i sibilantları yumuşatana kadar düşürün. **Maksimum azaltma** kesimi sınırlar; yaklaşık 6-9 dB ile başlayın. Daha kısa bir **Saldırı** ünsüzün başlangıcını yakalar, **Salınım** ise yüksek frekansların ne kadar hızlı iyileştiğini kontrol eder. Sadece üst bant azaltılır.

### Farklı frekans bantlarını sıkıştır {#multiband-compression}

**Etki → Ses seviyesi ve sıkıştırma → Çok bantlı sıkıştırıcı**'yı seçin. İki geçiş, sinyali düşük, orta ve yüksek bantlara böler. Her bant, kendi eşiği, oranını ve çıkış kazancına sahiptir. 1'lik bir oran, o bantın dinamiklerini değiştirmez. Saldırı ve salınım, üç bantın tamamına uygulanır. Geçişler, tüm oranları 1 ve bant kazançları 0 dB olduğunda orijinal sinyalin değişmeden geçtiği, 6 dB/okta eğimli, yumuşak, çakışan eğimlerle nazik bir şekilde ayarlanır.

Her iki etki de stereo dengesini korumak için kanallarını birbirine bağlar ve ayrıca parça ve ana etki raflarında da mevcuttur. Raf ayarları projeyle birlikte kaydedilir ve çalma sırasında ayarlanabilir. **Seçime uygula** etkiyi seçili ses üzerine işler ve **Geri Al**'a destek olur. Zaman çizelgesi otomasyonu bu iki etki için kullanılamaz.

### LADSPA efektlerini ve Vamp çözümleyicilerini kullanın {#native-audio-plugins}

Masaüstü uygulaması, **Etki → Eklenti Yöneticisi**'nde bir biçime ve bu biçimin klasörlerinden birine izin verdikten sonra üçüncü taraf eklentileri tarayabilir. Tarama kendiliğinden başlamaz. Bulunan her kurulumu kullanmadan önce etkinleştirin; yerel eklentiler denetimli yardımcı işlemlerde çalıştırılsa da çalıştırılabilir kod içerir, bu nedenle yalnızca güvendiğiniz eklentileri yükleyin.

LADSPA efektleri Linux'ta kullanılabilir. Yöneticide etkinleştirdikten sonra **Etki → Ses Eklentileri**'nden açın. Bu biçimin sağlayıcı arabirimi olmadığından Soundscaper denetimleri LADSPA bağlantı noktalarından oluşturur. Denetim değerleri ile efektin etkin veya atlanmış durumu projeyle birlikte kaydedilir.

Vamp eklentileri sesi değiştirmek yerine analiz eder. Vamp kurulumunu etkinleştirdikten sonra bir ses parçasını seçerek o parçayı analiz edin; ana miksi analiz etmek için ses parçası seçmeden devam edin. Zaman seçimi varsa analiz bu aralıkla sınırlanır; yoksa Soundscaper projenin tamamını kullanır. **Analiz → Vamp Eklentileri**'ni seçin, çözümleyici çıktısı ile ayarlarını belirleyip çalıştırın. Döndürülen zaman damgaları yeni bir etiket parçası olarak ancak analiz tümüyle başarılı olursa eklenir; böylece iptal etmek veya projeyi değiştirmek yarım kalmış etiketler bırakmaz.

## Dışa Aktar

Karışık bir teslimat için **Dosya → Ses dışa aktar**'ı veya yalnızca bir seçim dışa aktarılacaksa **Seçili sesi dışa aktar**'ı seçin. Soundscaper ayrıca saplar ve etiketleri de dışa aktarabilir.

### Klipleri ayrı dosyalar olarak dışa aktarma {#export-clips}

**Dosya → Sesi dışa aktar** seçeneğini belirleyin ve **Çıktı** ayarını **Tek tek klipler (kliplere göre böl)** yapın. Bir ses biçimi seçip **Dışa aktar** düğmesine basarak projenin ses parçalarındaki her ses klibi için bir dosya içeren arşivi indirin. Her dosya klibin duyulabilir başlangıcında başlar ve duyulabilir bitişinde sona erer; proje zaman çizelgesine kadar doldurulmaz ve efekt kuyruğu eklenmez. Kırpmalar, klip kazancı, solmalar, hız ve perde değişiklikleri uygulanır. Üst üste binen klipler ayrı kalır.

Dosyalar, numaralı öneklerle klip adlarını kullanır. Desteklenmeyen dosya adı karakterleri değiştirilir ve numaralar yinelenen klip adlarını ayırt eder. Parça efektleri eklenir; ana efektler, sessize alma ve solo bu dışa aktarmayı etkilemez. Düzenlenebilir kliplerini ayrı dışa aktarmak için önce dondurulmuş parçaları çözün.

Sıkıştırılmış formatlar FFmpeg çalışma zamanını kullanır. Kesin formatlar ve koşullu kullanılabilirlik [oluşturulan format başvurusunda](/reference/) listelenmiştir.

### Bölüm etiketlerini gömme {#embedded-chapters}

Tarayıcı düzenleyicisinde **Dosya → Sesi dışa aktar** seçeneğini belirleyin, **MP3** veya **AAC / M4A** seçin ve **Ses seçenekleri** altında **Etiketleri bölüm olarak göm** seçeneğini açın. Seçenek başlangıçta kapalıdır ve etiket başlıklarıyla zamanlarını tek bir karışım dosyasına ekler. Dışa aktarmadan önce etiket ekleyin; stem, bölüm bölmeleri ve mastering dizileri bu seçeneği sunmaz.

Yalnızca teslim edilen aralıkla kesişen etiketler eklenir. Seçim dışa aktarıldığında bölüm zamanları oluşturulan dosyanın başlangıcına kaydırılır. MP3, bölge etiketi bitiş zamanlarını korur; nokta etiketi sonraki bölümde veya dosyanın sonunda biter. M4A bölüm başlangıçlarını saklar; her bölüm sonraki başlangıca veya dosyanın sonuna kadar sürer. M4A en çok 255 bölüm ve başlık başına 255 UTF-8 baytı destekler. Gömülü bölümlerin görüntülenmesi oynatıcıya bağlıdır.

Kaynak materyali silmeden veya teslim etmeden önce dışa aktarılan dosyayı başka bir uygulamada oynatın.

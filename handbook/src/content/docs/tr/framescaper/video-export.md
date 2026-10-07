---
title: "Videoyu dışa aktarın"
description: "Oluşturulan sekansı doğrulayın ve teslim için MP4 ya da WebM oluşturun."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"tr"} -->

## Dışa aktarmadan önce

- Sekansın tamamını ve her düzenleme sınırını baştan sona oynatın.
- Görünür ve solo durumundaki parçaların amaçlanan görüntüyü oluşturduğunu doğrulayın.
- Bağlantılı sesin eşzamanlı kaldığını kontrol edin.
- Dışa aktarma aralığını ve altyazıların ya da sesin eklenip eklenmeyeceğini doğrulayın.

## Dosyayı oluşturun

Dışa aktarma penceresini açıp bir video biçimi seçin. Framescaper, yapılandırılmış
video çalışma zamanı üzerinden MP4 ve WebM çıktısını destekler. Hedefe uygun
boyutları, kare hızını ve diğer seçenekleri belirleyin.

Video kodlama, normal zaman çizelgesi oynatımına göre daha fazla kaynak kullanır.
Dışa aktarma tamamlandığını bildirene kadar düzenleyiciyi açık tutun.

## Ses kliplerini ayrı ayrı dışa aktarma {#export-audio-clips}

**Dosya → Videoyu dışa aktar** komutunu seçin, **WAV** gibi bir ses biçimi belirleyin ve **Çıktı** ayarını **Tek tek klipler (kliplere göre böl)** yapın. Dışa aktarma, her ses klibi için bir dosya içeren arşivi indirir. Video klipleri dışarıda bırakılır; her ses dosyası kırpmalar ve klip düzenlemeleri dâhil yalnızca kendi klibini içerir.

Dosyalar klibin duyulabilir başlangıcından başlar; proje konumuna kadar boşluk eklenmez ve efekt kuyruğu eklenmez. Numaralı klip adları aynı adlı klipleri birbirinden ayırır.

Parça efektleri dâhildir; ana efektler, sessize alma ve solo bu dışa aktarmayı etkilemez. Ortak ses iş akışı için [Klipleri ayrı dosyalar olarak dışa aktarma](/soundscaper/edit-mix-and-export/#export-clips) bölümüne bakın.

## Çıktıyı doğrulayın

Dışa aktarılan dosyayı ayrı bir oynatıcıda açın. Süresini, ilk ve son karelerini,
görüntü yönünü, ses eşzamanlılığını ve beklenen altyazıları kontrol edin.

Oluşturulan video, düzenlenebilir projenin yerini tutmaz. Zaman çizelgesini ve
proje medyasını korumanız gerekiyorsa ayrıca bir `.fscape` kopyası da dışa aktarın.

---
title: "Làm sạch bản ghi âm thanh"
description: "Loại bỏ tiếng rè từ bản ghi, cắt tiếng ồn, điều chỉnh đến mức âm lượng của podcast và xuất tệp MP3."
editUrl: false
sidebar:
  order: 2
head:
  - tag: script
    attrs:
      type: "application/ld+json"
    content: "{\"@context\":\"https://schema.org\",\"@type\":\"HowTo\",\"name\":\"Clean up a voice recording\",\"description\":\"Take the hum out of a take, cut the rumble, bring it to podcast loudness and export an MP3.\",\"tool\":[{\"@type\":\"HowToTool\",\"name\":\"Soundscaper\"}],\"step\":[{\"@type\":\"HowToStep\",\"position\":1,\"name\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\",\"text\":\"Open Soundscaper. A new, empty project is ready as soon as the editor loads.\"},{\"@type\":\"HowToStep\",\"position\":2,\"name\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\",\"text\":\"Choose File → Import audio and pick guide-noisy-take.wav — a short take whose first half second is room noise before the voice starts. The file lands as a clip on its own track.\"},{\"@type\":\"HowToStep\",\"position\":3,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. Half a second of hiss, then a steady tone standing in for a voice, with the hiss underneath it.\"},{\"@type\":\"HowToStep\",\"position\":4,\"name\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in.\",\"text\":\"Drag in the ruler above the clip, from the start to the 15% mark, to select the noise-only lead-in. The profile must contain nothing but the noise you want gone — no voice at all.\"},{\"@type\":\"HowToStep\",\"position\":5,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction and press Get noise profile. The status line reports that the profile is ready. Press Close to leave the dialog for now.\"},{\"@type\":\"HowToStep\",\"position\":6,\"name\":\"Choose Select → Select all.\",\"text\":\"Choose Select → Select all. The profile is kept; now the effect needs to know what to clean.\"},{\"@type\":\"HowToStep\",\"position\":7,\"name\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection.\",\"text\":\"Choose Effect → Noise removal and repair → Noise Reduction. In the Noise Reduction dialog, set Noise reduction to 12, then press Apply to selection. Twelve decibels is a good first setting. More removes more noise but makes voices sound hollow. The lead-in is nearly flat and the tone is untouched.\"},{\"@type\":\"HowToStep\",\"position\":8,\"name\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection.\",\"text\":\"Choose Effect → Legacy effects → Classic Filters. In the Classic Filters dialog, choose High-pass for Filter type and set Cutoff frequency to 100, then press Apply to selection. Everything below 100 Hz — traffic, handling, air conditioning — is rolled off. Speech lives well above it.\"},{\"@type\":\"HowToStep\",\"position\":9,\"name\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection.\",\"text\":\"Choose Effect → Volume and compression → Loudness Normalization. In the Loudness Normalization dialog, set Target loudness to -16, then press Apply to selection. −16 LUFS is the common target for stereo podcasts. Loudness measures how loud the whole take feels, not how tall its peaks are. The waveform is taller and the take plays at a comfortable level.\"},{\"@type\":\"HowToStep\",\"position\":10,\"name\":\"Press Play to listen, then Stop.\",\"text\":\"Press Play to listen, then Stop. A clean, level take with a quiet lead-in.\"},{\"@type\":\"HowToStep\",\"position\":11,\"name\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog.\",\"text\":\"Choose File → Export audio, set Format to MP3, and press Export. The file downloads as soon as the render finishes, and its link stays in the dialog. The file is encoded in the browser; nothing leaves your computer.\"}]}"
---
<!-- docs-ai-provenance: {"factPacketSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"c5796e3d5fbad38b7da2c37f485446c249614bc1a0dfbd708ef188c61f522c63","targetLocale":"vi"} -->

<!-- Generated by `node scripts/docs-reference.mjs`. Do not edit. -->

Hầu hết các bản ghi âm tại nhà đều cần ba sửa chữa tương tự: loại bỏ tiếng ồn nền ổn định, lọc ra tiếng rầm thấp và điều chỉnh mức âm thanh lên tiêu chuẩn. Hướng dẫn này thực hiện cả ba trên một đoạn lấy ví dụ dài ba giây, trong đó nửa giây đầu tiên chỉ là tiếng ồn phòng, sau đó xuất kết quả dưới dạng MP3.

:::tip[Những gì bạn cần]
- Tải xuống [`guide-noisy-take.wav`](https://assets.soundscaper.org/guides/examples/guide-noisy-take.wav) — một đoạn ngắn mà nửa giây đầu tiên là tiếng ồn phòng trước khi giọng nói bắt đầu.

Mỗi bước bên dưới hoạt động trên các tệp chính xác như chúng là, vì vậy những gì bạn thấy nên phù hợp với những gì hướng dẫn nói. Soundscaper chạy trong trình duyệt; không cần cài đặt gì.
:::

## Những gì bạn sẽ học

- Lý do tại sao Giảm nhiễu cần một hồ sơ và cách cung cấp cho nó.
- Những gì bộ lọc thông cao loại bỏ và cách đặt nó cho bài phát biểu.
- Sự khác biệt giữa mức đỉnh và độ lớn, và cách đạt được một mục tiêu độ lớn.
- Cách xuất một tệp MP3.

## Các bước

1. Mở Soundscaper. Một dự án mới, trống được chuẩn bị ngay khi trình chỉnh sửa tải.
2. Chọn **Tệp → Nhập âm thanh** và chọn `guide-noisy-take.wav` — một đoạn ngắn mà nửa giây đầu tiên là tiếng ồn phòng trước khi giọng nói bắt đầu. Tệp rơi xuống dưới dạng đoạn cắt trên đường ray riêng của nó.
3. Nhấn **Phát** để nghe, sau đó **Dừng**.
   *Bạn nên thấy:* Nửa giây tiếng xì, sau đó là một âm điệu ổn định thay thế cho giọng nói, với tiếng xì bên dưới nó.
4. Kéo trong thanh thước trên đoạn cắt, từ đầu đến dấu mốc 15%, để chọn phần dẫn đầu chỉ có tiếng ồn. Hồ sơ phải chứa duy nhất tiếng ồn bạn muốn loại bỏ — không có giọng nói nào cả.
5. Chọn **Hiệu ứng → Xóa và sửa chữa tiếng ồn → Giảm nhiễu** và nhấn **Lấy hồ sơ tiếng ồn**. Dòng trạng thái báo cáo rằng hồ sơ đã sẵn sàng. Nhấn **Đóng** để rời khỏi hộp thoại cho đến lúc này.
6. Chọn **Chọn → Chọn tất cả**. Hồ sơ được giữ; bây giờ hiệu ứng cần biết những gì để làm sạch.
7. Chọn **Hiệu ứng → Xóa và sửa chữa tiếng ồn → Giảm nhiễu**. Trong hộp thoại **Giảm nhiễu**, đặt **Giảm nhiễu** thành `12`, sau đó nhấn **Áp dụng cho lựa chọn**. Mười hai decibel là cài đặt đầu tiên tốt. Nhiều hơn loại bỏ nhiều tiếng ồn hơn nhưng làm cho giọng nói nghe rỗng.
   *Bạn nên thấy:* Phần dẫn đầu gần như bằng phẳng và âm điệu không bị ảnh hưởng.
8. Chọn **Hiệu ứng → Hiệu ứng di sản → Bộ lọc cổ điển**. Trong hộp thoại **Bộ lọc cổ điển**, chọn **Thông cao** cho **Loại bộ lọc** và đặt **Tần số cắt** thành `100`, sau đó nhấn **Áp dụng cho lựa chọn**. Mọi thứ dưới 100 Hz — giao thông, xử lý, điều hòa không khí — đều bị giảm. Bài phát biểu sống tốt trên nó.
9. Chọn **Hiệu ứng → Âm lượng và nén → Chuẩn hóa độ lớn**. Trong hộp thoại **Chuẩn hóa độ lớn**, đặt **Độ lớn mục tiêu** thành `-16`, sau đó nhấn **Áp dụng cho lựa chọn**. −16 LUFS là mục tiêu phổ biến cho podcast vô tuyến. Độ lớn đo mức độ lớn của toàn bộ đoạn ghi, không phải là độ cao của đỉnh.
   *Bạn nên thấy:* Hình dạng sóng cao hơn và đoạn ghi được phát ở mức âm lượng thoải mái.
10. Nhấn **Phát** để nghe, sau đó **Dừng**.
   *Bạn nên thấy:* Một đoạn ghi sạch, bằng phẳng với phần dẫn đầu yên tĩnh.
11. Chọn **Tệp → Xuất âm thanh**, đặt **Định dạng** thành **MP3**, và nhấn **Xuất**. Tệp tải xuống ngay khi quá trình render hoàn thành, và liên kết của nó vẫn ở trong hộp thoại. Tệp được mã hóa trong trình duyệt; không có gì rời khỏi máy tính của bạn.

## Tiếp theo

- Thực hiện điều này trên đoạn ghi của riêng bạn với các hướng dẫn: [Loại bỏ tiếng ồn nền](/guides/cleaning-up/remove-background-noise/), [Loại bỏ tiếng rầm thấp](/guides/cleaning-up/remove-low-rumble/) và [Chuẩn hóa độ lớn cho một podcast](/guides/volume/normalize-loudness-for-podcasts/).
- Kiểm tra kết quả theo cách một nền tảng sẽ làm: [Đo độ lớn của bản mix của bạn](/guides/analysis/measure-loudness/).

## Các hướng dẫn khác

[Dự án Soundscaper đầu tiên của bạn](/tutorials/your-first-project/) — Nhập một bản ghi âm, nghe, chia nó, mờ dần, xuất một tệp và lưu dự án.
[Đặt nhạc dưới một giọng nói](/tutorials/put-music-under-a-voice/) — Lớp hai đường ray, tự động ngâm một đường ray dưới đường ray khác, trộn chúng xuống và xuất.

## Tham khảo

- [Mỗi tham số của các hiệu ứng được sử dụng ở đây, với giá trị mặc định và phạm vi của nó, nằm trong tham chiếu hiệu ứng âm thanh.](/reference/generated/audio-effects/#parameters)
- [Các định dạng xuất, các thùng chứa của chúng và giới hạn kênh của chúng nằm trong tham chiếu định dạng xuất.](/reference/generated/formats/)
- [Mỗi lệnh menu và phím tắt của nó nằm trong tham chiếu lệnh và phím tắt.](/reference/generated/commands/)

## Về hướng dẫn này

Hướng dẫn này được tái hiện, từng bước một và trên các tệp này, chống lại mỗi phiên bản của Soundscaper bởi bộ công cụ trình duyệt (`tests/browser/soundscaper-tutorials.spec.js`). Nếu một bước ngừng hoạt động, phiên bản bị lỗi cho đến khi hướng dẫn được sửa chữa, vì vậy những gì bạn đọc là những gì trình chỉnh sửa thực hiện.

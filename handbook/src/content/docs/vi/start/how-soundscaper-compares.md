---
title: "So sánh Soundscaper"
description: "So sánh Soundscaper Web và Desktop với Audacity 4 và Adobe Audition về ghi âm, chỉnh sửa, phối âm, bàn giao và trao đổi dự án."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"gpt-6-astra","modelProvider":"codex-session"},"factPacketSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"40b04dc035c478e31f5993fb39598506f3eb95c39c7e3a1ec2696a05cef304b5","targetLocale":"vi"} -->

Soundscaper triển khai lại Audacity 4 trên web và bổ sung một lớp sản xuất âm thanh. Adobe Audition là công cụ hậu kỳ thương mại thường được dùng để so sánh với cả hai. Trang này so sánh Soundscaper Web, Soundscaper Desktop, Audacity 4 và Audition để bạn biết phiên bản nào đã đáp ứng công việc của mình.

## Cách đọc trang này

Mỗi ô bắt đầu bằng một biểu tượng mã màu, theo sau là phần giải thích:

- <span class="verdict verdict--yes" role="img" aria-label="Supported">+</span> — được hỗ trợ hoặc áp dụng
- <span class="verdict verdict--partial" role="img" aria-label="Limited">~</span> — phạm vi hạn chế, phụ thuộc nền tảng hoặc cần giải pháp thay thế
- <span class="verdict verdict--no" role="img" aria-label="Unavailable">/</span> — không khả dụng hoặc không áp dụng

Hãy đọc ghi chú cùng với các biểu tượng. Việc cài đặt plug-in, mô hình hoặc codec tùy chọn không tự làm hạn chế một tính năng Desktop được hỗ trợ; ghi chú sẽ nêu thành phần cần cài. Web và Desktop có cột riêng để hạn chế của trình duyệt không làm giảm đánh giá Desktop.

Các hàng mô tả các khả năng, không phải các lệnh menu. Để biết danh sách lệnh chính xác, xem [Lệnh và phím tắt](/reference/generated/commands/), và để biết mỗi sản phẩm cho phép điều gì, xem
[Năng lực sản phẩm](/reference/generated/product-capabilities/).

### Nguồn gốc của các tuyên bố này

- Các dòng **Soundscaper** dựa trên kho mã này: hồ sơ năng lực sản phẩm, bản kê hành động runtime, danh mục định dạng xuất và các bước kiểm tra codec trên trình duyệt và máy tính.
  Payload đích gốc cho Desktop được tạo bởi CI của kho mã hoặc quy trình đóng gói cho nền tảng đích. Gói chỉ bật tính năng sau khi chuẩn bị và xác minh đúng kết quả tương ứng; các dòng này cho biết khi nào payload vẫn cần thiết.
- Các dòng **Audacity 4** dựa trên danh mục upstream được ghim trong kho mã này: `4.0.0` tại commit `4c177d43`, đồng thời tính đến các thay đổi người dùng nhìn thấy qua bản phát hành [`4.0.1`](https://github.com/audacity/audacity/blob/Audacity-4.0.1/CHANGELOG.txt) tại commit `d82386ce`. Tính năng được đăng ký upstream nhưng bị tắt hoặc chú thích để loại khỏi menu sẽ được ghi rõ. Tính năng không có trong danh mục đã kiểm tra hoặc ghi chú phát hành được đánh dấu là không xuất hiện trong các tài liệu đó, chứ không khẳng định là vĩnh viễn không có. Vẽ mẫu, đường bao gain clip và nhập dự án cũ cũng được nêu trong [nhật ký thay đổi 4.0 chính thức](https://www.audacityteam.org/changelog/) và [tài liệu hướng dẫn gain clip](https://www.audacityteam.org/manual/clips/clip-gain/).
- Các hàng **Audition** đến từ tài liệu công bố của Adobe cho bản phát hành hiện tại. Chúng không được xác minh đối với một bản dựng đang chạy.

## Nền tảng và thuật ngữ

| Khả năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Giấy phép | + — AGPL-3.0-only | + — AGPL-3.0-only | + — GPL, mã nguồn mở | / — độc quyền và đóng |
| Chi phí | + — miễn phí | + — miễn phí | + — miễn phí | / — đăng ký Creative Cloud |
| Chạy trong trình duyệt | + — Chromium, Firefox và WebKit | / — ứng dụng đóng gói | / — chỉ trên máy tính để bàn | / — chỉ trên máy tính để bàn |
| Bản dựng máy tính để bàn | / — dùng phiên bản trình duyệt | + — Windows và Linux trên x64 và ARM64, macOS trên ARM64 | + — Windows (bộ cài đặt hoặc bản portable), macOS, Linux | ~ — Windows và macOS, không có Linux |
| Hoạt động không cần tài khoản | + — không có tài khoản nào tồn tại | + — không có tài khoản nào tồn tại | + — chỉ đăng nhập cho audio.com | / — yêu cầu đăng ký đã đăng nhập |
| Lưu trữ dự án trên đám mây | / — bị loại trừ bởi thiết kế ưu tiên cục bộ | / — bị loại trừ bởi thiết kế ưu tiên cục bộ | + — lưu và chia sẻ thông qua audio.com | ~ — tệp Creative Cloud, phiên không đồng bộ |
| Yêu cầu hệ thống | + — chạy ở bất cứ nơi nào trình duyệt hiện tại chạy | + — Windows, Linux hoặc macOS trên các kiến trúc máy tính được hỗ trợ | ~ — tăng đáng kể so với Audacity 3 | ~ — cấp độ trạm làm việc chuyên nghiệp |

## Mô hình dự án và phiên

| Khả năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Định dạng dự án gốc | + — `.sscape`, một bộ lưu trữ di động không mất dữ liệu | + — `.sscape`, một bộ lưu trữ di động không mất dữ liệu | + — `.aup4` | + — `.sesx` |
| Mở các dự án Audacity | + — nhập AUP, AUP3 và AUP4; xuất AUP3 và AUP4 | + — nhập AUP, AUP3 và AUP4; xuất AUP3 và AUP4 | + — nhập AUP, AUP3 và AUP4; xuất AUP4, không xuất AUP3 | / |
| Dòng thời gian clip không hủy hoại | + | + | + | + — trình chỉnh sửa đa rãnh |
| Trình chỉnh sửa tệp đơn chuyên dụng | + — trình chỉnh sửa dạng sóng nguồn trong thuộc tính Clip | + — trình chỉnh sửa dạng sóng nguồn trong thuộc tính Clip | ~ — các chỉnh sửa được áp dụng tại chỗ trong dòng thời gian | + — trình chỉnh sửa dạng sóng |
| Nội dung đơn âm và stereo trên một rãnh | + — một rãnh chứa một trong hai | + — một rãnh chứa một trong hai | / — một rãnh là đơn âm hoặc stereo | / — định dạng kênh được cố định cho mỗi rãnh |
| Thư mục rãnh lồng nhau | + — bất kỳ độ sâu nào, có thể hoàn tác, với định tuyến | + — bất kỳ độ sâu nào, có thể hoàn tác, với định tuyến | / | ~ — chỉ có bus submix, không có rãnh thư mục |
| Thùng dự án | + — tổ chức tệp và đóng vai trò như bảng nhớ tạm | + — tổ chức tệp và đóng vai trò như bảng nhớ tạm | / | ~ — bảng Tệp liệt kê các tệp đang mở |
| Tự động lưu và khôi phục sau sự cố | + — tự động lưu, khóa và bao khôi phục | + — tự động lưu, khóa và bao khôi phục | + | + |
| Đánh dấu và vùng được đặt tên | + — cấp độ đầu, với điều hướng và hành vi ripple | + — cấp độ đầu, với điều hướng và hành vi ripple | ~ — rãnh nhãn | + — đánh dấu và phạm vi |
| Bản đồ nhịp và chỉ số nhịp | + — các bản đồ có thứ tự được giải quyết chính xác theo mẫu | + — các bản đồ có thứ tự được giải quyết chính xác theo mẫu | ~ — một nhịp và chỉ số nhịp cho dự án | ~ — một nhịp cho phiên làm việc |

## Ghi âm

| Khả năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Ghi âm đa rãnh | + — nhiều nguồn cùng lúc | + — nhiều nguồn cùng lúc | ~ — một thiết bị đầu vào tại một thời điểm | + — các giao diện đa đầu vào và đa kênh |
| Âm thanh micro và âm thanh máy tính cùng lúc | ~ — tích hợp khi trình duyệt và hệ điều hành cho phép truy cập âm thanh màn hình | + — micrô cùng âm thanh vòng lặp máy tính trên Windows; hệ thống khác dùng đầu vào loopback | / | ~ — cần thiết bị vòng lặp của hệ điều hành |
| Ghi âm theo thời gian | + | + | + | / |
| Ghi âm kích hoạt bằng âm thanh | + — với ngưỡng có thể thiết lập | + — với ngưỡng có thể thiết lập | + — với ngưỡng có thể thiết lập | / |
| Đếm nhịp trước khi thu | + — nhận thức bản đồ nhịp, xử lý nhịp phức hợp | + — nhận thức bản đồ nhịp, xử lý nhịp phức hợp | ~ — ghi âm phần dẫn nhập | ~ — pre-roll như một phần của punch and roll |
| Ghi âm punch | + — một giao dịch, bắt mặc định và định tuyến | + — một giao dịch, bắt mặc định và định tuyến | / | + — punch and roll |
| Ghi âm vòng lặp vào các lần thu | + — một làn cho mỗi lượt, được thêm vào cùng một nhóm | + — một làn cho mỗi lượt, được thêm vào cùng một nhóm | / | ~ — các lần thu trên một clip, được chọn từ danh sách |
| Comping các lần thu | + — nghe thử, thăng cấp, chỉnh sửa vùng comp, làm phẳng như một chỉnh sửa có thể hoàn tác | + — nghe thử, thăng cấp, chỉnh sửa vùng comp, làm phẳng như một chỉnh sửa có thể hoàn tác | / | / — không có trình chỉnh sửa comp |
| Giám sát và đo lường đầu vào | + | + | + | + |

## Chỉnh sửa dòng thời gian

| Tính năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Các biến thể chỉnh sửa ripple | + — theo từng clip, theo từng track và tất cả các track, khi cắt và xóa | + — theo từng clip, theo từng track và tất cả các track, khi cắt và xóa | + — ba loại tương tự, khi cắt và xóa | ~ — xóa ripple trên vùng chọn hoặc khoảng trống |
| Tách, ghép và tách tại các vùng im lặng | + | + | + | ~ — tách và cắt, không có ghép clip |
| Nhóm clip | + | + | + | + |
| Độ lợi clip | + | + | + | + |
| Cao độ và tốc độ theo từng clip | + — điều chỉnh, render hoặc đặt lại | + — điều chỉnh, render hoặc đặt lại | + — điều chỉnh, render hoặc đặt lại | ~ — kéo giãn vẫn có thể chỉnh sửa, cao độ là một hiệu ứng |
| Theo dõi thay đổi nhịp độ | + — các clip được kéo giãn khi bản đồ di chuyển | + — các clip được kéo giãn khi bản đồ di chuyển | + | / |
| Lượng tử hóa và groove nhận biết nhịp | + — bản đồ warp với cường độ groove có thể điều chỉnh | + — bản đồ warp với cường độ groove có thể điều chỉnh | / | / |
| Hấp phụ vào các điểm cắt qua zero | + | + | + | + |
| Vẽ ở cấp độ mẫu | + | + | + — khả dụng khi phóng to đến từng mẫu riêng lẻ | + — trong trình chỉnh sửa dạng sóng |
| Chỉnh sửa chỉ bằng bàn phím | + — mọi nguyên thủy chỉnh sửa đều có hành động điều hướng | + — mọi nguyên thủy chỉnh sửa đều có hành động điều hướng | + — các thao tác chỉnh sửa, dòng thời gian và thước dọc của track có thể điều khiển bằng bàn phím | ~ — phím tắt mở rộng, một số bảng cần chuột |

## Công việc phổ biến và phục hồi

| Tính năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Xem biểu đồ phổ | + — với cài đặt theo từng track | + — với cài đặt theo từng track | + — với cài đặt theo từng track | + — hiển thị tần số và cao độ |
| Chọn vùng giới hạn tần số | + | + | + | + — khung chọn và lasso |
| Chổi phổ | + | + | + | + — cọ vẽ và chữa vết đốm |
| Xóa hoặc khuếch đại một vùng phổ | + — cả hai dưới dạng hành động trực tiếp | + — cả hai dưới dạng hành động trực tiếp | + — cả hai dưới dạng hành động trực tiếp | ~ — áp dụng hiệu ứng cho vùng chọn |
| Sửa chữa hư hỏng ngắn | + — Sửa chữa | + — Sửa chữa | + — Sửa chữa | + — Chữa tự động và Chổi chữa vết đốm |
| Giảm nhiễu dải rộng | + — với hồ sơ đã thu | + — với hồ sơ đã thu | + — với hồ sơ đã thu | + — Giảm nhiễu, Giảm nhiễu thích ứng, DeNoise |
| Xóa vang | / — chỉ có trợ lý trên Desktop | + — Reduce Reverb khi đã cài mô hình và engine tùy chọn | / | + — DeReverb |
| Công cụ xử lý tiếng click, tiếng ù và âm sắc | ~ — Click Removal và De-esser; không có công cụ khử tiếng ù riêng | ~ — Click Removal và De-esser; không có công cụ khử tiếng ù riêng | ~ — chỉ có Xóa tiếng click | + — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Bảng chẩn đoán | ~ — Tìm cắt đỉnh như một bộ phân tích | ~ — Tìm cắt đỉnh như một bộ phân tích | ~ — Tìm cắt đỉnh như một bộ phân tích | + — chẩn đoán với sửa chữa theo từng vấn đề |

## Hiệu ứng và plug-in

| Tính năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Bộ hiệu ứng tích hợp | + — hiệu ứng dựa trên Audacity, plug-in Nyquist đi kèm và hiệu ứng riêng như Bitcrusher và De-esser | + — hiệu ứng dựa trên Audacity, plug-in Nyquist đi kèm và hiệu ứng riêng như Bitcrusher và De-esser | + — 30 hiệu ứng tích hợp trong bản dựng được ghim | + — khoảng năm mươi, bao gồm động lực đa dải |
| Giá đỡ hiệu ứng thời gian thực cho mỗi track | + — bộ hiệu ứng thời gian thực rộng hơn upstream | + — bộ hiệu ứng thời gian thực rộng hơn upstream | + | + — mười sáu slot cho mỗi clip, track và master |
| EQ tham số | + — EQ tham số mới với các dải có thể tự động hóa | + — EQ tham số mới với các dải có thể tự động hóa | ~ — Filter Curve và Graphic EQ | + — bộ lọc tham số, đồ họa và FFT |
| Preset hiệu ứng | + — áp dụng, lưu, nhập, xuất | + — áp dụng, lưu, nhập, xuất | + — áp dụng, lưu, nhập, xuất | + |
| Macro và chuỗi hàng loạt | + — thư viện macro đã lưu với các mẫu | + — thư viện macro đã lưu với các mẫu | / — bản dựng cố định đã chú thích tắt menu Macros | + — Favorites và Batch Process |
| Định dạng plug-in bên thứ ba | / — plug-in gốc cần Desktop | + — VST3, CLAP, AU, LV2, Linux LADSPA và Vamp; tùy nền tảng, có yêu cầu đồng ý và cô lập | + — VST3, AU, LV2 và Nyquist, với trình quản lý plug-in | ~ — VST3 và AU trên macOS, không có CLAP hoặc LV2 |
| Lập trình Nyquist | + — plug-in được đóng gói và prompt Nyquist | + — plug-in được đóng gói và prompt Nyquist | + — plug-in được đóng gói và prompt Nyquist | / |
| Gói hiệu ứng được cách ly | ~ — các gói WebAssembly đã được xem xét, một gói được phát hành và các gói bên ngoài bị rào chắn | ~ — các gói WebAssembly đã được xem xét, một gói được phát hành và các gói bên ngoài bị rào chắn | / | / |
| Nhạc cụ ảo | / | / | / | / |

## Trộn, định tuyến và tự động hóa

| Tính năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Bộ trộn với dải kênh | + | + | ~ — điều khiển track và track master | + |
| Bus và submix | + — lồng nhau, với xác minh chu kỳ | + — lồng nhau, với xác minh chu kỳ | / | + — track bus |
| Sends | + — trước và sau fader, nhiều gán | + — trước và sau fader, nhiều gán | / | + — trước và sau fader |
| Nhóm VCA | + | + | / | / |
| Đầu vào sidechain | + | + | / | + — thông qua sends |
| Trộn cue và phòng điều khiển | + | + | / | / |
| Bù trễ plug-in | + — phát, giám sát, bus, sidechain, render và freeze | + — phát, giám sát, bus, sidechain, render và freeze | ~ — không được hiển thị trong các nguồn cố định | + |
| Làn tự động hóa | + — gain, pan, mute, sends, bus và tham số plug-in | + — gain, pan, mute, sends, bus và tham số plug-in | ~ — đường bao gain clip; không có làn tự động hóa track hoặc hiệu ứng | + — âm lượng, pan và tham số hiệu ứng |
| Chế độ tự động hóa | + — đọc, trim, chạm, latch và ghi | + — đọc, trim, chạm, latch và ghi | / | ~ — đọc, ghi, latch và chạm, không có trim |
| Hình dạng đường cong | + — đường thẳng, giữ và đường cong | + — đường thẳng, giữ và đường cong | ~ — chỉ có đường bao gain clip | + — tuyến tính và spline |
| Đóng băng track | + — đóng băng, bỏ đóng băng và cam kết mà không mất trạng thái | + — đóng băng, bỏ đóng băng và cam kết mà không mất trạng thái | / | ~ — bounce sang track mới |

## Đo lường và phân tích

| Tính năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Đồng hồ đo độ lớn | + — kiểu EBU R 128, có lịch sử | + — kiểu EBU R 128, có lịch sử | / — có hiệu ứng Chuẩn hóa Độ lớn nhưng không có đồng hồ đo | + — Radar Độ lớn theo ITU-R BS.1770 |
| Đồng hồ đo pha và tương quan | + | + | / | + — đồng hồ đo pha và phân tích |
| Đo lường âm thanh vòm | + | + | / | ~ — tối đa 5.1 |
| Biểu đồ phổ | + — Vẽ Phổ | + — Vẽ Phổ | ~ — đã đăng ký, nhưng bản dựng cố định đã chú thích tắt khỏi menu Phân tích | + — Phân tích Tần số |
| Bão hòa và RMS trong dạng sóng | + — cài đặt toàn dự án, có thể ghi đè RMS theo từng track | + — cài đặt toàn dự án, có thể ghi đè RMS theo từng track | + — cả hai, bật/tắt theo dự án | ~ — chỉ báo bão hòa, RMS trong Thống kê Biên độ |
| Tương phản độ rõ của giọng nói | + — Bộ phân tích Tương phản | + — Bộ phân tích Tương phản | ~ — đã đăng ký, nhưng bản dựng cố định đã chú thích tắt khỏi menu Phân tích | / |

Trong Soundscaper, mở menu **Track visualization** của track để bật hoặc tắt **Half-wave** hay **Show RMS in waveform**. Chế độ xem mặc định, tần số crossover 3 dải và cài đặt spectrogram nằm trong **Edit → Preferences → Track display**.

## Kênh và âm thanh đắm chìm

| Tính năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Số kênh mỗi tệp | + — tối đa 32 cho các định dạng PCM | + — tối đa 32 cho các định dạng PCM | ~ — bản đơn và bản stereo | + — tối đa 32 trong trình chỉnh sửa dạng sóng |
| Trộn âm thanh vòm | + — nền tối đa 7.1.4 | + — nền tối đa 7.1.4 | / | ~ — tối đa 5.1 |
| Âm thanh dựa trên đối tượng | + — đối tượng cùng với nền | + — đối tượng cùng với nền | / | / |
| Tạo và truyền qua ADM | + — BW64/ADM với kiểm tra tuân thủ | + — BW64/ADM với kiểm tra tuân thủ | / | / |
| Render nhị thính | + — một mô hình nhị thính có tên | + — một mô hình nhị thính có tên | / | ~ — bộ nhị thính hóa cho ambisonics |
| Ambisonics | / | / | / | + — bậc nhất, với bộ điều hướng VR |

## Xuất và phân phối

| Tính năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Đầu ra không tổn hao | + — ghi WAV, AIFF, BWF và BW64 gốc; FLAC và WavPack qua codec chuyên dụng | + — ghi WAV, AIFF, BWF và BW64 gốc; FLAC và WavPack qua codec chuyên dụng | + — WAV, AIFF và FLAC | + — WAV, AIFF, FLAC và nhiều hơn |
| Đầu ra có tổn hao | ~ — MP3, MP2, Opus và Ogg Vorbis; AAC tùy thuộc trình duyệt | + — MP3, MP2, Opus, Ogg Vorbis và AAC qua nhà cung cấp codec được hỗ trợ, gồm FFmpeg đã cấu hình | + — MP3, Opus và Ogg Vorbis; định dạng khác qua FFmpeg tùy chọn | ~ — MP2, MP3 và Ogg Vorbis; thêm định dạng qua Adobe Media Encoder, không có đích FFmpeg chung |
| Cài đặt bộ mã hóa tùy chỉnh | ~ — điều khiển theo định dạng; không hỗ trợ đối số FFmpeg tùy chỉnh | ~ — điều khiển theo định dạng; không hỗ trợ đối số FFmpeg tùy chỉnh | + — một mục tiêu FFmpeg tùy chỉnh | + — tùy chọn theo định dạng |
| Hàng đợi xuất | + — tạm dừng, hủy, thử lại và sắp xếp lại | + — tạm dừng, hủy, thử lại và sắp xếp lại | / — Export Multiple là một thao tác tuần tự, không phải hàng đợi tác vụ | ~ — Xử lý Hàng loạt không có kiểm soát hàng đợi |
| Stems và bản thay thế trong một lần | + — xếp hàng cùng với bản trộn | + — xếp hàng cùng với bản trộn | ~ — Export Multiple ghi riêng từng track nhưng không xếp bản phối và các bản render thay thế cùng hàng đợi | ~ — một lần hạ mix cho mỗi stem |
| Phân phối theo vùng | + — trình tự master với siêu dữ liệu theo vùng, khoảng trống và phai | + — trình tự master với siêu dữ liệu theo vùng, khoảng trống và phai | + — Export Multiple ghi mỗi vùng được gắn nhãn thành một tệp riêng | + — xuất đánh dấu vào các tệp riêng biệt |
| Chuẩn hóa độ lớn khi xuất | + — một phần của kế hoạch phân phối | + — một phần của kế hoạch phân phối | ~ — chạy hiệu ứng trước | + — Khớp Độ lớn |
| Dither và ánh xạ kênh | + — điều khiển rõ ràng | + — điều khiển rõ ràng | ~ — dither trong cài đặt | + — điều khiển rõ ràng |
| Báo cáo phân phối | + — liệt kê chi tiết theo công việc | + — liệt kê chi tiết theo công việc | / | / |
| Hàng đợi render tồn tại sau khi khởi động lại | / — khôi phục render liên tục cần Desktop | + — khởi động lại từ byte 0 bằng nhật ký sự cố | / | / |

Soundscaper Desktop có thể dùng FFmpeg đã cấu hình cho các định dạng xuất được hỗ trợ; trình chỉnh sửa hiện tại không cung cấp đối số FFmpeg tùy ý hoặc mọi bộ mã hóa FFmpeg. Xem [Định dạng xuất](/reference/generated/formats/) để biết các đích đã đăng ký. [Quy trình xuất của Audacity](https://www.audacityteam.org/manual/getting-started/export-your-audio/) bổ sung định dạng thông qua cài đặt FFmpeg tùy chọn. Audition cung cấp một bộ công cụ ghi tệp cố định và [chuyển tiếp sang Adobe Media Encoder](https://helpx.adobe.com/uk/audition/desktop/saving-and-exporting/saving-exporting-files1.html).

## Trao đổi với các công cụ khác

| Khả năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Dự án Audacity | + — nhập AUP, AUP3 và AUP4; xuất AUP3 và AUP4 kèm báo cáo tương thích | + — nhập AUP, AUP3 và AUP4; xuất AUP3 và AUP4 kèm báo cáo tương thích | + — nhập AUP, AUP3 và AUP4; xuất AUP4, không xuất AUP3 | / |
| Phiên Audition | / — nhập SESX cần Desktop | ~ — nhập âm thanh từ `.sesx` kèm báo cáo mục bị lược bỏ; không xuất được | / — bản dựng được ghim không hỗ trợ nhập SESX | + — gốc |
| EDL | ~ — xuất ở cấp CMX3600, không nhập | ~ — xuất ở cấp CMX3600, không nhập | / | / |
| OpenTimelineIO | ~ — chỉ xuất | ~ — chỉ xuất | / | / |
| FCPXML | ~ — chỉ xuất | ~ — chỉ xuất | / | + — nhập và xuất |
| DAWproject | + — nhập và xuất, kèm báo cáo trao đổi | + — nhập và xuất, kèm báo cáo trao đổi | / | / |
| OMF | / | / | / | ~ — nhập và xuất |
| Vòng lặp với trình chỉnh sửa video | ~ — chuyển cùng một dự án sang Framescaper mà không sao chép phương tiện | ~ — chuyển cùng một dự án sang Framescaper mà không sao chép phương tiện | / | + — Dynamic Link với Premiere Pro |
| Trao đổi nhãn và đánh dấu | + — nhập và xuất | + — nhập và xuất | + — nhập và xuất | + — danh sách đánh dấu |

Để nhập vào Soundscaper tệp `.sesx` có nguồn gốc từ Audition, xem [Tệp dự án](/projects-and-data/project-files/) để biết cài đặt âm thanh nào được chuyển và mục nào được báo cáo là bị lược bỏ.

## Video

| Khả năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Nhập video để tham chiếu | + — trên dòng thời gian, với âm thanh liên kết | + — trên dòng thời gian, với âm thanh liên kết | / | ~ — một дорожка video, chỉ xem trước |
| Chỉnh sửa dòng thời gian video | ~ — chỉnh sửa cơ bản, bề mặt đầy đủ là Framescaper | ~ — chỉnh sửa cơ bản, bề mặt đầy đủ là Framescaper | / | / |
| Xuất video | ~ — MP4 và WebM khi WebCodecs của trình duyệt hỗ trợ các codec cần thiết | + — MP4 và WebM với nhà cung cấp codec desktop đã xác minh | / | / — chỉ âm thanh |
| Tổng hợp, chỉnh màu và hiệu ứng | ~ — trong Framescaper, trên cùng một dự án | ~ — trong Framescaper, trên cùng một dự án | / | / |

## Hỗ trợ máy móc

Tính năng trợ lý trên Desktop được hỗ trợ sau khi cài trọng số mô hình tùy chọn và engine gốc tương ứng; các quy trình này không khả dụng trên Web. Model Manager cài đặt cả hai. Xem [Trợ lý cục bộ](/reference/generated/local-assistance/) để biết quy trình và mô hình hiện có.

| Khả năng | Soundscaper Web | Soundscaper Desktop | Audacity 4 | Audition |
| --- | --- | --- | --- | --- |
| Tăng cường giọng nói | / — chỉ có trợ lý trên Desktop | + — sau khi cài mô hình và engine tùy chọn | / | + — Enhance Speech |
| Chuyển văn bản và phân tách người nói | / — chỉ có trợ lý trên Desktop | + — sau khi cài các mô hình và engine tùy chọn | / | / — bản chuyển văn bản nằm trong Premiere Pro |
| Tách nguồn thành các stem | / — chỉ có trợ lý trên Desktop | + — sau khi cài mô hình và engine tùy chọn | / | / |
| Giảm âm tự động | + — hiệu ứng Auto Duck | + — hiệu ứng Auto Duck | + — hiệu ứng Auto Duck | + — giảm âm Essential Sound |
| Phát hiện nhịp và cảnh quay | / — phát hiện nhịp cần Desktop; phát hiện cảnh có trong Framescaper | ~ — phát hiện nhịp bằng mô hình tùy chọn; phát hiện cảnh có trong Framescaper | / | ~ — Remix tự động thay đổi thời gian của nhạc |
| Chạy hoàn toàn trên máy của bạn | + — xử lý cục bộ trong trình duyệt; không suy luận mô hình | + — xử lý cục bộ và suy luận ngoại tuyến sau khi cài mô hình | + — không có suy luận nào | ~ — một số tính năng xử lý trên đám mây của Adobe |
| Mô hình là tùy chọn và có thể gỡ bỏ | / — không cần cài mô hình trong Web | + — tải xuống riêng biệt, cố định bằng tiêu đề, có thể xóa | + — không có gì để cài đặt | / — được đóng gói cùng ứng dụng |

## Những khác biệt cộng lại là gì

Audacity 4 là trình chỉnh sửa một lượt. Bản dựng được ghim không có bus, send, làn tự động hóa track hoặc hiệu ứng, cũng không có macro. Đường bao gain clip cho phép tự động hóa âm lượng bên trong clip. Soundscaper giữ nguyên mô hình chỉnh sửa này và bổ sung tự động hóa track và hiệu ứng, phối âm và bàn giao, cùng các tính năng ghi âm, video và trao đổi mà Audacity không hướng đến.

Audition vẫn dẫn đầu về chiều sâu phục hồi, trao đổi hai chiều với Premiere Pro và ambisonics. Soundscaper nổi bật ở bàn giao âm thanh không gian, quản lý dự án và khả năng chạy trong trình duyệt trên phần cứng mà hai ứng dụng kia không hỗ trợ.

Nếu bạn đang dùng Audacity, hãy xem [Tệp dự án và trao đổi với Audacity](/projects-and-data/project-files/) để biết cách chuyển dự án.

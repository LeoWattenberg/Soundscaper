---
title: "Cách so sánh Soundscaper"
description: "So sánh Soundscaper với Audacity 4 và Adobe Audition về ghi âm, chỉnh sửa, phối âm, xuất bản và trao đổi."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"qwen3.8:latest","modelDigest":"22130167c4c20e20c7b71454612966ca8e8171e9b3cc8ab6ce8aa6cbfec79643"},"factPacketSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","model":"gpt-6-astra","modelProvider":"codex-session","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"71097403d87aba03cddc2ccd696ff9a8663268afba3a7bf750fe8d9913de3eba","targetLocale":"vi"} -->

Soundscaper triển khai lại Audacity 4 trên web và thêm một lớp sản xuất phía trên. Adobe Audition là công cụ hậu kỳ thương mại mà cả hai thường được so sánh. Trang này so sánh cả ba để bạn có thể xác định công cụ nào đã thực hiện được công việc bạn cần.

## Cách đọc trang này

Mỗi ô hiển thị **Có**, **Một phần**, hoặc **Không**, kèm theo chi tiết làm rõ điều đó.

**Một phần** bao gồm ba tình huống khác nhau, và ghi chú sẽ nêu rõ tình huống nào áp dụng: khả năng tồn tại nhưng hẹp hơn so với nơi khác, nó tồn tại nhưng phụ thuộc vào thứ gì đó mà bạn phải cung cấp, hoặc nó chỉ có thể đạt được bằng cách làm việc xung quanh sự vắng mặt.

Các hàng mô tả các khả năng, không phải các lệnh menu. Để biết danh sách lệnh chính xác, xem [Lệnh và phím tắt](/reference/generated/commands/), và để biết mỗi sản phẩm cho phép điều gì, xem
[Năng lực sản phẩm](/reference/generated/product-capabilities/).

### Nguồn gốc của các tuyên bố này

- Các hàng **Soundscaper** đến từ kho lưu trữ này: các hồ sơ năng lực sản phẩm, bảng kê hành động thời gian chạy và sổ đăng ký định dạng xuất. Các gói tải đích bản địa trên máy tính để bàn được tạo bởi CI của kho lưu trữ hoặc đóng gói đích. Một gói chỉ cho phép một khả năng sau khi chuẩn bị và xác minh kết quả khớp chính xác; các hàng đó nêu rõ khi nào vẫn cần một gói tải.
- Các hàng **Audacity 4** đến từ danh sách đầu nguồn được ghim trong kho lưu trữ này, `4.0.0` tại commit `4c177d43`. Một khả năng mà đầu nguồn đăng ký nhưng để tắt hoặc bình luận khỏi menu được ghi nhận như vậy, và một khả năng không có đăng ký trong bản dựng được ghim được báo cáo là không có trong bản dựng đó chứ không phải là vắng mặt vĩnh viễn.
- Các hàng **Audition** đến từ tài liệu công bố của Adobe cho bản phát hành hiện tại. Chúng không được xác minh đối với một bản dựng đang chạy.

## Nền tảng và thuật ngữ

| Khả năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Giấy phép | Có — AGPL-3.0-only | Có — GPL, mã nguồn mở | Không — độc quyền và đóng |
| Chi phí | Có — miễn phí | Có — miễn phí | Không — đăng ký Creative Cloud |
| Chạy trong trình duyệt | Có — Chromium, Firefox và WebKit | Không — chỉ trên máy tính để bàn | Không — chỉ trên máy tính để bàn |
| Bản dựng máy tính để bàn | Có — Windows và Linux trên x64 và ARM64, macOS trên ARM64 | Có — Windows, macOS, Linux | Một phần — Windows và macOS, không có Linux |
| Hoạt động không cần tài khoản | Có — không có tài khoản nào tồn tại | Có — chỉ đăng nhập cho audio.com | Không — yêu cầu đăng ký đã đăng nhập |
| Lưu trữ dự án trên đám mây | Không — bị loại trừ bởi thiết kế ưu tiên cục bộ | Có — lưu và chia sẻ thông qua audio.com | Một phần — tệp Creative Cloud, phiên không đồng bộ |
| Yêu cầu hệ thống | Có — chạy ở bất cứ nơi nào trình duyệt hiện tại chạy | Một phần — tăng đáng kể so với Audacity 3 | Một phần — cấp độ trạm làm việc chuyên nghiệp |

## Mô hình dự án và phiên

| Khả năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Định dạng dự án gốc | Có — `.sscape`, một bộ lưu trữ di động không mất dữ liệu | Có — `.aup4` | Có — `.sesx` |
| Mở các dự án Audacity | Có — nhập và xuất AUP4 | Có — bản địa | Không |
| Dòng thời gian clip không hủy hoại | Có | Có | Có — trình chỉnh sửa đa rãnh |
| Trình chỉnh sửa tệp đơn chuyên dụng | Một phần — chỉnh sửa mẫu diễn ra trong dòng thời gian | Một phần — các chỉnh sửa được áp dụng tại chỗ trong dòng thời gian | Có — trình chỉnh sửa dạng sóng |
| Nội dung đơn âm và stereo trên một rãnh | Có — một rãnh chứa một trong hai | Không — một rãnh là đơn âm hoặc stereo | Không — định dạng kênh được cố định cho mỗi rãnh |
| Thư mục rãnh lồng nhau | Có — bất kỳ độ sâu nào, có thể hoàn tác, với định tuyến | Không | Một phần — chỉ có bus submix, không có rãnh thư mục |
| Thùng dự án | Có — tổ chức tệp và đóng vai trò như bảng nhớ tạm | Không | Một phần — bảng Tệp liệt kê các tệp đang mở |
| Tự động lưu và khôi phục sau sự cố | Có — tự động lưu, khóa và bao khôi phục | Có | Có |
| Đánh dấu và vùng được đặt tên | Có — cấp độ đầu, với điều hướng và hành vi ripple | Một phần — rãnh nhãn | Có — đánh dấu và phạm vi |
| Bản đồ nhịp và chỉ số nhịp | Có — các bản đồ có thứ tự được giải quyết chính xác theo mẫu | Một phần — một nhịp và chỉ số nhịp cho dự án | Một phần — một nhịp cho phiên làm việc |

## Ghi âm

| Khả năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Ghi âm đa rãnh | Có — nhiều nguồn cùng lúc | Một phần — một thiết bị đầu vào tại một thời điểm | Có — các giao diện đa đầu vào và đa kênh |
| Âm thanh micro và âm thanh máy tính cùng lúc | Có — tích hợp sẵn | Không | Một phần — cần thiết bị vòng lặp của hệ điều hành |
| Ghi âm theo thời gian | Có | Có | Không |
| Ghi âm kích hoạt bằng âm thanh | Có — với ngưỡng có thể thiết lập | Có — với ngưỡng có thể thiết lập | Không |
| Đếm nhịp trước khi thu | Có — nhận thức bản đồ nhịp, xử lý nhịp phức hợp | Một phần — ghi âm phần dẫn nhập | Một phần — pre-roll như một phần của punch and roll |
| Ghi âm punch | Có — một giao dịch, bắt mặc định và định tuyến | Không | Có — punch and roll |
| Ghi âm vòng lặp vào các lần thu | Có — một làn cho mỗi lượt, được thêm vào cùng một nhóm | Không | Một phần — các lần thu trên một clip, được chọn từ danh sách |
| Comping các lần thu | Có — nghe thử, thăng cấp, chỉnh sửa vùng comp, làm phẳng như một chỉnh sửa có thể hoàn tác | Không | Không — không có trình chỉnh sửa comp |
| Giám sát và đo lường đầu vào | Có | Có | Có |

## Chỉnh sửa dòng thời gian

| Tính năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Các biến thể chỉnh sửa ripple | Có — theo từng clip, theo từng track và tất cả các track, khi cắt và xóa | Có — ba loại tương tự, khi cắt và xóa | Một phần — xóa ripple trên vùng chọn hoặc khoảng trống |
| Tách, ghép và tách tại các vùng im lặng | Có | Có | Một phần — tách và cắt, không có ghép clip |
| Nhóm clip | Có | Có | Có |
| Độ lợi clip | Có | Có | Có |
| Cao độ và tốc độ theo từng clip | Có — điều chỉnh, render hoặc đặt lại | Có — điều chỉnh, render hoặc đặt lại | Một phần — kéo giãn vẫn có thể chỉnh sửa, cao độ là một hiệu ứng |
| Theo dõi thay đổi nhịp độ | Có — các clip được kéo giãn khi bản đồ di chuyển | Có | Không |
| Lượng tử hóa và groove nhận biết nhịp | Có — bản đồ warp với cường độ groove có thể điều chỉnh | Không | Không |
| Hấp phụ vào các điểm cắt qua zero | Có | Có | Có |
| Vẽ ở cấp độ mẫu | Có | Một phần — không có hành động vẽ được đăng ký trong bản dựng cố định | Có — trong trình chỉnh sửa dạng sóng |
| Chỉnh sửa chỉ bằng bàn phím | Có — mọi nguyên thủy chỉnh sửa đều có hành động điều hướng | Có — mọi nguyên thủy chỉnh sửa đều có hành động điều hướng | Một phần — phím tắt mở rộng, một số bảng cần chuột |

## Công việc phổ biến và phục hồi

| Tính năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Xem biểu đồ phổ | Có — với cài đặt theo từng track | Có — với cài đặt theo từng track | Có — hiển thị tần số và cao độ |
| Chọn vùng giới hạn tần số | Có | Có | Có — khung chọn và lasso |
| Chổi phổ | Có | Có | Có — cọ vẽ và chữa vết đốm |
| Xóa hoặc khuếch đại một vùng phổ | Có — cả hai dưới dạng hành động trực tiếp | Có — cả hai dưới dạng hành động trực tiếp | Một phần — áp dụng hiệu ứng cho vùng chọn |
| Sửa chữa hư hỏng ngắn | Có — Sửa chữa | Có — Sửa chữa | Có — Chữa tự động và Chổi chữa vết đốm |
| Giảm nhiễu dải rộng | Có — với hồ sơ đã thu | Có — với hồ sơ đã thu | Có — Giảm nhiễu, Giảm nhiễu thích ứng, DeNoise |
| Xóa vang | Không | Không | Có — DeReverb |
| Công cụ xử lý tiếng click, tiếng ù và âm sắc | Một phần — chỉ có Xóa tiếng click | Một phần — chỉ có Xóa tiếng click | Có — DeClicker, DeHummer, DeEsser, Click/Pop Eliminator |
| Bảng chẩn đoán | Một phần — Tìm cắt đỉnh như một bộ phân tích | Một phần — Tìm cắt đỉnh như một bộ phân tích | Có — chẩn đoán với sửa chữa theo từng vấn đề |

## Hiệu ứng và plug-in

| Tính năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Bộ hiệu ứng tích hợp | Có — 30 hiệu ứng Audacity, các plug-in Nyquist được đóng gói và các hiệu ứng bên thứ nhất không có tương đương upstream, chẳng hạn như bitcrusher | Có — bộ sưu tập tích hợp 30 hiệu ứng tương tự | Có — khoảng năm mươi, bao gồm động lực đa dải |
| Giá đỡ hiệu ứng thời gian thực cho mỗi track | Có — bộ hiệu ứng thời gian thực rộng hơn upstream | Có | Có — mười sáu slot cho mỗi clip, track và master |
| EQ tham số | Có — EQ tham số mới với các dải có thể tự động hóa | Một phần — Filter Curve và Graphic EQ | Có — bộ lọc tham số, đồ họa và FFT |
| Preset hiệu ứng | Có — áp dụng, lưu, nhập, xuất | Có — áp dụng, lưu, nhập, xuất | Có |
| Macro và chuỗi hàng loạt | Có — thư viện macro đã lưu với các mẫu | Không — bản dựng cố định đã chú thích tắt menu Macros | Có — Favorites và Batch Process |
| Định dạng plug-in bên thứ ba | Một phần — VST3, CLAP, AU, LV2 và hiệu ứng LADSPA trên Linux cùng bộ phân tích Vamp trên desktop sau sự đồng ý và cách ly; không có trong trình duyệt | Có — VST3, AU, LV2 và Nyquist, với trình quản lý plug-in | Một phần — VST3 và AU trên macOS, không có CLAP hoặc LV2 |
| Lập trình Nyquist | Có — plug-in được đóng gói và prompt Nyquist | Có — plug-in được đóng gói và prompt Nyquist | Không |
| Gói hiệu ứng được cách ly | Một phần — các gói WebAssembly đã được xem xét, một gói được phát hành và các gói bên ngoài bị rào chắn | Không | Không |
| Nhạc cụ ảo | Không — sau 1.0 | Không | Không |

## Trộn, định tuyến và tự động hóa

| Tính năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Bộ trộn với dải kênh | Có | Một phần — điều khiển track và track master | Có |
| Bus và submix | Có — lồng nhau, với xác minh chu kỳ | Không | Có — track bus |
| Sends | Có — trước và sau fader, nhiều gán | Không | Có — trước và sau fader |
| Nhóm VCA | Có | Không | Không |
| Đầu vào sidechain | Có | Không | Có — thông qua sends |
| Trộn cue và phòng điều khiển | Có | Không | Không |
 | Bù trễ plug-in | Có — phát, giám sát, bus, sidechain, render và freeze | Một phần — không được hiển thị trong các nguồn cố định | Có |
| Làn tự động hóa | Có — gain, pan, mute, sends, bus và tham số plug-in | Không — không có làn và không có công cụ envelope trong bản dựng cố định | Có — âm lượng, pan và tham số hiệu ứng |
| Chế độ tự động hóa | Có — đọc, trim, chạm, latch và ghi | Không | Một phần — đọc, ghi, latch và chạm, không có trim |
| Hình dạng đường cong | Có — đường thẳng, giữ và đường cong | Không | Có — tuyến tính và spline |
| Đóng băng track | Có — đóng băng, bỏ đóng băng và cam kết mà không mất trạng thái | Không | Một phần — bounce sang track mới |

## Đo lường và phân tích

| Tính năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Đồng hồ đo độ lớn | Có — kiểu EBU R 128, có lịch sử | Không — có hiệu ứng Chuẩn hóa Độ lớn nhưng không có đồng hồ đo | Có — Radar Độ lớn theo ITU-R BS.1770 |
| Đồng hồ đo pha và tương quan | Có | Không | Có — đồng hồ đo pha và phân tích |
| Đo lường âm thanh vòm | Có | Không | Một phần — tối đa 5.1 |
| Biểu đồ phổ | Có — Vẽ Phổ | Một phần — đã đăng ký, nhưng bản dựng cố định đã chú thích tắt khỏi menu Phân tích | Có — Phân tích Tần số |
| Bão hòa và RMS trong dạng sóng | Có — cả hai, bật/tắt theo dự án | Có — cả hai, bật/tắt theo dự án | Một phần — chỉ báo bão hòa, RMS trong Thống kê Biên độ |
| Tương phản độ rõ của giọng nói | Có — Bộ phân tích Tương phản | Một phần — đã đăng ký, nhưng bản dựng cố định đã chú thích tắt khỏi menu Phân tích | Không |

## Kênh và âm thanh đắm chìm

| Tính năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Số kênh mỗi tệp | Có — tối đa 32 cho các định dạng PCM | Một phần — bản đơn và bản stereo | Có — tối đa 32 trong trình chỉnh sửa dạng sóng |
| Trộn âm thanh vòm | Có — nền tối đa 7.1.4 | Không | Một phần — tối đa 5.1 |
| Âm thanh dựa trên đối tượng | Có — đối tượng cùng với nền | Không | Không |
| Tạo và truyền qua ADM | Có — BW64/ADM với kiểm tra tuân thủ | Không | Không |
| Render nhị thính | Có — một mô hình nhị thính có tên | Không | Một phần — bộ nhị thính hóa cho ambisonics |
| Ambisonics | Không | Không | Có — bậc nhất, với bộ điều hướng VR |

## Xuất và phân phối

| Tính năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Đầu ra không tổn hao | Có — WAV, AIFF, BWF và BW64 được ghi bản địa | Có — WAV, AIFF và FLAC | Có — WAV, AIFF, FLAC và nhiều hơn |
| Đầu ra có tổn hao | Một phần — MP3, AAC, Opus, Vorbis, MP2, FLAC và WavPack, tất cả thông qua thời gian chạy FFmpeg | Một phần — MP3 tích hợp sẵn, phần còn lại thông qua cài đặt FFmpeg tùy chọn | Có — tích hợp sẵn |
| Cài đặt bộ mã hóa tùy chỉnh | Có — một mục tiêu FFmpeg tùy chỉnh | Có — một mục tiêu FFmpeg tùy chỉnh | Có — tùy chọn theo định dạng |
| Hàng đợi xuất | Có — tạm dừng, hủy, thử lại và sắp xếp lại | Không — một lần xuất một | Một phần — Xử lý Hàng loạt không có kiểm soát hàng đợi |
| Stems và bản thay thế trong một lần | Có — xếp hàng cùng với bản trộn | Không | Một phần — một lần hạ mix cho mỗi stem |
| Phân phối theo vùng | Có — trình tự master với siêu dữ liệu theo vùng, khoảng trống và phai | Một phần — xuất nhãn, không có xuất nhiều tệp trong bản dựng cố định | Có — xuất đánh dấu vào các tệp riêng biệt |
| Chuẩn hóa độ lớn khi xuất | Có — một phần của kế hoạch phân phối | Một phần — chạy hiệu ứng trước | Có — Khớp Độ lớn |
| Dither và ánh xạ kênh | Có — điều khiển rõ ràng | Một phần — dither trong cài đặt | Có — điều khiển rõ ràng |
| Báo cáo phân phối | Có — liệt kê chi tiết theo công việc | Không | Không |
| Hàng đợi render tồn tại sau khi khởi động lại | Có — trên desktop, khởi động lại từ byte zero với nhật ký sự cố | Không | Không |

## Trao đổi với các công cụ khác

| Khả năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Dự án Audacity | Có — nhập và xuất AUP4, kèm báo cáo các phần bị bỏ sót | Có — bản địa | Không |
| EDL | Một phần — xuất ở cấp CMX3600, không nhập | Không | Không |
| OpenTimelineIO | Một phần — chỉ xuất | Không | Không |
| FCPXML | Một phần — chỉ xuất | Không | Có — nhập và xuất |
| DAWproject | Có — nhập và xuất, kèm báo cáo trao đổi | Không | Không |
| OMF | Không | Không | Một phần — nhập và xuất |
| Vòng lặp với trình chỉnh sửa video | Một phần — chuyển cùng một dự án sang Framescaper mà không sao chép phương tiện | Không | Có — Dynamic Link với Premiere Pro |
| Trao đổi nhãn và đánh dấu | Có — nhập và xuất | Có — nhập và xuất | Có — danh sách đánh dấu |

## Video

| Khả năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Nhập video để tham chiếu | Có — trên dòng thời gian, với âm thanh liên kết | Không | Một phần — một дорожка video, chỉ xem trước |
| Chỉnh sửa dòng thời gian video | Một phần — chỉnh sửa cơ bản, bề mặt đầy đủ là Framescaper | Không | Không |
| Xuất video | Có — MP4 và WebM thông qua thời gian chạy FFmpeg | Không | Không — chỉ âm thanh |
| Tổng hợp, chỉnh màu và hiệu ứng | Một phần — trong Framescaper, trên cùng một dự án | Không | Không |

## Hỗ trợ máy móc

| Khả năng | Soundscaper | Audacity 4 | Audition |
| --- | --- | --- | --- |
| Tăng cường giọng nói | Một phần — chỉ trên máy để bàn, sau khi cài đặt gói mô hình | Không | Có — Enhance Speech |
| Chuyển văn bản và phân tách người nói | Một phần — chỉ trên máy để bàn, mô hình tùy chọn | Không | Không — bản chuyển văn bản nằm trong Premiere Pro |
| Tách nguồn thành các stem | Một phần — chỉ trên máy để bàn, mô hình tùy chọn | Không | Không |
| Giảm âm tự động | Có — hiệu ứng Auto Duck | Có — hiệu ứng Auto Duck | Có — giảm âm Essential Sound |
| Phát hiện nhịp và cảnh quay | Một phần — chỉ trên máy để bàn, mô hình tùy chọn | Không | Một phần — Remix tự động thay đổi thời gian của nhạc |
| Chạy hoàn toàn trên máy của bạn | Có — suy luận chỉ trên máy để bàn và ngoại tuyến sau khi cài đặt | Có — không có suy luận nào | Một phần — một số tính năng xử lý trên đám mây của Adobe |
| Mô hình là tùy chọn và có thể gỡ bỏ | Có — tải xuống riêng biệt, cố định bằng tiêu đề, có thể xóa | Có — không có gì để cài đặt | Không — được đóng gói cùng ứng dụng |

## Những khác biệt cộng lại là gì

Audacity 4 là trình chỉnh sửa một lượt. Nó không có bus, không có sends, không có làn tự động hóa và không có macro trong bản dựng cố định. Soundscaper giữ nguyên mô hình chỉnh sửa đó và thêm lớp trộn, tự động hóa và phân phối lên trên, cùng với ghi âm, video và công việc trao đổi mà Audacity không thử thực hiện.

Audition vẫn dẫn đầu về độ sâu phục hồi, về vòng lặp với Premiere Pro và về âm thanh vòm. Nơi Soundscaper dẫn đầu là phân phối đắm chìm, xử lý dự án và thực tế là nó chạy trong trình duyệt trên phần cứng mà cả hai sản phẩm kia đều không hỗ trợ.

Nếu bạn đã làm việc trong Audacity, hãy xem
[tệp dự án và trao đổi với Audacity](/projects-and-data/project-files/) để
biết cách chuyển một dự án sang.

---
title: "Chỉnh sửa, phối âm và xuất tệp"
description: "Sắp xếp clip, cân bằng track, áp dụng hiệu ứng và tạo tệp bàn giao."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"eaa07736d9143de912e22bd2c5d4a8db4f1553c1052d247826240cda8c6af620","targetLocale":"vi"} -->

## Sắp xếp clip

Chọn clip hoặc một khoảng thời gian trước khi chọn lệnh chỉnh sửa. Tách sẽ tạo
ranh giới chỉnh sửa tại đầu phát. Các biến thể giữ khoảng trống hoặc ripple
quyết định nội dung phía sau có giữ nguyên vị trí hay di chuyển để lấp vùng đã
bị xóa.

Dùng thư mục track, nhóm clip và Project Bin để tổ chức các dự án lớn.

### Điều chỉnh fade của clip {#clip-fades}

Chọn clip âm thanh để hiện các tay nắm hình tam giác nhỏ dọc mép trên dạng sóng,
ngay bên dưới tiêu đề clip.
Kéo tam giác bên trái vào trong để tạo fade-in hoặc tam giác bên phải vào
trong để tạo fade-out. Dạng sóng thay đổi khi kéo và vùng phía trên đường cong
fade tối hơn. Các tam giác bám theo ranh giới fade; kéo một tay nắm trở lại góc
của nó sẽ xóa fade đó. Chỉ clip bạn kéo thay đổi, kể cả khi đang chọn nhiều
clip.

Tay nắm biến mất khi bỏ chọn clip, nhưng dạng sóng đã fade và phần tô bóng vẫn
còn. Fade giữ nguyên âm thanh gốc và vẫn điều chỉnh được sau khi lưu rồi mở lại
dự án. Thả chuột để áp dụng fade hoặc nhấn **Escape** khi đang kéo để hủy.
**Hoàn tác** đảo ngược một lần kéo hoàn chỉnh. Phát và xuất dùng các cài đặt
fade đã áp dụng.

Khi clip được chọn đang có tiêu điểm, nhấn **Tab** để tới các tay nắm fade.
Phím mũi tên điều chỉnh thời lượng 10 mili giây hoặc 100 mili giây khi giữ
**Shift**. **Home** xóa fade; **End** kéo fade dài hết clip. Để nhập số, chọn
**Chỉnh sửa → Clip âm thanh → Thuộc tính clip** rồi dùng **Fade**.

## Tạo bản phối

Dùng điều khiển gain, pan, mute và solo của track để cân bằng dự án. Bảng Mixer
hiển thị cùng trạng thái dự án trong bố cục dành cho phối âm. Hiệu ứng thời
gian thực vẫn điều chỉnh được; thao tác phá hủy hoặc kết xuất tạo thay đổi dự
án có thể hoàn tác khi lịch sử còn khả dụng.

Dùng đồng hồ phát và phân tích độ lớn để kiểm tra kết quả. Không xem mục tiêu
trên đồng hồ là phương án thay thế cho việc nghe toàn bộ tệp xuất.

### Giảm âm xì {#reduce-sibilance}

Chọn **Hiệu ứng → Loại bỏ tiếng ồn và sửa chữa → De-esser**. Đặt **Tần số** gần
phần chói của giọng nói, rồi giảm **Ngưỡng** cho đến khi âm xì dịu xuống.
**Mức giảm tối đa** giới hạn độ cắt; hãy bắt đầu khoảng 6–9 dB. **Attack** ngắn
hơn bắt được phần đầu phụ âm, còn **Release** quyết định tốc độ phục hồi của
tần số cao. Chỉ dải trên bị giảm.

### Nén riêng các dải tần số {#multiband-compression}

Chọn **Hiệu ứng → Âm lượng và nén → Bộ nén đa băng tần**. Hai điểm cắt chia tín
hiệu thành dải thấp, trung và cao. Mỗi dải có ngưỡng, tỷ lệ và gain đầu ra
riêng. Tỷ lệ 1 giữ nguyên dải động của dải đó. Attack và release áp dụng cho
cả ba dải. Các điểm cắt có độ dốc nhẹ, chồng lấn 6 dB/octave; khi mọi tỷ lệ
bằng 1 và gain của các dải bằng 0 dB, tín hiệu gốc đi qua không đổi.

Cả hai hiệu ứng liên kết các kênh để giữ cân bằng stereo và cũng có trong rack
hiệu ứng của track và master. Cài đặt rack được lưu cùng dự án và có thể điều
chỉnh khi phát. **Áp dụng cho vùng chọn** kết xuất hiệu ứng vào âm thanh đã
chọn và hỗ trợ Hoàn tác. Hai hiệu ứng này không có tự động hóa dòng thời gian.

### Dùng hiệu ứng LADSPA và bộ phân tích Vamp {#native-audio-plugins}

Ứng dụng desktop chỉ quét plug-in bên thứ ba sau khi bạn cho phép định dạng và
một thư mục của định dạng đó trong **Hiệu ứng → Trình quản lý plug-in**. Việc
quét không bao giờ tự động. Cho phép từng bản cài đặt được tìm thấy trước khi
dùng và chỉ cài plug-in mà bạn tin tưởng: plug-in gốc chạy mã thực thi dù
Soundscaper lưu trữ chúng trong tiến trình trợ giúp được giám sát.

Hiệu ứng LADSPA có trên Linux. Sau khi bật trong trình quản lý, mở hiệu ứng từ
**Hiệu ứng → Plug-in âm thanh**. Soundscaper tạo các điều khiển từ cổng LADSPA
vì định dạng này không có giao diện của nhà cung cấp. Các giá trị điều khiển
và trạng thái bật hoặc bỏ qua hiệu ứng được lưu cùng dự án.

Plug-in Vamp phân tích âm thanh thay vì thay đổi âm thanh. Sau khi bật một bản
cài Vamp, chọn track âm thanh để phân tích track đó hoặc bỏ chọn toàn bộ track
âm thanh để phân tích bản phối master. Vùng chọn thời gian sẽ giới hạn phân
tích; nếu không, Soundscaper dùng toàn bộ dự án. Chọn **Phân tích → Plug-in
Vamp**, chọn đầu ra và cài đặt của bộ phân tích rồi chạy. Soundscaper chỉ thêm
các mốc thời gian trả về thành track nhãn mới sau khi toàn bộ phân tích thành
công, vì vậy việc hủy hoặc thay đổi dự án không để lại nhãn dở dang.

## Xuất

Chọn **Tệp → Xuất âm thanh** để tạo bản bàn giao đã phối hoặc **Xuất âm thanh đã
chọn** nếu chỉ cần kết xuất vùng chọn. Soundscaper cũng có thể xuất stems và
nhãn.

Định dạng nén dùng runtime FFmpeg. Các định dạng chính xác và khả năng sẵn có
có điều kiện được liệt kê trong [tài liệu tham khảo định dạng được tạo tự động](/reference/).

Phát tệp đã xuất bằng ứng dụng khác trước khi bàn giao hoặc xóa tài liệu nguồn.

Để làm việc với hình ảnh — ghép chuỗi, hiệu ứng video và xuất MP4 hoặc WebM —
chuyển dự án sang [Framescaper](/framescaper/) và xem [xuất video](/framescaper/video-export/).

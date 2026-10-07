---
title: "Chỉnh sửa, phối âm và xuất tệp"
description: "Sắp xếp clip, cân bằng track, áp dụng hiệu ứng và tạo tệp bàn giao."
sidebar:
  order: 4
---
<!-- docs-ai-provenance: {"factPacketSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3069846c51779ae315d018496e4b6d8adf592d57e05ec127856039375f3caf98","targetLocale":"vi"} -->

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

### Chỉnh sửa nguồn của clip {#clip-source-properties}

Chọn **Chỉnh sửa → Clip âm thanh → Thuộc tính clip** để mở trình chỉnh sửa nguồn. Bản ghi đầy đủ xuất hiện phía sau clip. Kéo các mép clip để thay đổi điểm bắt đầu và thời lượng nguồn, đồng thời giữ nguyên điểm bắt đầu của clip trên dòng thời gian dự án. Ngăn **Chuẩn hóa** chứa khuếch đại clip và các thao tác về đỉnh, độ lớn âm thanh.

Mở **Cao độ và nhịp độ** rồi chọn **Liên kết cao độ và nhịp độ** để thay đổi tốc độ và cao độ cùng lúc. Tỷ lệ tốc độ `1` và thay đổi cao độ `0%` không làm đổi âm thanh. Tỷ lệ `2` phát nhanh gấp đôi và cao hơn một quãng tám; `0.5` phát bằng nửa tốc độ và thấp hơn một quãng tám. Chỉnh một điều khiển đã liên kết sẽ cập nhật điều khiển còn lại. Bỏ liên kết sẽ khôi phục cài đặt cao độ độc lập mà vẫn giữ tỷ lệ tốc độ hiện tại.

**Ctrl+nhấp** vào dạng sóng để thêm điểm đánh dấu kéo giãn gắn với mẫu nguồn đó. Kéo điểm đánh dấu sẽ thay đổi thời gian ở cả hai phía; lớp phủ hiển thị cả hai tốc độ phát. Điều khiển clip vẫn áp dụng riêng cho từng clip. Chọn âm thanh nguồn rồi áp dụng hiệu ứng sẽ cập nhật mọi clip dùng nguồn đó.

### Chỉnh sửa clip trong bảng tính {#clip-spreadsheet}

Chọn **Chế độ xem → Bảng → Bảng tính clip** để xem mọi clip trong dự án. Bảng mở bên dưới dòng thời gian. Dùng menu bảng để chuyển sang vùng gắn khác, tách thành cửa sổ nổi hoặc đóng. Kích thước và vị trí được lưu cùng không gian làm việc. Mỗi hàng hiển thị rãnh, vị trí trên dòng thời gian, tệp nguồn, độ lệch nguồn, thời lượng, cao độ, tốc độ, khuếch đại, fade và tùy chọn phát. Thời gian tính bằng giây, cao độ tính bằng nửa cung, còn tốc độ là tỷ lệ: `1` là tốc độ bình thường và `2` là gấp đôi.

Nhấp đúp vào ô hoặc chọn ô rồi nhấn **Enter** để sửa giá trị. Nhấn **Enter** để áp dụng hoặc **Escape** để hủy. Ô rãnh và nguồn hiển thị ID thực. Thay ID rãnh để chuyển clip sang rãnh âm thanh hiện có. Thay ID nguồn hoặc nhập đường dẫn tệp cục bộ để thay âm thanh, đồng thời giữ nguyên vị trí dòng thời gian, thời lượng, tốc độ và độ lệch nguồn tính bằng giây. Tệp mới phải chứa phạm vi nguồn đã chỉ định. **Đảo chiều** và **Đảo pha** là hộp kiểm; chọn ô rồi nhấn **Phím cách** để bật hoặc tắt. Clip trên rãnh khóa và clip video chỉ đọc.

Thay đổi thời lượng sẽ cắt ngắn hoặc kéo dài phạm vi nguồn từ độ lệch hiện tại. Thay đổi tốc độ giữ nguyên phạm vi nguồn, trừ khi bạn dán cả thời lượng. Bỏ nhóm hoặc hủy liên kết clip trước khi thay đổi thời gian tại đây; chỉnh thời gian của clip đã kéo giãn trong trình chỉnh sửa nguồn.

Chọn một ô, kéo qua phạm vi hoặc **Shift+nhấp** vào ô khác để mở rộng lựa chọn. Nhấp số hàng hoặc tiêu đề cột để chọn toàn bộ hàng hoặc cột. Dùng **Ctrl+C** và **Ctrl+V** (**Cmd+C** và **Cmd+V** trên macOS) để trao đổi lựa chọn với bảng tính. Cột được phân tách bằng tab, hàng bằng dòng mới. Thao tác dán bắt đầu ở ô được chọn và cập nhật clip hiện có. Dán vượt quá các hàng hiện có sẽ bị từ chối. Khi có vùng chọn, nhấn **Escape** hoặc nhấp vào khoảng trống bên dưới bảng để bỏ chọn. Khi không có vùng chọn, thao tác dán chèn hàng mới, kể cả trong dự án trống. Tùy chọn phát được sao chép dưới dạng `true` hoặc `false` và chấp nhận các giá trị này khi dán. Hàng mới theo thứ tự cột của bảng và cần tên tệp nguồn hoặc ID nguồn. Tên rãnh hiện có và duy nhất sẽ đặt clip vào rãnh đó; tên mới tạo rãnh âm thanh. Tên rãnh trống dùng tên nguồn. Ô số trống dùng giá trị mặc định: vị trí và độ lệch `0`, tốc độ `1`, cao độ và khuếch đại `0`, không có fade. Thời lượng trống dùng phần âm thanh còn lại ở tốc độ đã yêu cầu.

Bảng tìm nguồn trong dự án trước, bao gồm Thùng dự án. Nếu không có, chọn **Tải các tệp được tham chiếu** rồi chọn các tệp âm thanh được liệt kê trong hộp thoại. Đường dẫn trên đĩa cũng cần chọn tệp theo cách này: dán đường dẫn không cấp quyền truy cập tệp cho ứng dụng. Các tệp đã chọn phải khớp duy nhất với tên được tham chiếu. Bảng nhập âm thanh, xác thực giới hạn nguồn và thuộc tính clip, rồi đặt clip mới vào vị trí chỉ định. **Ctrl+Z** (**Cmd+Z** trên macOS) hoàn tác toàn bộ thao tác dán trong một bước; **Ctrl+Shift+Z** (**Cmd+Shift+Z**) làm lại. Nếu thao tác dán chứa giá trị không hợp lệ, clip sẽ không thay đổi.

## Tạo bản phối

Dùng điều khiển gain, pan, mute và solo của track để cân bằng dự án. Bảng Mixer
hiển thị cùng trạng thái dự án trong bố cục dành cho phối âm. Hiệu ứng thời
gian thực vẫn điều chỉnh được; thao tác phá hủy hoặc kết xuất tạo thay đổi dự
án có thể hoàn tác khi lịch sử còn khả dụng.

Dùng đồng hồ phát và phân tích độ lớn để kiểm tra kết quả. Không xem mục tiêu
trên đồng hồ là phương án thay thế cho việc nghe toàn bộ tệp xuất.

### Nghe các tần số đã chọn {#listen-to-selected-frequencies}

Chọn đoạn muốn nghe. Trong menu rãnh, chọn **Hiển thị rãnh → Phổ đồ**, rồi mở **Tùy chọn phổ đồ → Chọn phạm vi tần số phổ**. Nhập tần số tối thiểu và tối đa rồi chọn **Chọn phạm vi**, hoặc điều chỉnh tay nắm lựa chọn trên phổ đồ.

Chọn **Tùy chọn phát → Phát các tần số đã chọn** hoặc **Chọn → Phổ → Phát các tần số đã chọn**. Phạm vi thời gian đã chọn phát một lần ở tốc độ bình thường, ngay cả khi trước đó đã chọn tốc độ khác hoặc phát lặp. Bộ lọc nghe áp dụng cho bản phối hiện tại, gồm các cài đặt tắt tiếng, solo, khuếch đại và hiệu ứng. Hình chữ nhật phổ đánh dấu dải tần và phạm vi thời gian nhưng không đặt rãnh ở chế độ solo. Nếu đang phát, lệnh sẽ tạm dừng; chọn lại lệnh để bắt đầu nghe thử dải tần.

Bộ lọc tần số thời gian thực có cạnh chuyển tiếp mềm. Tần số ngoài dải và gần ranh giới có thể nhỏ đi. **Tạm dừng** hoặc **Dừng** sẽ bỏ bộ lọc để lần phát bình thường tiếp theo dùng toàn bộ dải tần. Âm thanh, lựa chọn, lịch sử hoàn tác và tệp đã xuất không thay đổi.

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

### Xuất clip thành các tệp riêng biệt {#export-clips}

Chọn **Tệp → Xuất âm thanh** và đặt **Đầu ra** thành **Clip riêng lẻ (tách theo clip)**. Chọn định dạng âm thanh rồi nhấn **Xuất** để tải xuống một gói lưu trữ chứa một tệp cho mỗi clip âm thanh trên các rãnh âm thanh của dự án. Mỗi tệp bắt đầu tại đầu clip có thể nghe được và kết thúc ở cuối clip, không đệm đến hết dòng thời gian dự án hay thêm phần đuôi hiệu ứng. Các thao tác cắt, khuếch đại clip, làm mờ dần và chỉnh tốc độ, cao độ đều được áp dụng. Các clip chồng lấn vẫn tách riêng.

Tệp dùng tên clip với tiền tố số. Ký tự tên tệp không được hỗ trợ sẽ bị thay thế, còn số giúp phân biệt các clip trùng tên. Hiệu ứng rãnh được bao gồm; hiệu ứng chính, tắt tiếng và solo không ảnh hưởng đến lần xuất này. Hãy bỏ đóng băng các rãnh đã đóng băng trước khi xuất riêng từng clip có thể chỉnh sửa.

Định dạng nén dùng runtime FFmpeg. Các định dạng chính xác và khả năng sẵn có
có điều kiện được liệt kê trong [tài liệu tham khảo định dạng được tạo tự động](/reference/).

### Nhúng nhãn chương {#embedded-chapters}

Trong trình chỉnh sửa trên trình duyệt, chọn **Tệp → Xuất âm thanh**, chọn **MP3** hoặc **AAC / M4A**, rồi bật **Nhúng nhãn làm chương** trong **Tùy chọn âm thanh**. Tùy chọn này mặc định tắt và thêm tiêu đề, thời gian nhãn vào một tệp phối duy nhất. Hãy thêm nhãn trước khi xuất; stem, tách chương và chuỗi mastering không có tùy chọn này.

Chỉ nhãn giao với phạm vi bàn giao mới được đưa vào. Khi xuất vùng chọn, thời gian chương được dịch về đầu tệp tạo ra. MP3 giữ thời gian kết thúc của nhãn vùng; nhãn điểm kết thúc ở chương tiếp theo hoặc cuối tệp. M4A lưu thời điểm bắt đầu chương, mỗi chương kéo dài đến lần bắt đầu kế tiếp hoặc cuối tệp. M4A hỗ trợ tối đa 255 chương và 255 byte UTF-8 cho mỗi tiêu đề. Việc trình phát có hiển thị chương nhúng hay không tùy thuộc trình phát.

Phát tệp đã xuất bằng ứng dụng khác trước khi bàn giao hoặc xóa tài liệu nguồn.

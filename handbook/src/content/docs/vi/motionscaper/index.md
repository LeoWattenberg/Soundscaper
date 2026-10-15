---
title: "Motionscaper"
description: "Tạo bố cục có hoạt ảnh và giữ dự án chuyển động có thể chỉnh sửa trên thiết bị."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"ed51081d6c085d719a1e150a4eec6012c91a3221efb5e977edb22705f2ff23e1","targetLocale":"vi"} -->

Motionscaper là trình biên tập đồ họa chuyển động trong họ Scaper. Dự án
chứa các bố cục, lớp, hoạt ảnh và phương tiện được giữ lại. Phần mở rộng tệp
dự án là `.mscape`.

Đây là bản phát hành đang phát triển. Hãy bắt đầu bằng bản sao của tư liệu nguồn quan trọng
và giữ các kho lưu trữ dự án đã xuất cùng thư viện làm việc.

## Bắt đầu bố cục {#start-a-composition}

Chọn **Tệp → Bố cục mới**. Menu **Lớp** mở công cụ văn bản, hình dạng,
hoạt ảnh, ghép lớp, theo dõi, biểu thức và cảnh 3D. **Xem →
Xem trước bố cục** mở phần phát; các giao diện chỉnh sửa mới xuất hiện khi bạn
chọn chúng từ menu.

Chọn **Xem → Khung vẽ bố cục** để chọn, di chuyển, thay đổi tỉ lệ hoặc xoay lớp có
biến đổi 2D tĩnh. Biến đổi có hoạt ảnh vẫn chỉnh sửa được qua công cụ thuộc tính
và dòng thời gian.

Trong **Xem → Dòng thời gian**, chọn các lớp hiện có để đổi tên, bật, tắt hoặc
xóa. Đổi tên giữ các tham chiếu thuộc tính và hoạt ảnh. Xóa một
lớp vẫn giữ phương tiện gốc của nó; bao gồm các lớp phụ thuộc hoặc gỡ
liên kết của chúng trước. **Huỷ bỏ** khôi phục các lớp đã xóa. Lớp video được chọn cũng
có ô chọn âm thanh khi nguồn được giữ chứa âm thanh.

Làm theo [dự án chuyển động đầu tiên của bạn](/motionscaper/first-project/) để tạo,
làm hoạt ảnh, lưu và kết xuất bố cục.

## Lưu và bàn giao {#save-and-deliver}

**Tệp → Lưu** công bố một bản sửa đổi đã lưu. **Lưu bản sao** xuất trạng thái
hiện tại thành kho lưu trữ `.mscape` mà không công bố bản sửa đổi đã lưu mới.
Phương tiện và phông chữ gốc đã nhập đi cùng kho lưu trữ. **Thư viện
dự án** mở các dự án được giữ trên thiết bị này.

**Tệp → Kết xuất** cung cấp các khung hình PNG trong suốt trong kho TAR,
video MP4 hoặc WebM không trong suốt và ProRes 4444 khi có bộ mã hóa máy tính.
Chuỗi PNG không có âm thanh. Video trong trình duyệt giữ âm thanh đã tạo khi
bộ mã hóa hỗ trợ định dạng được yêu cầu. ProRes trong ứng dụng máy tính báo độ chính xác hiệu dụng
của màu và alfa trong hộp thoại kết xuất. **Tệp → Hàng đợi kết xuất** giữ các
tác vụ khi đóng hộp thoại hoặc đổi dự án. Nó giữ tối đa tám
tác vụ và 128 MiB bản tải trong trình duyệt; mỗi bản tải nhận tối đa 64 MiB. Chọn
đích tệp ghi theo luồng cho đầu ra lớn hơn và xóa tác vụ hoàn tất để
giải phóng bản tải được giữ. Nếu dọn dẹp đầu ra của ứng dụng máy tính thất bại, dùng **Thử lại dọn dẹp
đầu ra** trong hàng đợi này. Tác vụ giữ đích cho đến khi dọn dẹp thành công;
sau đó bạn có thể xóa tác vụ hoặc thử lại bản sửa đổi đã gửi với đích mới.

## Liên kết với Framescaper {#link-to-framescaper}

Bố cục được liên kết yêu cầu dòng phát triển Framescaper 1.1 riêng.
Trong hộp thoại **Tệp → Bố cục được liên kết** của nó, tạo URL ghép nối. Dán URL
vào hộp thoại **Tệp → Gửi bố cục tới Framescaper** của Motionscaper, kết nối
và giữ các trình biên tập cùng cửa sổ cầu nối mở. Các lần **Lưu** sau tự động gửi
bản sửa đổi mới; **Lưu bản sao** không làm vậy.

Framescaper giữ mọi bản sửa đổi được chấp nhận cùng toàn bộ phương tiện cần thiết để
dùng ngoại tuyến. Huỷ bỏ ghim một bản sửa đổi trước cho đến khi bạn tiếp tục cập nhật. Thay đổi
kích thước đầu ra, thời gian hoặc lưới âm thanh yêu cầu xem xét Đối chiếu rõ ràng.
Trình nhận trên máy tính có thể thay vào đó theo dõi tệp `.mscape` đã lưu mà bạn chọn.

## Kiểm tra cập nhật máy tính {#check-desktop-updates}

Chọn **Trợ giúp → Kiểm tra cập nhật** trong ứng dụng máy tính. Kiểm tra thủ công này tìm
các bản phát hành Motionscaper tương thích trong kho GitHub của dự án. Phiên bản
xem trước có thể nhận bản phát hành xem trước mới hơn; phiên bản ổn định nhận bản
phát hành ổn định. Chọn **Xem bản phát hành** để mở trang phát hành đã xác minh. Kiểm tra
không tải xuống hoặc cài đặt bản cập nhật. Bản dựng trình duyệt không có lệnh menu này.

## Trao đổi với After Effects {#after-effects-exchange}

**Tệp → Cầu nối After Effects** cung cấp các tập lệnh có thể đọc và xem xét dữ liệu trao đổi
được hỗ trợ trước khi nhập. Tệp `.aep` và `.aepx` được mở qua một
bản After Effects đã cài đặt và các tập lệnh cầu nối. Cầu nối đang phát triển
chưa được thẩm định với After Effects đã cài đặt. Hãy xem xét báo cáo;
ý định cảnh không được hỗ trợ và phương tiện gốc vẫn được giữ trong dự án.

Hộp thoại có các tùy chọn nhập và xuất riêng cho biểu thức độ mờ
vô hướng được hỗ trợ dùng số học, thời gian bố cục, giá trị trước
biểu thức và các hàm Math chuẩn. Cả hai tùy chọn ban đầu đều tắt. Xem xét báo cáo
mới sau khi đổi tùy chọn; các dạng biểu thức khác yêu cầu lấy mẫu
hoặc kết xuất rõ ràng. Mã nguồn biểu thức gốc vẫn ở trong dữ liệu trao đổi
được giữ hoặc kho lưu trữ `original.mscape`.

Trình kết xuất hỗ trợ màu và alfa SDR với lớp 2.5D, máy ảnh, ánh sáng,
lấy mẫu màn trập và độ sâu trường ảnh. Không tuyên bố hỗ trợ HDR, lưới 3D đầy đủ,
mặt nạ AI nâng cao hoặc tương thích với mọi plug-in After Effects.

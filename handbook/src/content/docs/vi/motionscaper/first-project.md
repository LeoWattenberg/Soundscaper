---
title: "Dự án chuyển động đầu tiên của bạn"
description: "Tạo bố cục, làm hoạt ảnh một lớp và xuất dự án đã lưu."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","model":"gpt-6","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3e0e29a1ba720a089cacd0ee470b587f09102f1d2264481ce9d575fe29602173","targetLocale":"vi"} -->

## Tạo và thêm lớp {#create-and-add-a-layer}

1. Chọn **Tệp → Bố cục mới** và nhập tiêu đề, kích thước, tốc độ khung hình
   và thời lượng theo khung hình.
2. Chọn **Lớp → Văn bản mới** hoặc **Lớp → Màu đặc mới**. Chọn bố cục
   đích khi dự án chứa nhiều bố cục.
3. Mở **Lớp → Văn bản và Diện mạo** để chỉnh lớp văn bản hiện có hoặc
   phần tô và nét viền của hình dạng. Phông chữ nhập tại đây được giữ cùng dự án.

Dùng **Tệp → Nhập phương tiện** cho nguồn ảnh, video hoặc âm thanh. Việc nhập vượt
quá giới hạn hiện tại của bộ giải mã hoặc bộ nhớ bị từ chối kèm giải thích;
tệp nguồn gốc không bị thay đổi.

## Tạo hoạt ảnh và xem trước {#animate-and-preview}

Mở **Lớp → Thuộc tính và Khung hình chính** để chọn thuộc tính lớp và thêm
khóa ở vị trí khung hình chính xác. Điều khiển đường cong đổi nội suy; chỉnh sửa
không gian đổi đường vị trí. **Xem → Dòng thời gian** mở điều khiển thời gian,
thứ tự, nhóm và vùng làm việc của lớp.

Mở **Xem → Khung vẽ bố cục** để chọn và di chuyển lớp 2D tĩnh.
Hình vuông thay đổi tỉ lệ, hình tròn xoay quanh neo đã đặt. Mỗi
lần kéo hoàn tất là một bước hoàn tác; Escape hủy kéo. Các biến đổi có hoạt ảnh và
do biểu thức điều khiển vẫn ở trong Thuộc tính và Khung hình chính.

Mở **Xem → Xem trước bố cục** để tìm vị trí hoặc phát bố cục. Xem trước
dùng phương tiện nguồn được giữ. Thiết lập cảnh không hỗ trợ hoặc không hợp lệ tạo
lỗi thay vì hình ảnh thay thế. Đóng xem trước để giải phóng tài nguyên
kết xuất đang hoạt động của nó.

## Lưu bản sao di động {#save-a-portable-copy}

Chọn **Tệp → Lưu** để công bố bản sửa đổi hiện tại, rồi **Tệp → Lưu bản sao**
để tải kho lưu trữ `.mscape`. Kho lưu trữ gồm dự án và phương tiện
gốc cần để mở lại. Mở bằng **Tệp → Mở** trên thiết bị khác hoặc
từ thư viện trình duyệt mới.

## Kết xuất {#render}

Chọn **Tệp → Kết xuất**. Chọn bố cục, định dạng đầu ra và
khoảng khung hình. Không bao gồm khung hình cuối: các khung hình từ 0 đến 29 dùng khoảng
`0` đến `30`. Vùng làm việc phân số chọn các thời điểm lấy mẫu nguyên nằm trong nó;
vùng không có mẫu đầu ra phải được đổi trước khi kết xuất.

Dùng **Chuỗi PNG trong suốt (.tar)** cho alfa. Giải nén kho TAR để
lấy ảnh PNG thông thường và siêu dữ liệu thời gian. MP4 và WebM dùng màu
nền đã chọn trong hộp thoại. Kết xuất ghim bản sửa đổi đã gửi, nên chỉnh sửa
sau không đổi đầu ra đang chạy. Đóng hộp thoại kết xuất
vẫn giữ tác vụ chạy. **Tệp → Hàng đợi kết xuất** hiển thị tiến độ, hủy,
thử lại bản sửa đổi đã gửi và các bản tải hoàn tất. Đóng trình biên tập
sẽ hủy tác vụ chưa xong.

Quay lại [sổ tay Motionscaper](/motionscaper/).

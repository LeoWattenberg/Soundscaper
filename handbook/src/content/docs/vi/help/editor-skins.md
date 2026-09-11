---
title: "Giao diện chỉnh sửa"
description: "Chọn một giao diện trực quan hoặc thử một giao diện tạm thời thông qua một URL."
---
<!-- docs-ai-provenance: {"factPacketSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a1b3a7510549ae51d6a74eb7fa25aa3a1bab8532c46d39e81652ffc6f7062a36","targetLocale":"vi"} -->

Các lớp da thay đổi màu sắc, phông chữ, đường viền và nền trang trí của trình chỉnh sửa.
Chúng có sẵn trong Soundscaper và Framescaper. Mỗi sản phẩm ghi nhớ lựa chọn riêng của mình. Các không gian làm việc vẫn kiểm soát bố cục của các bảng điều khiển và công cụ.

## Chọn một lớp da {#choose-a-skin}

Mở **Sửa → Tùy chọn → Ngoại hình** và chọn một lớp da:

- **Mặc định** giữ nguyên thiết kế trình chỉnh sửa gốc.
- **Sakura** kết hợp hoa anh đào, các điểm nhấn màu hồng và chữ viết tròn.
- **Lilac** sử dụng các màu tím lạnh và các kết cấu tím chồng lên nhau.
- **Techno** kết hợp đồ họa mạch điện màu xanh với chữ viết đơn không khoảng cách.

Chọn **Sáng**, **Tối** hoặc **Theo chủ đề hệ thống** riêng biệt. Mỗi lớp da đều có cả phiên bản sáng và tối. **Kiểu cắt** vẫn là một lựa chọn riêng biệt; bảng màu Sắc màu được phối hợp với mỗi lớp da trong khi vẫn giữ các màu cắt riêng biệt.

Độ tương phản cao có ưu tiên hơn trang trí lớp da. Việc tắt độ tương phản cao sẽ khôi phục lớp da đã chọn. Việc thay đổi lớp da không bao giờ thay đổi âm thanh cắt, nội dung dự án hoặc bố cục không gian làm việc.

## Thử lớp da từ một liên kết {#try-a-skin-from-a-link}

Thêm `?useskin=sakura` vào URL của trình chỉnh sửa để xem trước tạm thời Sakura. Sử dụng
`default`, `sakura`, `lilac`, hoặc `techno` làm giá trị. Nếu URL đã có tham số truy vấn, hãy thêm `&useskin=sakura` thay vì thế. Một giá trị không xác định sẽ bị bỏ qua.

Một URL xem trước không thay thế lớp da đã lưu của bạn, ngay cả khi bạn thay đổi tùy chọn khác. Tải lại URL xem trước giữ xem trước; truy cập mà không có tham số sử dụng lựa chọn đã lưu của bạn. Tham số này không chọn sáng hoặc tối.

Trong **Tùy chọn → Ngoại hình**, chọn **Giữ lớp da này** để lưu xem trước, hoặc **Kết thúc xem trước** để quay lại lớp da đã lưu. Việc chọn bất kỳ lớp da nào cũng lưu lựa chọn đó và kết thúc xem trước. Những hành động này chỉ loại bỏ tham số lớp da từ URL hiện tại, mà không tải lại trình chỉnh sửa.

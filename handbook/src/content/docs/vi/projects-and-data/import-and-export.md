---
title: "Nhập và xuất"
description: "Phân biệt tệp phương tiện nguồn, tệp dự án, tệp trao đổi và bản kết xuất để bàn giao."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3f5177c4b9d2b9549b4bf8cbf01df1df0c6e68287767f34bc5d1c40d69996e0c","targetLocale":"vi"} -->

Soundscaper dùng các loại tệp khác nhau cho những mục đích khác nhau.

## Phương tiện nguồn

Dùng **Tệp → Nhập** cho âm thanh, video và nhãn. Gợi ý hiện tại trong trình
chỉnh sửa liệt kê AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF và WebM;
đường nhập video cũng hỗ trợ các định dạng chứa khác. Khả năng sẵn có tùy thuộc
vào sản phẩm đang dùng và tài nguyên chạy.

Nhập phương tiện sẽ thêm một nguồn thuộc dự án. Tệp gốc không trở thành tài
liệu dự án có thể chỉnh sửa.

Xuất âm thanh nén và nhập trên trình duyệt hỗ trợ tối đa một giờ hoặc 1 GB (1.000.000.000 byte của tệp), tùy giới hạn nào đến trước. Chọn tệp trên desktop và nhập âm thanh nén không có giới hạn cố định về kích thước hoặc thời lượng dưới phạm vi số nguyên an toàn. Tác vụ dài đọc, mã hóa và lưu theo các khối; xuất tệp lớn trong trình duyệt cần bộ nhớ riêng của nguồn gốc và đủ dung lượng trống. Nhập tệp lớn cần đủ bộ nhớ cục bộ cho âm thanh đã giải mã. Cấu trúc định dạng, hỗ trợ bộ giải mã và dung lượng lưu trữ sẵn có cũng có thể giới hạn việc nhập.

Bản trình duyệt hỗ trợ MP3, MP2, FLAC, WavPack, Opus và Ogg Vorbis. Hỗ trợ AAC/M4A tùy thuộc codec của trình duyệt. Xuất luồng trên desktop hỗ trợ sáu định dạng đi kèm, cùng FLAC lossless 24-bit và WavPack lossless float32. Nhập trên desktop tùy thuộc khả năng có bộ giải mã; nguồn MP2 lớn dùng bộ giải mã gói, còn nguồn MP2 nhỏ hơn dùng mức tương thích của tiện ích.

Tác vụ đang chạy vẫn hiện thanh tiến trình dù **Xem → Thanh trạng thái** bị ẩn.
Chọn **Hủy** bên cạnh thanh để dừng nhập hoặc xuất âm thanh.

## Tệp dự án có thể chỉnh sửa

- Scape (`.sscape` từ Soundscaper, `.fscape` từ Framescaper và cả hai đều mở được trong cả hai sản phẩm) là định dạng dự án đầy đủ, không suy giảm và có thể mang theo, dùng chung cho Soundscaper và Framescaper.
- AUP3 và AUP4 cho phép trao đổi âm thanh với Audacity. Chọn AUP3 cho hồ sơ dự án Audacity 3.7.9 hoặc AUP4 cho hồ sơ trao đổi hiện tại. Cả hai đều không phải bản sao lưu đầy đủ của dự án Soundscaper có nhiều loại phương tiện; hãy xem báo cáo tương thích sau khi xuất.
- Phiên bản desktop có thể mở phiên Adobe Audition SESX (`.sesx`) để tạo dự án cục bộ từ các tệp âm thanh được tham chiếu. Giữ phiên và phương tiện gốc; không hỗ trợ xuất SESX.

Xem [Tệp dự án](/projects-and-data/project-files/) để biết hệ quả của từng lựa chọn.

## Bản kết xuất để bàn giao

Xuất âm thanh tạo tệp để nghe, phát hành hoặc xử lý tiếp. Xuất video tạo bản
bàn giao MP4 hoặc WebM. Tệp đã kết xuất không giữ dòng thời gian có thể chỉnh
sửa, định tuyến, hiệu ứng hoặc lịch sử dự án.

Tham khảo [mục tham khảo](/reference/) để xem bảng định dạng và khả năng sản
phẩm được tạo tự động.

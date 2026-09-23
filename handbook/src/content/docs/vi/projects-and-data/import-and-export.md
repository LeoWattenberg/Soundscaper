---
title: "Nhập và xuất"
description: "Phân biệt tệp phương tiện nguồn, tệp dự án, tệp trao đổi và bản kết xuất để bàn giao."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"feaac1449bd0cf8c68e4a6c1b9805972644cd6e992ca79c8e5415a0b8cb086f9","targetLocale":"vi"} -->

Soundscaper dùng các loại tệp khác nhau cho những mục đích khác nhau.

## Phương tiện nguồn

Dùng **Tệp → Nhập** cho âm thanh, video và nhãn. Gợi ý hiện tại trong trình
chỉnh sửa liệt kê AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF và WebM;
đường nhập video cũng hỗ trợ các định dạng chứa khác. Khả năng sẵn có tùy thuộc
vào sản phẩm đang dùng và tài nguyên chạy.

Nhập phương tiện sẽ thêm một nguồn thuộc dự án. Tệp gốc không trở thành tài
liệu dự án có thể chỉnh sửa.

Nhập và xuất âm thanh nén hỗ trợ tối đa một giờ hoặc 1 GB (1.000.000.000 byte
của tệp), tùy giới hạn nào đến trước. Tệp stereo dài một giờ ở 48 kHz được hỗ
trợ nếu nằm trong giới hạn kích thước đó. Tác vụ dài đọc, mã hóa và lưu theo
các khối; xuất tệp lớn trong trình duyệt cần bộ nhớ riêng của nguồn gốc và đủ
dung lượng trống. Nhập tệp lớn cần bộ nhớ cục bộ bền vững để lưu âm thanh đã
giải mã. Định dạng PCM có giới hạn riêng.

Bản trình duyệt hỗ trợ MP3, MP2, FLAC, WavPack, Opus và Ogg Vorbis. Hỗ trợ
AAC/M4A trong trình duyệt tùy thuộc codec của trình duyệt. Xuất luồng trên
desktop hỗ trợ sáu định dạng đi kèm, cùng FLAC 24-bit và WavPack lossless
float32. Nhập trên desktop tùy thuộc khả năng có bộ giải mã gốc; MP2 dùng mức
tương thích của tiện ích nhỏ hơn. AAC trên desktop và các nhà cung cấp tương
thích có giới hạn riêng.

Tác vụ đang chạy vẫn hiện thanh tiến trình dù **Xem → Thanh trạng thái** bị ẩn.
Chọn **Hủy** bên cạnh thanh để dừng nhập hoặc xuất âm thanh.

## Tệp dự án có thể chỉnh sửa

- Scape (`.sscape` từ Soundscaper, `.fscape` từ Framescaper và cả hai đều mở được trong cả hai sản phẩm) là định dạng dự án đầy đủ, không suy giảm và có thể mang theo, dùng chung cho Soundscaper và Framescaper.
- AUP4 là định dạng trao đổi chỉ dành cho âm thanh với Audacity. Đây không phải bản sao lưu đầy đủ của dự án Soundscaper có nhiều loại phương tiện.

Xem [Tệp dự án](/projects-and-data/project-files/) để biết hệ quả của từng lựa chọn.

## Bản kết xuất để bàn giao

Xuất âm thanh tạo tệp để nghe, phát hành hoặc xử lý tiếp. Xuất video tạo bản
bàn giao MP4 hoặc WebM. Tệp đã kết xuất không giữ dòng thời gian có thể chỉnh
sửa, định tuyến, hiệu ứng hoặc lịch sử dự án.

Tham khảo [mục tham khảo](/reference/) để xem bảng định dạng và khả năng sản
phẩm được tạo tự động.

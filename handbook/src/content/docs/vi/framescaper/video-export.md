---
title: "Xuất video"
description: "Xác thực chuỗi được biên soạn và tạo một tệp MP4 hoặc WebM để giao hàng."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"603de0b48d3c3e6d2688ba66a67dc28e38cee405f12901a999c6d0f75c3c5f57","targetLocale":"vi"} -->

## Trước khi xuất

- Chơi qua toàn bộ trình tự và mỗi ranh giới chỉnh sửa.
- Xác nhận rằng các đường ray hiển thị và soloed tạo ra hình ảnh dự định.
- Kiểm tra xem âm thanh liên kết có đồng bộ hóa hay không.
- Xác nhận phạm vi xuất và xem có nên bao gồm phụ đề hoặc âm thanh hay không.

## Tạo tệp

Mở hộp thoại xuất và chọn định dạng video. Framescaper hỗ trợ MP4 và
WebM thông qua thời gian chạy video được cấu hình. Chọn kích thước,
 tốc độ khung hình, và các tùy chọn khác phù hợp với điểm đến.

Mã hóa video đòi hỏi nhiều tài nguyên hơn so với phát lại dòng thời gian thông thường.
Giữ trình chỉnh sửa mở cho đến khi báo cáo xuất hoàn thành.

## Xuất riêng từng đoạn âm thanh {#export-audio-clips}

Chọn **Tệp → Xuất video**, chọn định dạng âm thanh như **WAV** và đặt **Đầu ra** thành **Từng đoạn riêng (tách theo đoạn)**. Lệnh xuất tải xuống một kho lưu trữ chứa một tệp cho mỗi đoạn âm thanh. Các đoạn video bị loại trừ; mỗi tệp âm thanh chỉ chứa đoạn tương ứng, bao gồm cả phần cắt và chỉnh sửa đoạn.

Tệp bắt đầu từ thời điểm âm thanh của đoạn có thể nghe được, không thêm khoảng đệm đến vị trí trong dự án hoặc phần đuôi hiệu ứng. Tên đoạn có số thứ tự giúp phân biệt các đoạn trùng tên.

Hiệu ứng của rãnh được giữ lại; hiệu ứng tổng, tắt tiếng và solo không ảnh hưởng đến lần xuất này. Xem quy trình âm thanh dùng chung tại [Xuất các đoạn thành tệp riêng](/soundscaper/edit-mix-and-export/#export-clips).

## Xác minh giao hàng

Mở tệp xuất trong người chơi riêng biệt. Kiểm tra thời lượng, khung hình đầu tiên và cuối cùng,
định hướng hình ảnh, đồng bộ hóa âm thanh và phụ đề dự kiến.

Video đã hiển thị không thể thay thế dự án có thể chỉnh sửa. Xuất bản một bản sao`.fscape`
khi bạn cần bảo tồn dòng thời gian và phương tiện truyền thông của dự án.

---
title: "Lưu trữ, sao lưu và quyền riêng tư"
description: "Hiểu về lưu trữ ưu tiên cục bộ và bảo vệ các dự án khỏi sự mất mát của trình duyệt hoặc thiết bị."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"da0d569c45f7c2ba8bd2e1d56d4b72c5843eaa4ea2f28a1238fbb7ba8d383b88","targetLocale":"vi"} -->

## Ý nghĩa của phương thức ưu tiên cục bộ

Các dự án, bản ghi và phương tiện nhập được xử lý và lưu trữ trên thiết bị của bạn. Trình chỉnh sửa không yêu cầu tài khoản hoặc đồng bộ hóa dự án với dịch vụ Soundscaper.

Trên web, âm thanh và phương tiện sử dụng hệ thống tệp riêng tư theo nguồn gốc của trình duyệt khi có sẵn, với IndexedDB là phương án dự phòng. Soundscaper yêu cầu lưu trữ bền vững, nhưng trình duyệt quyết định có cấp phép hay không.

## Những yếu tố có thể xóa dự án

- Xóa dữ liệu trang web sẽ xóa thư viện dự án cục bộ của trình duyệt.
- Các ngữ cảnh trình duyệt riêng tư hoặc hạn chế có thể quay lại bộ nhớ tạm thời.
- Chính sách hạn ngạch và xóa bỏ của trình duyệt vẫn có hiệu lực.
- Xóa dữ liệu ứng dụng máy tính để bàn bằng tay sẽ xóa thư viện cục bộ của nó.
- Sự cố thiết bị hoặc lưu trữ có thể xóa tất cả các bản sao cục bộ trên thiết bị đó.

Việc gỡ cài đặt bản dựng máy tính để bàn đóng gói được thiết kế để bảo tồn thư viện của nó, nhưng điều này không phải là chiến lược sao lưu.

## Quy trình sao lưu

Tại các mốc hữu ích và trước khi xóa hoặc di chuyển lưu trữ:

1. Chờ quá trình lưu cục bộ hoàn tất.
2. Xuất tệp dự án Scape (`.sscape` hoặc `.fscape`).
3. Xuất và phát lại bản phối cảnh đã xử lý.
4. Sao chép cả hai vào lưu trữ bên ngoài dữ liệu cục bộ của trình chỉnh sửa.

Sử dụng AUP4 thêm vào khi sự tương thích với Audacity là cần thiết, không phải thay thế cho bản sao dự án Scape.

## Quyền riêng tư trên trang tài liệu

Hướng dẫn này được phục vụ dưới dạng tệp tĩnh và sử dụng tìm kiếm cục bộ của trình duyệt. Trang V1 không thêm dịch vụ phân tích hoặc nền tảng AI/tìm kiếm.

Chính sách [Quyền riêng tư Soundscaper và Framescaper](https://soundscaper.org/privacy/en/) đầy đủ cũng bao gồm việc phân phối ứng dụng, quyền thiết bị, tải xuống tùy chọn, kiểm tra cập nhật máy tính để bàn và kết nối VCR Web Framescaper.

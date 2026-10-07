---
title: "Ghi đè tệp đã nhập trên máy tính"
description: "Lưu dự án đã chỉnh sửa đè lên tệp phương tiện gốc trong Soundscaper hoặc Framescaper."
sidebar:
  order: 10
---
<!-- docs-ai-provenance: {"factPacketSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"8d271bd0af1ff955f44d1e08b94628eb9854efe79c7bd7c2614281b712854be6","targetLocale":"vi"} -->

Trong các phiên bản Electron của Soundscaper và Framescaper, **Tệp → Ghi đè tên tệp** xuất toàn bộ dự án đã chỉnh sửa vào tệp phương tiện được nhập ban đầu. Lệnh này dùng các thiết lập xuất mà tệp gốc hỗ trợ và lưu ngay, không mở hộp thoại xuất hay trình chọn tệp. Âm thanh giữ nguyên định dạng nguồn, tần số lấy mẫu và số kênh. Video MP4 và WebM được hỗ trợ giữ nguyên vùng chứa, kích thước và tốc độ khung hình nguồn.

Nhập một tệp phương tiện bằng **Tệp → Nhập**, chỉnh sửa rồi chọn **Tệp → Ghi đè tên tệp**. Bạn có thể lặp lại thao tác này sau khi chỉnh sửa thêm. Vùng chọn thời gian không giới hạn nội dung ghi đè: toàn bộ dự án luôn được kết xuất. Dự án vẫn giữ phương tiện đã nhập và lịch sử chỉnh sửa.

Lệnh không khả dụng nếu dự án không có tệp gốc được hỗ trợ, nếu đã nhập nhiều tệp gốc hoặc trong khi nhập, ghi âm hay xử lý. Các phiên bản trình duyệt dùng hộp thoại xuất thông thường.

Chọn **Tệp → Xuất âm thanh** trong Soundscaper hoặc **Tệp → Xuất video** trong Framescaper nếu bạn muốn chọn đích khác hoặc thay đổi thiết lập đầu ra. Ghi đè sẽ thay thế nội dung của tệp gốc; hãy giữ một bản sao riêng nếu bạn cần bản ghi chưa chỉnh sửa.

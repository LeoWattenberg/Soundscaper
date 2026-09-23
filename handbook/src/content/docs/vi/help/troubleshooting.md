---
title: "Khắc phục sự cố"
description: "Giải quyết các vấn đề thường gặp khi ghi âm, lưu trữ, nhập và xuất."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"factPacketSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"b6c81875b6c86e89906823f22542ee46f409d4ebd245b9cfd967e346e4fbf3f5","targetLocale":"vi"} -->

## Thiếu ngõ vào ghi âm

Kiểm tra quyền dùng micro trong hệ điều hành và trình duyệt, sau đó mở lại bộ
chọn thiết bị. Khi ghi nhiều track, hãy bảo đảm mỗi track đã bật ghi đều được
gán một ngõ vào khả dụng.

## Một lệnh bị vô hiệu hóa

Nhiều lệnh phụ thuộc vào trạng thái hiện tại. Chọn dự án, track, clip hoặc
khoảng thời gian cần thiết rồi thử lại. Một tính năng cũng có thể được giới
hạn có chủ ý chỉ dành cho Soundscaper hoặc Framescaper.

## Nhập tệp dùng quá nhiều bộ nhớ

Giải mã âm thanh nén và một số thao tác lớn có thể cần nhiều bộ nhớ tạm, dù âm
thanh của dự án được chia thành các khối. Đóng những thẻ hoặc ứng dụng không
cần thiết, thử lại với tệp nguồn nhỏ hơn hoặc dùng bản desktop nếu phù hợp.

## Dự án biến mất khỏi trình duyệt

Hãy xác nhận bạn đã mở đúng hồ sơ trình duyệt, nguồn và trang sản phẩm.
Soundscaper và Framescaper dùng chung thư viện trên cùng nguồn
`soundscaper.org`, nhưng miền khác, hồ sơ trình duyệt khác hoặc dữ liệu trang
đã bị xóa sẽ có thư viện riêng.

Nếu dữ liệu trang đã bị xóa và không có tệp xuất dự án Scape, trình chỉnh sửa
không có bản sao trên đám mây để khôi phục.

## AUP4 bị thiếu một phần dự án

Đọc báo cáo tương thích. AUP4 mang theo trạng thái chỉnh sửa âm thanh tương
thích nhưng bỏ qua video, đồng thời có thể chuyển đổi hoặc bỏ qua hiệu ứng và
trạng thái phối âm chỉ có trong Soundscaper. Để chuyển toàn bộ dự án, hãy dùng
tệp dự án Scape — `.sscape` hoặc `.fscape`; cả hai đều mở được trong mỗi sản
phẩm.

## Xuất tệp thất bại hoặc không phát được

Thử lại sau khi xác nhận vùng đã chọn có nội dung phát được. Với âm thanh hoặc
video nén, hãy kiểm tra tài nguyên chạy có tải được không. Sau khi xuất thành
công, mở tệp bằng trình phát khác để kiểm tra.

Nếu vẫn chưa giải quyết được, dùng **Trợ giúp → Hỗ trợ** để liên hệ người bảo
trì và cung cấp sản phẩm, nền tảng, bản dựng trình duyệt hoặc desktop, các
bước thực hiện và thông báo lỗi chính xác.

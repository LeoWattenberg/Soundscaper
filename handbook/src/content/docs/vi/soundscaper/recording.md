---
title: "Ghi âm thanh"
description: "Cấp quyền đầu vào cho trình chỉnh sửa, chọn đường dẫn và bảo vệ bản ghi hoàn chỉnh."
sidebar:
  order: 3
---
<!-- docs-ai-provenance: {"factPacketSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"1e39bcf227951ced26f89aa3bf1a8ca924d8a3cc33243bfb7ee997ce6387688b","targetLocale":"vi"} -->

## Chuẩn bị đầu vào

1. Mở điều khiển thiết bị ghi âm và chọn một đầu vào có sẵn.
2. Cho phép quyền microphone hoặc chụp khi trình duyệt yêu cầu.
3. Bật giám sát đầu vào nếu bạn cần kiểm tra mức đầu vào trước khi ghi âm.
4. Kiểm tra đồng hồ ghi âm và điều chỉnh thiết bị hoặc mức đầu vào để tránh cắt âm.

Quyền trình duyệt được phạm vi đến trang web và thiết bị. Nếu không có đầu vào nào xuất hiện, hãy xem lại cả quyền của hệ điều hành và trình duyệt.

## Ghi một hoặc nhiều bản ghi

Đối với một bản ghi bình thường, sử dụng menu **Ghi** hoặc hành động ghi âm của vận chuyển.

Đối với định tuyến đa bản ghi, chọn **Xem → Bật ghi âm đa bản ghi**, trang bị cho các bản ghi bạn muốn ghi, và gán một đầu vào cho mỗi bản ghi được trang bị. Ghi âm sẽ không bắt đầu khi không có đầu vào nào được gán có sẵn.

Soundscaper cũng phơi bày các luồng công việc ghi âm có thời gian, punch/count-in, loop/take, và kích hoạt âm thanh thông qua các menu của nó. Bắt đầu với một bản ghi bình thường trước khi thêm các điều kiện này.

## Sau khi ghi

Dừng ghi âm và phát bản ghi mới trước khi tiếp tục. Chờ trạng thái dự án báo cáo rằng việc lưu đã hoàn thành. Đối với vật liệu không thể thay thế, hãy xuất một bản sao âm thanh đã render và một dự án `.sscape` thay vì chỉ dựa vào thư viện cục bộ.

---
title: "Framescaper"
description: "Sắp xếp video, hình ảnh ghép và thực hiện dự án video ưu tiên địa phương."
sidebar:
  order: 1
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"47cebc3006e44dba5569ea0c1418001989dccf3730c3421c338c340222a9c5af","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"47cebc3006e44dba5569ea0c1418001989dccf3730c3421c338c340222a9c5af","targetLocale":"vi"} -->

Framescaper là giao diện tập trung vào video của trình biên tập chung. Nó nhấn mạnh vào bản xem trước video, giám sát nguồn, hiệu ứng hình ảnh, ghép hình, chuỗi lồng nhau, và công việc đa máy quay.

Soundscaper và Framescaper mở các tệp dự án của nhau: `.sscape`, `.fscape`, và phiên bản cũ hơn `.scape` đều hoạt động trong cả hai. Sử dụng Soundscaper cho việc ghi âm và sản xuất âm thanh chi tiết, sau đó chuyển dự án trở lại Framescaper cho công việc hình ảnh.

## Vị trí của từng thành phần

Framescaper quản lý hình ảnh: nhập video, Giám sát Nguồn và Bản xem trước Video, hiệu ứng hình ảnh, hình học và ghép hình, chuỗi lồng nhau, công việc đa máy quay, và phát hành video. Các làn hình ảnh và âm thanh liên kết giữ đồng bộ cho đến khi bạn hủy liên kết chúng.

Soundscaper quản lý âm thanh: ghi âm, hiệu ứng và phân tích âm thanh, phối trộn, và phát hành âm thanh. Framescaper sử dụng luồng công việc ghi khác nhau và không hiển thị bộ công cụ ghi âm của Soundscaper, vì vậy hãy ghi trong Soundscaper và mang dự án trở lại. Các hướng dẫn từng bước [tài liệu tham khảo](/guides/) được viết và xác minh đối với Soundscaper, và cũng bao phủ mặt âm thanh của một dự án video.

## Đường dẫn được khuyến nghị

1. [Tạo dự án Framescaper đầu tiên](/framescaper/first-project/).
2. [Chuẩn bị và xuất video](/framescaper/video-export/).
3. Xem lại [hành vi tệp dự án và sao lưu](/projects-and-data/project-files/).

Mở trình chỉnh sửa trình duyệt tại [framescaper.org/en](https://framescaper.org/en/).

Đối với trợ giúp trên máy tính để bàn, xem [xử lý cục bộ, mô hình và plugin](/help/local-processing/).

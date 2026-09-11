---
title: "Các tệp dự án"
description: "Chọn giữa thư viện cục bộ, tệp dự án Scape, AUP4 và bản sao lưu đã hiển thị."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"5d41714fbb7c88000b3d658ba55adbe31cdf49eca365f62b8d42c3410a9a4816","targetLocale":"vi"} -->

## Thư viện dự án cục bộ

Trình chỉnh sửa lưu các dự án đang làm việc vào thư viện cục bộ của nó. Trên trình duyệt, đây là bộ nhớ lưu trữ riêng của nguồn gốc; trong phiên bản máy tính để bàn, đây là dữ liệu ứng dụng. Đây là bản sao làm việc tiện lợi, không phải là bản sao duy nhất bạn nên giữ.

## Tập tin dự án Scape

Sử dụng **Tệp → Xuất tập tin dự án** cho một bản sao lưu di động không mất dữ liệu. Mỗi sản phẩm viết hậu tố riêng: Soundscaper lưu `.sscape` và Framescaper lưu `.fscape`, và tên mục thực đơn áp dụng cho một trong hai. Định dạng phía sau cả hai là như nhau, vì vậy đây là lựa chọn phù hợp khi bạn cần bảo tồn trạng thái chỉnh sửa đa phương tiện.

Mỗi sản phẩm có thể mở cả hai hậu tố. `.sscape`, `.fscape`, `.liscape` được bảo lưu và `.scape` - các tập tin được xuất trước khi các sản phẩm có hậu tố riêng của chúng, có thể mở ở mọi nơi, và việc lưu một tập tin từ một sản phẩm khác chỉ đổi tên nó - ví dụ, một tập tin `Mix.sscape` được lưu từ Framescaper sẽ trở thành `Mix.fscape`. Không có gì trong dự án thay đổi với tên gọi.

Khi nhập hoặc mở một bản sao Scape, có thể gặp một dự án hiện có với cùng ID. Sử dụng quy trình sao chép được cung cấp khi cả hai phiên bản cần phải tồn tại trong thư viện cục bộ.

## AUP4

AUP4 tồn tại để tương thích trao đổi âm thanh với Audacity. Xuất khẩu tạo ra báo cáo tương thích mô tả các chuyển đổi, các hiệu ứng không có sẵn và trạng thái Soundscaper-chỉ bị bỏ qua.

AUP4 chỉ dành cho âm thanh. Video bị bỏ qua, và các tùy chọn trình duyệt, lịch sử hủy, định tuyến trộn âm và thư viện dự án của trình duyệt không được chuyển. Đừng sử dụng AUP4 làm bản sao lưu duy nhất của dự án Soundscaper hoặc Framescaper.

## Bản sao lưu đã render

Đối với công việc quan trọng, hãy giữ cả:

1. Một bản sao dự án Scape (`.sscape` hoặc `.fscape`) cho việc chỉnh sửa trong tương lai.
2. Một tập tin âm thanh hoặc video đã render có thể phát mà không cần trình chỉnh sửa.

Lưu các tập tin đó bên ngoài thư mục dữ liệu trình duyệt hoặc ứng dụng.

---
title: "Các tệp dự án"
description: "Chọn giữa thư viện cục bộ, tệp dự án Scape, AUP4 và bản sao lưu đã hiển thị."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"basedOnProvenance":{"model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432"},"factPacketSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"e5b0e4d73cd773ea7289ee298d5d16b6f714559350c07395753fa996b409be3b","targetLocale":"vi"} -->

## Thư viện dự án cục bộ

Trình chỉnh sửa lưu các dự án đang làm việc vào thư viện cục bộ của nó. Trên trình duyệt, đây là bộ nhớ lưu trữ riêng của nguồn gốc; trong phiên bản máy tính để bàn, đây là dữ liệu ứng dụng. Đây là bản sao làm việc tiện lợi, không phải là bản sao duy nhất bạn nên giữ.

## Tập tin dự án Scape

Trên desktop, âm thanh và video đã nhập mặc định vẫn là tham chiếu đến các tệp gốc. Giữ các tệp đó ở vị trí ban đầu khi mở lại dự án. Thư viện cục bộ cũng giữ bộ nhớ đệm chỉnh sửa. Bản ghi và phương tiện được tạo hoặc xử lý được đóng gói vì không có bản gốc bên ngoài không thay đổi.

Chọn **Tệp → Quản lý dự án → Hợp nhất phương tiện** để đóng gói phương tiện được tham chiếu vào tệp dự án. Việc hợp nhất lưu dự án ngay lập tức; chọn đích trong hộp thoại lưu. Sau khi lưu, có thể di chuyển hoặc chia sẻ bản hợp nhất mà không cần các tệp phương tiện gốc. Nếu không thể hợp nhất phương tiện nào đó hoặc việc lưu thất bại, trình chỉnh sửa sẽ báo sự cố.

Xuất từ trình duyệt tự động đóng gói phương tiện. Trước khi mở dự án desktop có tham chiếu bên ngoài trong trình duyệt, hãy hợp nhất dự án trên desktop.


Sử dụng **Tệp → Xuất tập tin dự án** để lưu dự án chỉnh sửa. Mỗi sản phẩm viết hậu tố riêng: Soundscaper lưu `.sscape` và Framescaper lưu `.fscape`, và tên mục thực đơn áp dụng cho một trong hai. Định dạng phía sau cả hai là như nhau, vì vậy đây là lựa chọn phù hợp khi bạn cần bảo tồn trạng thái chỉnh sửa đa phương tiện.

Mỗi sản phẩm có thể mở cả hai hậu tố. `.sscape`, `.fscape`, `.liscape` được bảo lưu và `.scape` - các tập tin được xuất trước khi các sản phẩm có hậu tố riêng của chúng, có thể mở ở mọi nơi, và việc lưu một tập tin từ một sản phẩm khác chỉ đổi tên nó - ví dụ, một tập tin `Mix.sscape` được lưu từ Framescaper sẽ trở thành `Mix.fscape`. Không có gì trong dự án thay đổi với tên gọi.

Khi nhập hoặc mở một bản sao Scape, có thể gặp một dự án hiện có với cùng ID. Sử dụng quy trình sao chép được cung cấp khi cả hai phiên bản cần phải tồn tại trong thư viện cục bộ.

## Audacity AUP3 và AUP4

Có thể xuất dự án Audacity từ **Tệp → Xuất mục khác**. Chọn **Xuất AUP3** để dùng hồ sơ dự án Audacity 3.7.9 hoặc **Xuất AUP4** để dùng hồ sơ trao đổi Audacity hiện tại. Mỗi lần xuất tạo báo cáo tương thích mô tả các chuyển đổi, hiệu ứng không khả dụng và trạng thái riêng của Soundscaper bị lược bỏ.

Cả hai định dạng chỉ chứa âm thanh. Video bị lược bỏ, đồng thời tùy chọn trình duyệt, lịch sử hoàn tác, định tuyến bộ trộn và thư viện dự án của trình duyệt không được chuyển. Không dùng định dạng nào làm bản sao lưu duy nhất cho dự án Soundscaper hoặc Framescaper.

## Adobe Audition SESX

Trong phiên bản desktop, dùng **Tệp → Mở** để nhập phiên Adobe Audition `.sesx`. Giữ các tệp âm thanh được tham chiếu theo cấu trúc thư mục tương đối bên dưới thư mục phiên hoặc chọn thư mục phương tiện khi được hỏi. Việc nhập tạo dự án cục bộ mới với các bản âm thanh, clip, vị trí, phần cắt, hiệu ứng mờ đơn giản và thiết lập bộ trộn tĩnh được hỗ trợ.

Nhập SESX chỉ theo một chiều. Hiệu ứng Audition, tự động hóa, định tuyến, video, dấu điểm, vòng lặp, kéo giãn, hiệu ứng mờ chéo được liên kết và đường cong mờ chính xác không được chuyển. Sau khi nhập, mở **Tệp → Báo cáo bàn giao** để xem phương tiện bị thiếu và nội dung khác bị lược bỏ. Giữ tệp SESX và phương tiện gốc để tiếp tục làm việc trong Audition.

## Bản sao lưu đã render

Đối với công việc quan trọng, hãy giữ cả:

1. Một bản sao dự án Scape (`.sscape` hoặc `.fscape`) cho việc chỉnh sửa trong tương lai.
2. Một tập tin âm thanh hoặc video đã render có thể phát mà không cần trình chỉnh sửa.

Lưu các tập tin đó bên ngoài thư mục dữ liệu trình duyệt hoặc ứng dụng.

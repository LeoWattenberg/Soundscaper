---
title: "Xử lý cục bộ, mô hình và plugin"
description: "Tìm hỗ trợ cục bộ theo tác vụ và quản lý mô hình cùng plugin trong các trình biên tập desktop."
---
<!-- docs-ai-provenance: {"factPacketSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"3d10714b7e0afaab240d9230f29a67dcdf7089d196b03baabfac75729296e82f","targetLocale":"vi"} -->

Hỗ trợ cục bộ chạy trên thiết bị của bạn trong các trình biên tập desktop Soundscaper và Framescaper. Chọn phương tiện, rồi chọn tác vụ từ menu tương ứng. Hộp thoại hiển thị vùng chọn, cài đặt tác vụ và trạng thái cài đặt mô hình.

Gói máy tính không bao gồm bộ máy xử lý gốc tùy chọn và trọng số mô hình. Cài đặt mô hình qua Trình quản lý mô hình để tải xuống bộ máy và trọng số cần thiết, sau đó chạy tác vụ trên phương tiện đã chọn. Lần cài đầu cần kết nối mạng; các lần xử lý sau chạy cục bộ. Xem hướng dẫn từng mô hình để biết nền tảng được hỗ trợ, mục menu và yêu cầu.

Xem [hướng dẫn từng mô hình](/reference/local-models/).

## Tìm tác vụ {#find-a-task}

| Menu | Tác vụ |
| --- | --- |
| Effect → Noise removal and repair | Enhance Dialogue, Reduce Reverb, Clean Filler & Silence |
| Effect → Source Separation | Separate Dialogue / Music / Effects |
| Analyze → Speech | Transcribe & Captions, Identify Speakers, Mark Reactions |
| Analyze → Music | Detect Beats & Tempo |
| Analyze → Video | Mark Cuts |
| Effect → Video effects | Reframe |
| Edit | Make Highlights |
| Generate | Generate Editorial Text |
| Tools → Search | Indexed Search, Index Transcript, Index Video |

Các tác vụ video thuộc về Framescaper. Lệnh khả dụng tùy thuộc runtime desktop và khả năng của sản phẩm. Tùy chọn sắp xếp theo thứ tự bảng chữ cái trong menu hiệu ứng Soundscaper cũng sắp xếp hiệu ứng xử lý cục bộ theo tên.

Chọn **Run locally** để bắt đầu xử lý và trả lời lời nhắc đồng ý xử lý cục bộ. Bạn có thể hủy trong lúc xử lý. Chọn **Review result**, chọn kết quả muốn dùng rồi chọn **Apply selected**. Có thể hoàn tác các thay đổi dự án đã chấp nhận. Đóng một tác vụ sẽ không áp dụng các đề xuất của nó.

**Tools → Advanced Local Processing** vẫn cung cấp các bộ chọn thao tác và mô hình riêng lẻ. Khi cần, phần chi tiết kỹ thuật trong hộp thoại tác vụ hiển thị các bước nền và cài đặt chính xác.

## Quản lý mô hình {#manage-models}

Mở **Tools → Model Manager** hoặc dùng **Manage Models** trong một tác vụ. Liên kết từ tác vụ lọc danh sách theo các danh tính mô hình tương thích; **Show all models** xóa bộ lọc đó. Tìm theo tên hoặc tác vụ và lọc theo trạng thái cài đặt.

Hãy cài đặt mô hình một cách rõ ràng. Lần cài đầu tiên cũng tải xuống môi trường chạy gốc dùng chung còn thiếu mà mô hình cần. Quá trình tải có hiển thị tiến độ và có thể hủy. Khi quay lại một tác vụ, các thiết lập được giữ nguyên và trạng thái khả dụng của mô hình được cập nhật; quá trình xử lý không tự bắt đầu. Mở rộng **Lưu trữ và xác minh** để sửa chữa, dọn dẹp, di chuyển nơi lưu trữ, xem thông báo giấy phép và cài đặt ngoại tuyến từ thư mục. Mô hình cài từ tệp ngoại tuyến vẫn cần môi trường chạy tương ứng trước lần dùng đầu tiên.

Xem [hướng dẫn riêng của từng mô hình](/reference/local-models/) để biết mục đích, mục menu, kích thước tải xuống, yêu cầu, giới hạn và các kiểm tra suy luận thực tế do gói desktop nightly-with-tests thực hiện.

## Quản lý plugin và thiết bị {#manage-plugins-and-devices}

**Effect → Plugin Manager** liệt kê plugin âm thanh trong Soundscaper và plugin OpenFX trong Framescaper. Tìm kiếm hoặc lọc danh sách, rồi chọn plugin để xem phiên bản, quyền và tùy chọn khôi phục. **Scanning & Settings** chứa cài đặt dò tìm. Có thể truy cập phần quản lý ngay cả khi xử lý bị tắt.

Dùng plugin âm thanh qua **Effect → Audio Plugins**. Các lệnh thêm/sửa hiệu ứng video của Framescaper nằm trong **Effect → Video effects**.

Mở **Edit → Preferences → Audio settings** để thiết lập thiết bị âm thanh gốc và các điều khiển phụ trợ. **Media** chứa cài đặt phương tiện gốc; **Effects** liên kết đến Plugin Manager và có công tắc dò plugin. Việc cấp quyền plugin và khôi phục khỏi vùng cách ly vẫn cần thao tác xác nhận.

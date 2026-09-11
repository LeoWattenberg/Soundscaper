---
title: "Web hoặc máy tính để bàn"
description: "Hiểu cách trình duyệt web và các phiên bản máy tính để bàn đóng gói lưu trữ dự án và truy cập tệp."
sidebar:
  order: 2
---
<!-- docs-ai-provenance: {"factPacketSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","model":"aya-expanse:32b","modelDigest":"1603440383bd5504dc7afd01c0407b425b988dde650a8dc1a737433baa3cd432","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"7da0a3b4d0fcc8276ae3263ff8cae4cee3e34eb459e69d288d69ff374e65b1c6","targetLocale":"vi"} -->

Cả hai phiên bản đều xử lý dự án cục bộ. Cách lưu trữ và truy cập tệp của chúng khác nhau.

## Trình chỉnh sửa web

Phiên bản trình duyệt lưu trữ dự án, bản ghi và phương tiện nhập vào trong bộ nhớ cục bộ của trình duyệt. Nó không tải lên dự án lên tài khoản Soundscaper và không yêu cầu tài khoản.

Sử dụng trình chỉnh sửa web khi bạn muốn truy cập ngay lập tức mà không cần cài đặt ứng dụng. Hãy nhớ rằng bộ nhớ trình duyệt vẫn chịu sự điều chỉnh của hạn ngạch trình duyệt và quy tắc xóa bỏ. Xóa dữ liệu trang web sẽ xóa thư viện dự án cục bộ.

## Bản xem trước trên máy tính để bàn

Các bản xem trước được đóng gói trên máy tính để bàn lưu trữ thư viện cục bộ được lưu tự động bên trong ứng dụng máy tính để bàn. Chúng bao gồm trình chạy biên tập và các bản dịch được phát hành cho việc chỉnh sửa ngoại tuyến.

Các gói máy tính để bàn không có chữ ký. macOS chỉ áp dụng con dấu mã không xác định danh tính mà bộ tải của nó cần để thực thi Electron và các nhị phân bản địa; con dấu đó không đưa ra bất kỳ tuyên bố nào về nhà xuất bản hoặc sự tin cậy. Do đó, Windows SmartScreen hoặc macOS Gatekeeper có thể hiển thị cảnh báo nhà phát triển không xác định cho các gói xem trước và ổn định.

Mở một tệp `.aup4` nhập một dự án độc lập vào thư viện máy tính để bàn. Các chỉnh sửa sau này không ghi đè lên tệp bạn đã mở. **Lưu** cập nhật bản sao trong thư viện; **Lưu với tên khác** tạo một tệp trao đổi Audacity mới.

## Điện thoại và máy tính bảng

Trình chỉnh sửa web giữ nguyên bố cục máy tính để bàn trên mọi màn hình, nhưng dưới 900px rộng (một điện thoại hoặc máy tính bảng được giữ thẳng đứng), nó gập phần khung vào các ngăn kéo để đường thời gian vẫn còn chỗ:

- Nút **Menu** ở góc trên bên trái mở một ngăn kéo với thực đơn ứng dụng đầy đủ, các tab dự án, thanh hành động và thanh công cụ.
- Tiêu đề đường dẫn trượt vào trên các làn từ tay cầm **Tiêu đề đường dẫn** ở góc trên bên trái của đường thời gian, hoặc từ **Xem › Tiêu đề đường dẫn**. Nhấn vào các làn hoặc nhấn Escape để đóng chúng lại.
- Phần giới thiệu ở trên cùng của trình chỉnh sửa bị thu gọn theo mặc định trên các màn hình hẹp; **Hiển thị giới thiệu** sẽ hiển thị lại nó.

**Chỉnh sửa › Tùy chọn › Ngoại hình › Bố cục** chuyển đổi giữa Tự động, Nhỏ gọn và Máy tính để bàn, vì vậy một cửa sổ nhỏ trên máy tính để bàn có thể giữ nguyên khung máy tính để bàn và một máy tính bảng rộng có thể chọn sử dụng các ngăn kéo.

## Dự án không tự động di chuyển

Thư viện trình duyệt và máy tính để bàn là riêng biệt. Di chuyển dự án một cách có chủ ý:

- Sử dụng tệp dự án Soundscaper - `.sscape`, hoặc tệp dự án Framescaper - `.fscape` cho toàn bộ dự án.
- Sử dụng AUP4 khi bạn cần trao đổi âm thanh cụ thể với Audacity.
- Xuất âm thanh hoặc video đã xử lý dưới dạng bản sao phát lại bền.

Xem [Tệp dự án](/projects-and-data/project-files/) trước khi xóa dữ liệu trang web trình duyệt hoặc dữ liệu ứng dụng máy tính để bàn.

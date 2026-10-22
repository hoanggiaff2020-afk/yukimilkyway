# Bảng Ủy Thác (bản Netlify)

Mã nguồn để trên **GitHub**, web chạy trên **Netlify**.

> GitHub Pages không dùng được cho dự án này, vì nó chỉ chứa trang tĩnh, không có nơi chạy API và lưu dữ liệu.
> Netlify thì có: Functions (chạy API) và Blobs (lưu dữ liệu), nên không cần database ngoài.

## Cấu trúc

```
public/index.html              Giao diện
netlify/functions/api.mjs      API + kiểm tra quyền (Chủ / Admin / Thành viên)
netlify.toml                   Cấu hình Netlify
package.json                   Thư viện: @netlify/blobs, bcryptjs
```

## Đưa lên web (làm một lần)

1. **Đưa mã lên GitHub.** Vào github.com, tạo repository mới (ví dụ `bang-uy-thac`), chọn
   "uploading an existing file" và kéo thả toàn bộ nội dung thư mục này vào
   (giữ nguyên cấu trúc thư mục `public` và `netlify`). Bấm Commit.
2. **Tạo site trên Netlify.** Vào app.netlify.com, chọn "Add new site", rồi "Import an existing project",
   đăng nhập bằng GitHub và chọn repository vừa tạo. Các thiết lập đã có sẵn trong `netlify.toml`,
   cứ bấm Deploy.
3. **Mở địa chỉ Netlify cấp** (dạng `ten-site.netlify.app`). Lần đầu mở, trang yêu cầu tạo tài khoản Chủ.
4. Tạo tài khoản cho thành viên trong mục **Thành viên**, rồi gửi link cho mọi người.

Sau này sửa code: cập nhật file trên GitHub, Netlify tự deploy lại. Dữ liệu không bị mất khi deploy lại.

### Tùy chọn

- **Tên miền riêng:** Netlify, mục Domain management.
- **Biến môi trường `SESSION_SECRET`:** một chuỗi ngẫu nhiên dài (Site configuration, Environment variables).
  Nếu bỏ trống, hệ thống tự tạo và lưu khóa riêng.
- **Chạy thử trên máy:** cài Node.js, rồi `npm install -g netlify-cli`, `npm install`, `netlify dev`.

## Lưu ý quan trọng

- **Hạn mức miễn phí.** Mỗi lần trang gọi API tính là một lần chạy Function. Giao diện đã được đặt tự làm mới
  mỗi 20 giây khi đang mở tab, cộng thêm mỗi lần bạn thao tác. Với nhóm nhỏ thì thường ổn, nhưng hãy xem
  trang giá và hạn mức hiện tại của Netlify. Nếu gần chạm hạn mức, tăng 20000 trong `public/index.html`
  (dòng có `setInterval`) lên 60000.
- **Ghi đồng thời.** Dữ liệu lưu theo từng bản ghi nên rất hiếm khi đè nhau. Hai người bấm nhận cùng một phần
  việc trong đúng cùng một khoảnh khắc thì vẫn có khả năng cả hai thấy "nhận được" (server sẽ báo người đến sau nếu kịp).
- **Sao lưu.** Dữ liệu nằm trong Netlify Blobs, không có nút "tải file". Nếu cần bản sao lưu, hãy yêu cầu thêm chức năng xuất JSON.
- **Quên mật khẩu Chủ duy nhất** sẽ rất khó khôi phục. Hãy tạo thêm một Admin dự phòng.
- Bản này chưa được chạy thử trên Netlify thật. Hãy thử kỹ sau khi deploy.

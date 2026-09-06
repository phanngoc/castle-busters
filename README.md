# 🏰 Castle Busters

Game bắn phá lâu đài trên trình duyệt — 1 người chơi, canvas thuần, không dependency.
Lấy cảm hứng từ thể loại castle-battle: triển quân đánh giáp lá cà + bắn pháo vòng cung
phá tường gạch. Toàn bộ hình học, vật lý và AI viết bằng code, không import asset ngoài.

**Chơi thử: https://castle.bomclaw.org**

## Luật
- Vòng đấu **60 giây**, ai còn nhiều HP lâu đài hơn thì thắng. HP = số viên gạch còn lại.
- **Năng lượng** hồi ~1,05/giây, tối đa 10 — dùng để triển quân.
- 5 loại quân: Kỵ binh 🐎 · Kiếm sĩ 🛡️ · Cung thủ 🏹 · Pháo thủ 💣 · Khổng lồ 🪓 (giá 2–5 năng lượng).
- **Pháo** hồi 0,9s, bắn theo quỹ đạo vòng cung chịu trọng lực, phá gạch trực tiếp.
- Combo tính điểm giữ được trong 2,6 giây.

## Chạy
```bash
node server.js        # mặc định PORT=8789, HOST=127.0.0.1
```
Mở `http://127.0.0.1:8789` — hoặc mở thẳng `index.html`, không cần server.

## Cấu trúc
| File | Vai trò |
|---|---|
| `game.js` | Toàn bộ engine: vật lý, va chạm, AI, render, tính điểm |
| `index.html` | UI portrait tiếng Việt, tối ưu cảm ứng |
| `server.js` | Static file server zero-dependency |

## Ghi chú cân bằng
`CANNON_DMG` **phải ≥ `BRICK_HP`**. HP lâu đài tính bằng số gạch, nên nếu sát thương mỗi phát
thấp hơn máu một viên gạch thì bắn cả trận HP vẫn không giảm.

## License
MIT

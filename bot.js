require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");
const axios = require("axios"); // 🔥 1. Cần cài thêm thư viện axios: npm install axios

const app = express();
app.use(express.json());

const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
});

// 🔥 2. Danh sách ID Telegram của Admin được phép bấm duyệt (lấy từ .env hoặc khai báo mảng)
const ADMIN_IDS = process.env.ADMIN_IDS ? process.env.ADMIN_IDS.split(",").map(id => Number(id.trim())) : [];

// ==========================================
// 1. ROUTE TẠO ĐƠN & GỬI NÚT DUYỆT SANG TELEGRAM
// ==========================================
app.post("/api/create-order", async (req, res) => {
    try {
        const { username, amount, orderId } = req.body;

        if (!username || !amount || !orderId) {
            return res.status(400).json({
                success: false,
                message: "Thiếu thông tin đơn hàng"
            });
        }

        const message = `💰 <b>CÓ ĐƠN NẠP TIỀN MỚI</b>

👤 <b>User:</b> ${username}
💵 <b>Số tiền:</b> ${Number(amount).toLocaleString("vi-VN")}đ
🧾 <b>Mã đơn:</b> <code>${orderId}</code>

⏳ <b>Trạng thái:</b> CHỜ THANH TOÁN`;

        // 🔥 Chỉnh sửa: Thêm nút bấm Inline Keyboard
        await bot.sendMessage(
            process.env.ADMIN_CHAT_ID,
            message,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "✅ Đồng ý", callback_data: `approve:${orderId}` },
                            { text: "❌ Từ chối", callback_data: `reject:${orderId}` }
                        ]
                    ]
                }
            }
        );

        res.json({
            success: true,
            message: "Đã gửi thông báo Telegram"
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Lỗi server"
        });
    }
});

// ==========================================
// 🔥 2. BẮT SỰ KIỆN KHI ADMIN BẤM NÚT DUYỆT / TỪ CHỐI
// ==========================================
bot.on("callback_query", async (query) => {
    const userId = query.from.id;
    const adminUsername = query.from.username || query.from.first_name;
    const data = query.data; // Có dạng "approve:NAP123" hoặc "reject:NAP123"

    // Kiểm tra quyền Admin
    if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(userId)) {
        return bot.answerCallbackQuery(query.id, {
            text: "⛔ Bạn không có quyền duyệt đơn này!",
            show_alert: true
        });
    }

    const [action, orderId] = data.split(":");

    if (!["approve", "reject"].includes(action) || !orderId) {
        return bot.answerCallbackQuery(query.id, { text: "Yêu cầu không hợp lệ!" });
    }

    await bot.answerCallbackQuery(query.id, { text: "Đang xử lý..." });

    try {
        // Gửi request về API PHP trên Website để cập nhật DB và cộng tiền
        const response = await axios.post(process.env.WEBSITE_API_URL, {
            orderId: orderId,
            action: action,
            admin_username: adminUsername
        }, {
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Token": process.env.INTERNAL_SECRET_TOKEN
            }
        });

        const resData = response.data;

        if (resData.success) {
            const statusText = action === "approve" 
                ? `✅ <b>ĐÃ DUYỆT & CỘNG TIỀN</b> (Bởi @${adminUsername})` 
                : `❌ <b>ĐÃ TỪ CHỐI</b> (Bởi @${adminUsername})`;

            // Sửa lại tin nhắn cũ và ẨN NÚT BẤM để không bị bấm lại lần 2
            await bot.editMessageText(
                `${query.message.text}\n\n━━━━━━━━━━━━━━━━━━\n📌 <b>KẾT QUẢ:</b> ${statusText}`, 
                {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [] }
                }
            );
        }
    } catch (error) {
        console.error("Lỗi duyệt đơn:", error.response ? error.response.data : error.message);
        
        const errorMsg = error.response && error.response.data && error.response.data.message
            ? error.response.data.message
            : "Lỗi kết nối tới Server Website!";

        bot.answerCallbackQuery(query.id, {
            text: `⚠️ ${errorMsg}`,
            show_alert: true
        });
    }
});

// ==========================================
// CÁC COMMAND KHÁC GIỮ NGUYÊN
// ==========================================
app.get("/", (req, res) => {
    res.send("Gia Bao Telegram Bot is running!");
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

bot.onText(/^\/start$/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `👋 Chào ${msg.from.first_name || "bạn"}!

🤖 Gia Bảo Store Bot đang hoạt động.

📋 Lệnh:
/start
/help
/menu
/id
/ping`
    );
});

bot.onText(/^\/help$/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `📚 TRỢ GIÚP

/start - Khởi động bot
/help - Trợ giúp
/menu - Xem menu
/id - Xem Chat ID
/ping - Kiểm tra bot`
    );
});

bot.onText(/^\/menu$/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `📋 MENU GIA BẢO STORE

💰 Nạp tiền
👤 Tài khoản
💳 Số dư
🛒 Sản phẩm
📞 Hỗ trợ`
    );
});

bot.onText(/^\/ping$/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        "🏓 Pong!\n\n✅ Bot đang hoạt động."
    );
});

bot.onText(/^\/id$/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `🆔 Chat ID: ${msg.chat.id}\n\n👤 User ID: ${msg.from.id}`
    );
});

console.log("🤖 Telegram Bot đang chạy...");

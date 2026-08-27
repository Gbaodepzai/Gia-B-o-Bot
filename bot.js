require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json({ limit: "64kb" }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WEBSITE_API_URL = process.env.WEBSITE_API_URL;
const INTERNAL_SECRET_TOKEN = process.env.INTERNAL_SECRET_TOKEN || "";
const ADMIN_IDS = process.env.ADMIN_IDS
    ? process.env.ADMIN_IDS.split(",").map(id => Number(id.trim())).filter(Boolean)
    : [];

if (!BOT_TOKEN) {
    console.error("❌ Thiếu BOT_TOKEN");
    process.exit(1);
}
if (!ADMIN_CHAT_ID) {
    console.error("❌ Thiếu ADMIN_CHAT_ID");
    process.exit(1);
}
if (!WEBSITE_API_URL) {
    console.error("❌ Thiếu WEBSITE_API_URL");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function money(value) {
    return Number(value || 0).toLocaleString("vi-VN") + "đ";
}

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

// Website gọi route này ngay sau khi tạo đơn.
// Route này chỉ gửi thông báo Telegram, KHÔNG tự cộng tiền.
app.post("/api/create-order", async (req, res) => {
    try {
        const { username, amount, orderId, payment_content } = req.body || {};

        if (!username || !amount || !orderId) {
            return res.status(400).json({
                success: false,
                message: "Thiếu username, amount hoặc orderId"
            });
        }

        const message =
`💰 <b>CÓ ĐƠN NẠP TIỀN MỚI</b>

👤 <b>User:</b> ${esc(username)}
💵 <b>Số tiền:</b> ${money(amount)}
🧾 <b>Mã đơn:</b> <code>${esc(orderId)}</code>
🏦 <b>Nội dung CK:</b> <code>${esc(payment_content || "")}</code>

⏳ <b>Trạng thái:</b> CHỜ THANH TOÁN`;

        const sent = await bot.sendMessage(ADMIN_CHAT_ID, message, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Đồng ý", callback_data: `approve:${orderId}` },
                    { text: "❌ Từ chối", callback_data: `reject:${orderId}` }
                ]]
            }
        });

        console.log(`✅ Đã gửi Telegram: ${orderId}, message_id=${sent.message_id}`);

        return res.json({
            success: true,
            message: "Đã gửi thông báo Telegram",
            telegram_message_id: sent.message_id
        });
    } catch (error) {
        console.error("❌ /api/create-order:", error);
        return res.status(500).json({
            success: false,
            message: error?.message || "Không gửi được Telegram"
        });
    }
});

bot.on("callback_query", async (query) => {
    const userId = query.from.id;
    const adminUsername = query.from.username || query.from.first_name || String(userId);
    const data = query.data || "";

    if (ADMIN_IDS.length > 0 && !ADMIN_IDS.includes(userId)) {
        return bot.answerCallbackQuery(query.id, {
            text: "⛔ Bạn không có quyền duyệt đơn này!",
            show_alert: true
        });
    }

    const [action, orderId] = data.split(":");

    if (!["approve", "reject"].includes(action) || !orderId) {
        return bot.answerCallbackQuery(query.id, {
            text: "Yêu cầu không hợp lệ!",
            show_alert: true
        });
    }

    await bot.answerCallbackQuery(query.id, { text: "Đang xử lý..." });

    try {
        const response = await fetch(WEBSITE_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Internal-Token": INTERNAL_SECRET_TOKEN
            },
            body: JSON.stringify({
                orderId,
                action,
                admin_username: adminUsername
            })
        });

        const text = await response.text();
        let result;
        try {
            result = JSON.parse(text);
        } catch {
            result = { success: false, message: text || `HTTP ${response.status}` };
        }

        if (!response.ok || !result.success) {
            throw new Error(result.message || `Website trả HTTP ${response.status}`);
        }

        const statusText = action === "approve"
            ? `✅ <b>ĐÃ DUYỆT & CỘNG TIỀN</b> (Bởi @${esc(adminUsername)})`
            : `❌ <b>ĐÃ TỪ CHỐI</b> (Bởi @${esc(adminUsername)})`;

        if (query.message) {
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
        console.error("❌ Lỗi duyệt đơn:", error.message);
        await bot.answerCallbackQuery(query.id, {
            text: `⚠️ ${error.message}`,
            show_alert: true
        });
    }
});

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "Gia Bao Telegram Bot",
        telegram: true
    });
});

app.get("/health", (req, res) => {
    res.json({ ok: true });
});

const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 HTTP server listening on 0.0.0.0:${PORT}`);
    console.log("🤖 Telegram Bot đang chạy...");
    console.log(`📨 ADMIN_CHAT_ID=${ADMIN_CHAT_ID}`);
    console.log(`🌐 WEBSITE_API_URL=${WEBSITE_API_URL}`);
});

bot.on("polling_error", (error) => {
    console.error("❌ Telegram polling:", error.message);
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
    bot.sendMessage(msg.chat.id, "🏓 Pong!\n\n✅ Bot đang hoạt động.");
});

bot.onText(/^\/id$/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        `🆔 Chat ID: ${msg.chat.id}\n\n👤 User ID: ${msg.from.id}`
    );
});

require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json({ limit: "1mb" }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const INTERNAL_SECRET_TOKEN = process.env.INTERNAL_SECRET_TOKEN;
const AUTO_APPROVE_SMS =
    String(process.env.AUTO_APPROVE_SMS || "true").toLowerCase() === "true";

if (!BOT_TOKEN) {
    console.error("❌ Thiếu BOT_TOKEN");
    process.exit(1);
}
if (!ADMIN_CHAT_ID) {
    console.error("❌ Thiếu ADMIN_CHAT_ID");
    process.exit(1);
}
if (!INTERNAL_SECRET_TOKEN) {
    console.error("❌ Thiếu INTERNAL_SECRET_TOKEN");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function esc(v) {
    return String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function money(v) {
    return Number(v || 0).toLocaleString("vi-VN") + " VNĐ";
}

app.get("/", (req, res) => {
    res.json({
        ok: true,
        service: "Gia Bao Telegram Bot",
        auto_approve_sms: AUTO_APPROVE_SMS
    });
});

app.get("/health", (req, res) => {
    res.json({
        ok: true,
        auto_approve_sms: AUTO_APPROVE_SMS
    });
});

/*
 * Website gọi route này khi tạo đơn.
 * Đây chỉ là thông báo "đang chờ thanh toán".
 */
app.post("/api/create-order", async (req, res) => {
    try {
        const { username, amount, orderId, payment_content } = req.body || {};

        if (!username || !amount || !orderId) {
            return res.status(400).json({
                success: false,
                message: "Thiếu username, amount hoặc orderId"
            });
        }

        const text =
`💰 <b>CÓ ĐƠN NẠP TIỀN MỚI</b>

👤 <b>User:</b> ${esc(username)}
💵 <b>Số tiền:</b> ${money(amount)}
🧾 <b>Mã đơn:</b> <code>${esc(orderId)}</code>
🏦 <b>Nội dung:</b> <code>${esc(payment_content || "")}</code>

⏳ <b>Trạng thái:</b> CHỜ THANH TOÁN`;

        await bot.sendMessage(ADMIN_CHAT_ID, text, {
            parse_mode: "HTML"
        });

        return res.json({
            success: true,
            message: "Đã gửi thông báo Telegram"
        });
    } catch (error) {
        console.error("❌ /api/create-order:", error.message);
        return res.status(500).json({
            success: false,
            message: "Không thể gửi Telegram"
        });
    }
});

/*
 * sms_webhook.php gọi route này SAU KHI PHP đã xác thực:
 * - X-SMS-Secret
 * - mã GIABAOSTORE + 8 ký tự
 * - đơn pending
 * - số tiền khớp chính xác
 * - transaction_id chưa được xử lý
 * - tài khoản khách tồn tại
 *
 * Route này CHỈ gửi thông báo Telegram.
 * Nó KHÔNG cộng tiền lần nữa.
 */
app.post("/api/payment-notification", async (req, res) => {
    try {
        const provided = String(req.get("X-Internal-Token") || "");

        if (!provided || provided !== INTERNAL_SECRET_TOKEN) {
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        if (!AUTO_APPROVE_SMS) {
            return res.status(403).json({
                success: false,
                message: "AUTO_APPROVE_SMS đang tắt"
            });
        }

        const {
            username,
            amount,
            orderId,
            payment_content,
            transaction_id,
            sender,
            balance_before,
            balance_after
        } = req.body || {};

        if (!username || !amount || !orderId || !payment_content) {
            return res.status(400).json({
                success: false,
                message: "Thiếu dữ liệu thanh toán"
            });
        }

        const text =
`[✅] <b>NẠP TIỀN THÀNH CÔNG</b>
━━━━━━━━━━━━━━━━━━
[💵] Số tiền: <b>+${Number(amount).toLocaleString("vi-VN")} VNĐ</b>
[💳] Mã CK: <code>${esc(payment_content)}</code>
[🆔] Mã GD: <code>${esc(transaction_id || "Không có")}</code>
[📝] Ghi chú: Xác nhận tự động qua SMS ngân hàng, không cần bấm Duyệt.
━━━━━━━━━━━━━━━━━━
<b>Số dư khách hàng đã được cộng tự động.</b>

👤 Tài khoản: <code>${esc(username)}</code>
💰 Số dư sau: <b>${money(balance_after)}</b>`;

        await bot.sendMessage(ADMIN_CHAT_ID, text, {
            parse_mode: "HTML"
        });

        console.log(
            `✅ AUTO APPROVED: ${orderId} / ${amount} / ${payment_content}`
        );

        return res.json({
            success: true,
            telegram_sent: true,
            message: "Đã gửi thông báo nạp tiền thành công"
        });
    } catch (error) {
        console.error("❌ /api/payment-notification:", error.message);
        return res.status(500).json({
            success: false,
            message: "Không gửi được Telegram"
        });
    }
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

app.listen(Number(process.env.PORT) || 3000, "0.0.0.0", () => {
    console.log(
        `🚀 HTTP server listening on 0.0.0.0:${Number(process.env.PORT) || 3000}`
    );
    console.log("🤖 Telegram Bot đang chạy...");
    console.log(`🤖 AUTO_APPROVE_SMS=${AUTO_APPROVE_SMS}`);
});

bot.on("polling_error", (error) => {
    console.error("❌ Telegram polling:", error.message);
});

require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json({ limit: "1mb" }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WEBSITE_API_URL = process.env.WEBSITE_API_URL;
const INTERNAL_SECRET_TOKEN = process.env.INTERNAL_SECRET_TOKEN;
const AUTO_APPROVE_SMS = String(process.env.AUTO_APPROVE_SMS || "false").toLowerCase() === "true";

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
    .split(",")
    .map(id => id.trim())
    .filter(Boolean)
    .map(id => Number(id))
    .filter(id => Number.isInteger(id));

if (!BOT_TOKEN) { console.error("❌ Thiếu BOT_TOKEN"); process.exit(1); }
if (!ADMIN_CHAT_ID) { console.error("❌ Thiếu ADMIN_CHAT_ID"); process.exit(1); }
if (!WEBSITE_API_URL) { console.error("❌ Thiếu WEBSITE_API_URL"); process.exit(1); }
if (!INTERNAL_SECRET_TOKEN) { console.error("❌ Thiếu INTERNAL_SECRET_TOKEN"); process.exit(1); }
if (ADMIN_IDS.length === 0) { console.error("❌ Thiếu ADMIN_IDS"); process.exit(1); }

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function processDeposit(orderId, action, actor) {
    const response = await fetch(WEBSITE_API_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "X-Internal-Token": INTERNAL_SECRET_TOKEN
        },
        body: JSON.stringify({
            orderId,
            action,
            admin_username: actor
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
        throw new Error(result.message || `Website API trả HTTP ${response.status}`);
    }

    return result;
}

// Website gọi khi khách vừa tạo đơn.
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

👤 <b>User:</b> ${escapeHtml(username)}
💵 <b>Số tiền:</b> ${Number(amount).toLocaleString("vi-VN")}đ
🧾 <b>Mã đơn:</b> <code>${escapeHtml(orderId)}</code>
🏦 <b>Nội dung CK:</b> <code>${escapeHtml(payment_content || "")}</code>

⏳ <b>Trạng thái:</b> CHỜ THANH TOÁN`;

        await bot.sendMessage(ADMIN_CHAT_ID, message, {
            parse_mode: "HTML",
            reply_markup: {
                inline_keyboard: [[
                    { text: "✅ Đồng ý", callback_data: `approve:${orderId}` },
                    { text: "❌ Từ chối", callback_data: `reject:${orderId}` }
                ]]
            }
        });

        res.json({ success: true, message: "Đã gửi thông báo Telegram" });
    } catch (error) {
        console.error("❌ /api/create-order:", error.message);
        res.status(500).json({ success: false, message: "Không thể gửi thông báo Telegram" });
    }
});

// sms_webhook.php gọi route này sau khi SMS đã được kiểm tra:
// - mã GIABAOSTORE hợp lệ
// - đơn đang pending
// - số tiền SMS khớp số tiền đơn
// - giao dịch chưa trùng
app.post("/api/payment-received", async (req, res) => {
    try {
        const suppliedToken = req.get("X-Internal-Token") || "";
        if (!suppliedToken || suppliedToken !== INTERNAL_SECRET_TOKEN) {
            return res.status(401).json({ success: false, message: "Unauthorized" });
        }

        const { username, amount, orderId, payment_content, transaction_id, sender, sms_message } = req.body || {};

        if (!username || !amount || !orderId || !payment_content) {
            return res.status(400).json({ success: false, message: "Thiếu dữ liệu thanh toán" });
        }

        const cleanOrderId = String(orderId).trim();
        const cleanUsername = String(username).trim();
        const numericAmount = Number(amount);

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({ success: false, message: "Số tiền không hợp lệ" });
        }

        const safeContent = escapeHtml(payment_content);
        const safeSender = escapeHtml(sender || "");
        const safeTransaction = escapeHtml(transaction_id || "");

        if (AUTO_APPROVE_SMS) {
            const result = await processDeposit(cleanOrderId, "approve", "SMS-AUTO");

            await bot.sendMessage(
                ADMIN_CHAT_ID,
`🤖 <b>TỰ ĐỘNG DUYỆT NẠP TIỀN</b>

👤 <b>User:</b> ${escapeHtml(cleanUsername)}
💵 <b>Số tiền:</b> ${numericAmount.toLocaleString("vi-VN")}đ
🧾 <b>Mã đơn:</b> <code>${escapeHtml(cleanOrderId)}</code>
🏦 <b>Nội dung:</b> <code>${safeContent}</code>
📨 <b>Sender:</b> ${safeSender}
🔖 <b>Mã giao dịch:</b> <code>${safeTransaction}</code>

✅ <b>ĐÃ CỘNG TIỀN TỰ ĐỘNG</b>`,
                { parse_mode: "HTML" }
            );

            console.log(`✅ AUTO APPROVE ${cleanOrderId} ${numericAmount}`);

            return res.json({
                success: true,
                auto_approved: true,
                orderId: cleanOrderId,
                result
            });
        }

        // Nếu AUTO_APPROVE_SMS=false: chỉ báo Telegram để admin duyệt.
        const sent = await bot.sendMessage(
            ADMIN_CHAT_ID,
`💳 <b>ĐÃ NHẬN THANH TOÁN</b>

👤 <b>User:</b> ${escapeHtml(cleanUsername)}
💵 <b>Số tiền:</b> ${numericAmount.toLocaleString("vi-VN")}đ
🧾 <b>Mã đơn:</b> <code>${escapeHtml(cleanOrderId)}</code>
🏦 <b>Nội dung:</b> <code>${safeContent}</code>
📨 <b>Sender:</b> ${safeSender}
🔖 <b>Mã giao dịch:</b> <code>${safeTransaction}</code>

⏳ Chờ Admin xác nhận.`,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [[
                        { text: "✅ Đồng ý", callback_data: `approve:${cleanOrderId}` },
                        { text: "❌ Từ chối", callback_data: `reject:${cleanOrderId}` }
                    ]]
                }
            }
        );

        res.json({
            success: true,
            auto_approved: false,
            telegram_message_id: sent.message_id,
            orderId: cleanOrderId
        });
    } catch (error) {
        console.error("❌ /api/payment-received:", error.message);
        res.status(500).json({
            success: false,
            message: error.message || "Không xử lý được thanh toán"
        });
    }
});

// Nút Telegram duyệt/từ chối thủ công.
bot.on("callback_query", async (query) => {
    const userId = query.from?.id;
    const adminUsername =
        query.from?.username ||
        query.from?.first_name ||
        `ID ${userId}`;

    if (!ADMIN_IDS.includes(userId)) {
        return bot.answerCallbackQuery(query.id, {
            text: "⛔ Bạn không có quyền duyệt đơn này!",
            show_alert: true
        });
    }

    const data = query.data || "";
    const separatorIndex = data.indexOf(":");
    const action = separatorIndex >= 0 ? data.slice(0, separatorIndex) : "";
    const orderId = separatorIndex >= 0 ? data.slice(separatorIndex + 1) : "";

    if (!["approve", "reject"].includes(action) || !orderId) {
        return bot.answerCallbackQuery(query.id, {
            text: "⚠️ Yêu cầu không hợp lệ!",
            show_alert: true
        });
    }

    await bot.answerCallbackQuery(query.id, { text: "Đang xử lý..." });

    try {
        const result = await processDeposit(orderId, action, adminUsername);

        const statusText = action === "approve"
            ? `✅ <b>ĐÃ DUYỆT &amp; CỘNG TIỀN</b> (Bởi @${escapeHtml(adminUsername)})`
            : `❌ <b>ĐÃ TỪ CHỐI</b> (Bởi @${escapeHtml(adminUsername)})`;

        if (query.message) {
            const oldText = escapeHtml(query.message.text || "ĐƠN NẠP TIỀN");
            await bot.editMessageText(
                `${oldText}\n\n━━━━━━━━━━━━━━━━━━\n📌 <b>KẾT QUẢ:</b> ${statusText}`,
                {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: "HTML",
                    reply_markup: { inline_keyboard: [] }
                }
            );
        }

        console.log(`✅ ${action} ${orderId} by ${adminUsername}`, result);
    } catch (error) {
        console.error("❌ Lỗi duyệt/từ chối:", error.message);
        await bot.sendMessage(
            ADMIN_CHAT_ID,
            `⚠️ <b>KHÔNG XỬ LÝ ĐƯỢC ĐƠN</b>\n\n🧾 ${escapeHtml(orderId)}\n❌ ${escapeHtml(error.message)}`,
            { parse_mode: "HTML" }
        );
    }
});

app.get("/", (req, res) => res.json({
    ok: true,
    service: "Gia Bao Telegram Bot",
    auto_approve_sms: AUTO_APPROVE_SMS
}));

app.get("/health", (req, res) => res.json({
    ok: true,
    auto_approve_sms: AUTO_APPROVE_SMS
}));

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on 0.0.0.0:${PORT}`);
    console.log(`🤖 Telegram Bot đang chạy`);
    console.log(`🤖 AUTO_APPROVE_SMS=${AUTO_APPROVE_SMS}`);
});

bot.on("polling_error", error => {
    console.error("❌ Telegram polling:", error.message);
});

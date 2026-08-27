require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json({ limit: "1mb" }));

// ================================
// ENVIRONMENT VARIABLES
// ================================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const WEBSITE_API_URL = process.env.WEBSITE_API_URL;
const INTERNAL_SECRET_TOKEN = process.env.INTERNAL_SECRET_TOKEN;

const ADMIN_IDS = (process.env.ADMIN_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id));

if (!BOT_TOKEN) {
    console.error("❌ Thiếu biến môi trường BOT_TOKEN");
    process.exit(1);
}

if (!ADMIN_CHAT_ID) {
    console.error("❌ Thiếu biến môi trường ADMIN_CHAT_ID");
    process.exit(1);
}

if (!WEBSITE_API_URL) {
    console.error("❌ Thiếu biến môi trường WEBSITE_API_URL");
    process.exit(1);
}

if (!INTERNAL_SECRET_TOKEN) {
    console.error("❌ Thiếu biến môi trường INTERNAL_SECRET_TOKEN");
    process.exit(1);
}

if (ADMIN_IDS.length === 0) {
    console.error("❌ Thiếu ADMIN_IDS. Không khởi động bot để tránh người lạ có thể duyệt đơn.");
    process.exit(1);
}

const bot = new TelegramBot(BOT_TOKEN, {
    polling: true
});

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// ==========================================
// 1. TẠO ĐƠN -> GỬI THÔNG BÁO TELEGRAM
// ==========================================
app.post("/api/create-order", async (req, res) => {
    try {
        const { username, amount, orderId } = req.body || {};

        if (
            username === undefined ||
            username === null ||
            String(username).trim() === "" ||
            amount === undefined ||
            amount === null ||
            orderId === undefined ||
            orderId === null ||
            String(orderId).trim() === ""
        ) {
            return res.status(400).json({
                success: false,
                message: "Thiếu thông tin đơn hàng"
            });
        }

        const numericAmount = Number(amount);

        if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
            return res.status(400).json({
                success: false,
                message: "Số tiền không hợp lệ"
            });
        }

        const safeUsername = escapeHtml(String(username).trim());
        const safeOrderId = escapeHtml(String(orderId).trim());

        const message = `💰 <b>CÓ ĐƠN NẠP TIỀN MỚI</b>

👤 <b>User:</b> ${safeUsername}
💵 <b>Số tiền:</b> ${numericAmount.toLocaleString("vi-VN")}đ
🧾 <b>Mã đơn:</b> <code>${safeOrderId}</code>

⏳ <b>Trạng thái:</b> CHỜ THANH TOÁN`;

        await bot.sendMessage(
            ADMIN_CHAT_ID,
            message,
            {
                parse_mode: "HTML",
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "✅ Đồng ý",
                                callback_data: `approve:${String(orderId).trim()}`
                            },
                            {
                                text: "❌ Từ chối",
                                callback_data: `reject:${String(orderId).trim()}`
                            }
                        ]
                    ]
                }
            }
        );

        return res.json({
            success: true,
            message: "Đã gửi thông báo Telegram"
        });
    } catch (error) {
        console.error("❌ Lỗi /api/create-order:", error);

        return res.status(500).json({
            success: false,
            message: "Không thể gửi thông báo Telegram"
        });
    }
});

// ==========================================
// 2. ADMIN BẤM DUYỆT / TỪ CHỐI
// ==========================================
bot.on("callback_query", async (query) => {
    const userId = query.from?.id;
    const adminUsername =
        query.from?.username ||
        query.from?.first_name ||
        `ID ${userId}`;

    const data = query.data || "";

    // Phải trả lời callback để Telegram không treo nút loading.
    try {
        await bot.answerCallbackQuery(query.id);
    } catch (error) {
        console.error("⚠️ Không thể answerCallbackQuery:", error.message);
    }

    // Chỉ Admin được phép thao tác.
    if (!ADMIN_IDS.includes(userId)) {
        try {
            await bot.answerCallbackQuery(query.id, {
                text: "⛔ Bạn không có quyền duyệt đơn này!",
                show_alert: true
            });
        } catch (_) {}

        return;
    }

    const separatorIndex = data.indexOf(":");
    const action = separatorIndex >= 0 ? data.slice(0, separatorIndex) : "";
    const orderId = separatorIndex >= 0 ? data.slice(separatorIndex + 1) : "";

    if (!["approve", "reject"].includes(action) || !orderId) {
        try {
            await bot.answerCallbackQuery(query.id, {
                text: "⚠️ Yêu cầu không hợp lệ!",
                show_alert: true
            });
        } catch (_) {}

        return;
    }

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

        let resData = {};
        try {
            resData = await response.json();
        } catch (_) {
            resData = {};
        }

        if (!response.ok || !resData.success) {
            const errorMessage =
                resData.message ||
                `Website API trả về HTTP ${response.status}`;

            console.error("❌ Website API:", response.status, resData);

            try {
                await bot.answerCallbackQuery(query.id, {
                    text: `⚠️ ${errorMessage}`.slice(0, 200),
                    show_alert: true
                });
            } catch (_) {}

            return;
        }

        const safeAdminUsername = escapeHtml(adminUsername);

        const statusText =
            action === "approve"
                ? `✅ <b>ĐÃ DUYỆT &amp; CỘNG TIỀN</b> (Bởi @${safeAdminUsername})`
                : `❌ <b>ĐÃ TỪ CHỐI</b> (Bởi @${safeAdminUsername})`;

        const oldText = query.message?.text || "ĐƠN NẠP TIỀN";
        const safeOldText = escapeHtml(oldText);

        // Xóa nút sau khi xử lý thành công để tránh bấm lại.
        if (query.message) {
            await bot.editMessageText(
                `${safeOldText}\n\n━━━━━━━━━━━━━━━━━━\n📌 <b>KẾT QUẢ:</b> ${statusText}`,
                {
                    chat_id: query.message.chat.id,
                    message_id: query.message.message_id,
                    parse_mode: "HTML",
                    reply_markup: {
                        inline_keyboard: []
                    }
                }
            );
        }

        console.log(
            `✅ Đã ${action === "approve" ? "duyệt" : "từ chối"} đơn ${orderId} bởi ${adminUsername}`
        );
    } catch (error) {
        console.error(
            "❌ Lỗi xử lý duyệt/từ chối:",
            error.message
        );

        try {
            await bot.answerCallbackQuery(query.id, {
                text: "⚠️ Lỗi kết nối tới Server Website!",
                show_alert: true
            });
        } catch (_) {}
    }
});

// ==========================================
// HEALTH CHECK
// ==========================================
app.get("/", (req, res) => {
    res.status(200).send("Gia Bao Telegram Bot is running!");
});

app.get("/health", (req, res) => {
    res.status(200).json({
        success: true,
        status: "ok"
    });
});

// ==========================================
// SERVER
// ==========================================
const PORT = Number(process.env.PORT) || 3000;

app.listen(PORT, "0.0.0.0", () => {
    console.log(`🚀 Server running on port ${PORT}`);
    console.log("🤖 Telegram Bot đang chạy...");
});

// ==========================================
// TELEGRAM COMMANDS
// ==========================================
bot.onText(/^\/start$/, async (msg) => {
    await bot.sendMessage(
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

bot.onText(/^\/help$/, async (msg) => {
    await bot.sendMessage(
        msg.chat.id,
        `📚 TRỢ GIÚP

/start - Khởi động bot
/help - Trợ giúp
/menu - Xem menu
/id - Xem Chat ID
/ping - Kiểm tra bot`
    );
});

bot.onText(/^\/menu$/, async (msg) => {
    await bot.sendMessage(
        msg.chat.id,
        `📋 MENU GIA BẢO STORE

💰 Nạp tiền
👤 Tài khoản
💳 Số dư
🛒 Sản phẩm
📞 Hỗ trợ`
    );
});

bot.onText(/^\/ping$/, async (msg) => {
    await bot.sendMessage(
        msg.chat.id,
        "🏓 Pong!\n\n✅ Bot đang hoạt động."
    );
});

bot.onText(/^\/id$/, async (msg) => {
    await bot.sendMessage(
        msg.chat.id,
        `🆔 Chat ID: ${msg.chat.id}\n\n👤 User ID: ${msg.from.id}`
    );
});

bot.on("polling_error", (error) => {
    console.error("❌ Telegram polling error:", error.message);
});

bot.on("error", (error) => {
    console.error("❌ Telegram bot error:", error.message);
});

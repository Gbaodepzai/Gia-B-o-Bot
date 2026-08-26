require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();

const bot = new TelegramBot(process.env.BOT_TOKEN, {
    polling: true
});

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
        `🆔 Chat ID: ${msg.chat.id}

👤 User ID: ${msg.from.id}`
    );
});

console.log("🤖 Telegram Bot đang chạy...");
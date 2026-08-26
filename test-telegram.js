require("dotenv").config();

const TelegramBot = require("node-telegram-bot-api");

const bot = new TelegramBot(process.env.BOT_TOKEN);

bot.sendMessage(
    process.env.ADMIN_CHAT_ID,
    "✅ Gia Bảo Store Bot đã kết nối thành công!"
)
.then(() => {
    console.log("Đã gửi Telegram thành công!");
})
.catch(err => {
    console.error("Lỗi:", err.message);
});
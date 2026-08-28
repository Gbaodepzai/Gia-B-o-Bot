require("dotenv").config();

const express = require("express");
const TelegramBot = require("node-telegram-bot-api");

const app = express();
app.use(express.json({ limit: "1mb" }));

const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID;
const INTERNAL_SECRET_TOKEN = process.env.INTERNAL_SECRET_TOKEN;
const AUTO_APPROVE_SMS = String(process.env.AUTO_APPROVE_SMS || "true").toLowerCase() === "true";

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
 * Giữ lại thông báo đơn mới để Admin biết có người đang nạp.
 * Đây KHÔNG phải bước cộng tiền.
 */
app.post("/api/create-order", async (req, res) => {
    try {
        const { username, amount, orderId, payment_content } = req.body || {};

        console.log("📥 /api/create-order:", JSON.stringify({
            username,
            amount,
            orderId,
            payment_content
        }));

        if (!username || !amount || !orderId) {
            return res.status(400).json({
                success: false,
                message: "Thiếu username, amount hoặc orderId"
            });
        }

        const text =
`💰 <b>CÓ ĐƠN NẠP TIỀN MỚI</b>

👤 <b>User:</b> ${esc(username)}
💵 <b>Số tiền:</b> ${Number(amount).toLocaleString("vi-VN")}đ
🧾 <b>Mã đơn:</b> <code>${esc(orderId)}</code>
🏦 <b>Nội dung:</b> <code>${esc(payment_content || "")}</code>

⏳ Chờ khách chuyển khoản...`;

        console.log("📤 /api/create-order → Telegram chat:", ADMIN_CHAT_ID);

        const telegramResult = await bot.sendMessage(ADMIN_CHAT_ID, text, {
            parse_mode: "HTML"
        });

        console.log("✅ /api/create-order Telegram OK:", telegramResult.message_id);

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
 * sms_webhook.php gọi route này SAU KHI PHP đã:
 * - xác thực X-SMS-Secret
 * - tìm GIABAOSTORE + 8 ký tự
 * - tìm đúng đơn pending
 * - đối chiếu số tiền
 * - chống giao dịch trùng
 * - cộng tiền và chuyển đơn sang approved
 *
 * Route này CHỈ thông báo Telegram.
 * Nó không gọi process_deposit.php nên không gặp trang anti-bot
 * của hosting PHP và không cộng tiền lần thứ hai.
 */
app.post("/api/payment-notification", async (req, res) => {
    try {
        console.log("📥 NHẬN PAYMENT NOTIFICATION:", JSON.stringify(req.body || {}));

        const provided = String(req.get("X-Internal-Token") || "");

        console.log(
            "🔐 Kiểm tra X-Internal-Token:",
            provided ? "ĐÃ NHẬN" : "KHÔNG CÓ"
        );

        if (!provided || provided !== INTERNAL_SECRET_TOKEN) {
            console.error("❌ /api/payment-notification: Unauthorized");
            return res.status(401).json({
                success: false,
                message: "Unauthorized"
            });
        }

        const {
            username,
            amount,
            orderId,
            payment_content,
            transaction_id,
            sender,
            sms_message,
            balance_before,
            balance_after
        } = req.body || {};

        if (!username || !amount || !orderId || !payment_content) {
            console.error("❌ /api/payment-notification: Thiếu dữ liệu thanh toán");
            return res.status(400).json({
                success: false,
                message: "Thiếu dữ liệu thanh toán"
            });
        }

        const text =
`🤖 <b>TỰ ĐỘNG DUYỆT NẠP TIỀN</b>

👤 <b>User:</b> ${esc(username)}
💵 <b>Số tiền:</b> ${Number(amount).toLocaleString("vi-VN")}đ
🧾 <b>Mã đơn:</b> <code>${esc(orderId)}</code>
🏦 <b>Nội dung CK:</b> <code>${esc(payment_content)}</code>
🔖 <b>Mã giao dịch:</b> <code>${esc(transaction_id || "Không có")}</code>
📨 <b>Người gửi:</b> ${esc(sender || "Không rõ")}

💳 <b>Số dư trước:</b> ${Number(balance_before ?? 0).toLocaleString("vi-VN")}đ
💳 <b>Số dư sau:</b> ${Number(balance_after ?? 0).toLocaleString("vi-VN")}đ

✅ <b>ĐÃ CỘNG TIỀN TỰ ĐỘNG</b>`;

        console.log("📤 ĐANG GỬI TELEGRAM:", ADMIN_CHAT_ID);
        console.log("📤 Nội dung Telegram cho order:", orderId);

        const telegramResult = await bot.sendMessage(ADMIN_CHAT_ID, text, {
            parse_mode: "HTML"
        });

        console.log(
            "✅ TELEGRAM ĐÃ GỬI:",
            `chat_id=${ADMIN_CHAT_ID}, message_id=${telegramResult.message_id}, orderId=${orderId}`
        );

        console.log(`✅ AUTO APPROVED: ${orderId} / ${amount}`);

        return res.json({
            success: true,
            message: "Đã gửi thông báo tự động duyệt"
        });
    } catch (error) {
        console.error("❌ /api/payment-notification:", error.message);
        console.error("❌ Chi tiết lỗi:", error.stack);

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
/ping

🛠️ ADMIN:
/dangcho - Đơn nạp đang chờ duyệt
/thongke - Thống kê hôm nay
/tonkho - Sản phẩm sắp hết
/donhang - Đơn hàng gần đây`
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
/ping - Kiểm tra bot

🛠️ ADMIN:
/dangcho - Đơn nạp đang chờ duyệt
/thongke - Thống kê hôm nay
/tonkho - Sản phẩm sắp hết
/donhang - Đơn hàng gần đây`
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
📞 Hỗ trợ

🛠️ LỆNH ADMIN:
/dangcho
/thongke
/tonkho
/donhang`
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


// ============================================================
// ADMIN COMMANDS - THỐNG KÊ / ĐƠN CHỜ / TỒN KHO
// ============================================================

const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : process.cwd();

const USERS_FILE = process.env.USERS_FILE
    ? path.resolve(process.env.USERS_FILE)
    : path.join(DATA_DIR, "users.json");

const ORDERS_FILE = process.env.ORDERS_FILE
    ? path.resolve(process.env.ORDERS_FILE)
    : path.join(DATA_DIR, "orders.json");

const PRODUCTS_FILE = process.env.PRODUCTS_FILE
    ? path.resolve(process.env.PRODUCTS_FILE)
    : path.join(DATA_DIR, "products.json");

const LOW_STOCK_THRESHOLD = Number(process.env.LOW_STOCK_THRESHOLD || 1);

function isAdmin(msg) {
    return String(msg.chat.id) === String(ADMIN_CHAT_ID);
}

async function adminOnly(msg, handler) {
    if (!isAdmin(msg)) {
        return bot.sendMessage(msg.chat.id, "⛔ Bạn không có quyền sử dụng lệnh quản trị.");
    }
    try {
        await handler();
    } catch (error) {
        console.error("❌ Lỗi lệnh admin:", error);
        await bot.sendMessage(
            msg.chat.id,
            "❌ Không thể lấy dữ liệu.\n\n" +
            "Kiểm tra users.json / orders.json / products.json có nằm đúng thư mục DATA_DIR chưa."
        );
    }
}

function readJson(file, fallback = []) {
    if (!fs.existsSync(file)) return fallback;
    try {
        const data = JSON.parse(fs.readFileSync(file, "utf8"));
        return data;
    } catch (error) {
        console.error(`❌ Không đọc được ${file}:`, error.message);
        return fallback;
    }
}

function money(value) {
    const n = Number(value || 0);
    return n.toLocaleString("vi-VN") + " VNĐ";
}

function dateVN(value) {
    if (!value) return "Không rõ thời gian";
    const d = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleString("vi-VN", {
        timeZone: "Asia/Ho_Chi_Minh",
        hour12: false
    });
}

function dateKeyVN(value) {
    if (!value) return "";
    const d = new Date(String(value).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(d);
}

function todayKeyVN() {
    return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date());
}

function isApproved(status) {
    return ["approved", "completed", "success", "paid", "done"].includes(
        String(status || "").toLowerCase()
    );
}

function isDepositOrder(order) {
    const id = String(order?.orderId || "").toUpperCase();
    const type = String(order?.type || order?.order_type || "").toLowerCase();
    return (
        id.startsWith("NAP") ||
        type.includes("deposit") ||
        type.includes("nap") ||
        order?.payment_content != null
    );
}

function getOrderTime(order) {
    return (
        order?.created_at ||
        order?.createdAt ||
        order?.time ||
        order?.payment_received_at ||
        order?.updated_at ||
        ""
    );
}

function getPurchaseTime(purchase) {
    return purchase?.time || purchase?.created_at || purchase?.createdAt || "";
}

function getPurchaseName(purchase) {
    return (
        purchase?.name ||
        purchase?.product_name ||
        purchase?.product ||
        "Sản phẩm"
    );
}

function getPurchasePrice(purchase) {
    return Number(
        purchase?.price ??
        purchase?.amount ??
        purchase?.total ??
        0
    ) || 0;
}

/*
 * Tồn kho:
 * Website hiện tại có cấu trúc categories -> items.
 * Nếu item có một trong các trường stock/quantity/inventory/remaining
 * thì bot sẽ đọc số lượng. Nếu stock là mảng (ví dụ danh sách key),
 * bot dùng độ dài mảng.
 */
function getStock(item) {
    const fields = [
        "stock",
        "quantity",
        "inventory",
        "remaining",
        "remain",
        "stock_count",
        "stockCount"
    ];

    for (const field of fields) {
        if (item && Object.prototype.hasOwnProperty.call(item, field)) {
            const value = item[field];

            if (Array.isArray(value)) return value.length;

            if (value && typeof value === "object") {
                if (Array.isArray(value.items)) return value.items.length;
                if (Array.isArray(value.keys)) return value.keys.length;
                if (typeof value.count === "number") return value.count;
            }

            const n = Number(value);
            if (Number.isFinite(n)) return n;
        }
    }

    // Hỗ trợ một số tên trường thường dùng cho kho key.
    for (const field of ["keys", "codes", "licenses", "stock_keys"]) {
        if (Array.isArray(item?.[field])) return item[field].length;
    }

    return null;
}

function flattenProducts(catalog) {
    const result = [];

    if (Array.isArray(catalog)) {
        for (const item of catalog) {
            if (item && Array.isArray(item.items)) {
                for (const product of item.items) result.push(product);
            } else if (item && item.name) {
                result.push(item);
            }
        }
        return result;
    }

    if (catalog && typeof catalog === "object") {
        for (const [categoryId, category] of Object.entries(catalog)) {
            if (category && Array.isArray(category.items)) {
                for (const product of category.items) {
                    result.push({
                        ...product,
                        _category: categoryId
                    });
                }
            } else if (category && category.name) {
                result.push({
                    ...category,
                    _category: categoryId
                });
            }
        }
    }

    return result;
}

function splitTelegram(text, max = 3900) {
    const parts = [];
    let current = "";

    for (const line of String(text).split("\n")) {
        if ((current + line + "\n").length > max && current) {
            parts.push(current.trimEnd());
            current = "";
        }
        current += line + "\n";
    }

    if (current.trim()) parts.push(current.trimEnd());
    return parts;
}

async function sendLong(chatId, text, options = {}) {
    const parts = splitTelegram(text);
    for (const part of parts) {
        await bot.sendMessage(chatId, part, options);
    }
}

// /dangcho - đơn nạp tiền đang pending
bot.onText(/^\/dangcho(?:@\w+)?$/i, (msg) => {
    adminOnly(msg, async () => {
        const orders = readJson(ORDERS_FILE, []);
        const list = Array.isArray(orders)
            ? orders.filter(o => String(o?.status || "").toLowerCase() === "pending")
            : [];

        list.sort((a, b) => {
            return new Date(String(b?.created_at || "").replace(" ", "T")) -
                   new Date(String(a?.created_at || "").replace(" ", "T"));
        });

        if (!list.length) {
            return bot.sendMessage(
                msg.chat.id,
                "⏳ <b>ĐƠN ĐANG CHỜ DUYỆT</b>\n━━━━━━━━━━━━━━━\n\n✅ Hiện không có đơn nào đang chờ duyệt.",
                { parse_mode: "HTML" }
            );
        }

        let text =
            `⏳ <b>${list.length} ĐƠN ĐANG CHỜ DUYỆT</b>\n` +
            `━━━━━━━━━━━━━━━\n`;

        for (let i = 0; i < list.length; i++) {
            const o = list[i];
            text +=
                `\n<b>${i + 1}. 👤 ${esc(o?.username || "Không rõ")}</b>\n` +
                `💳 Mã CK: <code>${esc(o?.payment_content || o?.orderId || "Không có")}</code>\n` +
                `💵 Số tiền: <b>${money(o?.amount)}</b>\n` +
                `🕒 ${esc(dateVN(getOrderTime(o)))}\n`;
        }

        await sendLong(msg.chat.id, text, { parse_mode: "HTML" });
    });
});

// /thongke - thống kê hôm nay
bot.onText(/^\/thongke(?:@\w+)?$/i, (msg) => {
    adminOnly(msg, async () => {
        const today = todayKeyVN();
        const orders = readJson(ORDERS_FILE, []);
        const users = readJson(USERS_FILE, []);

        const allOrders = Array.isArray(orders) ? orders : [];
        const allUsers = Array.isArray(users) ? users : [];

        let depositTotal = 0;
        let depositCount = 0;
        let pendingCount = 0;

        for (const order of allOrders) {
            const status = String(order?.status || "").toLowerCase();

            if (status === "pending") pendingCount++;

            if (
                isApproved(status) &&
                isDepositOrder(order) &&
                dateKeyVN(getOrderTime(order)) === today
            ) {
                const amount = Number(order?.credited_amount ?? order?.paid_amount ?? order?.amount ?? 0) || 0;
                depositTotal += amount;
                depositCount++;
            }
        }

        // Website hiện tại lưu lịch sử mua hàng trong users.json.
        let salesTotal = 0;
        let salesCount = 0;

        for (const user of allUsers) {
            const history = Array.isArray(user?.purchase_history)
                ? user.purchase_history
                : [];

            for (const purchase of history) {
                if (dateKeyVN(getPurchaseTime(purchase)) === today) {
                    salesTotal += getPurchasePrice(purchase);
                    salesCount++;
                }
            }
        }

        const text =
            `📊 <b>THỐNG KÊ HÔM NAY</b>\n` +
            `━━━━━━━━━━━━━━━\n` +
            `📅 ${today}\n\n` +
            `💰 Nạp tiền thành công: <b>${money(depositTotal)}</b> (${depositCount} đơn)\n` +
            `🛒 Doanh thu bán hàng: <b>${money(salesTotal)}</b> (${salesCount} đơn)\n` +
            `⏳ Đang chờ duyệt: <b>${pendingCount} đơn</b>`;

        await bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
    });
});

// /tonkho - sản phẩm sắp hết hàng
bot.onText(/^\/tonkho(?:@\w+)?$/i, (msg) => {
    adminOnly(msg, async () => {
        const catalog = readJson(PRODUCTS_FILE, {});
        const products = flattenProducts(catalog);

        const lowStock = products
            .map(item => ({ item, stock: getStock(item) }))
            .filter(x => x.stock !== null && x.stock <= LOW_STOCK_THRESHOLD);

        lowStock.sort((a, b) => a.stock - b.stock);

        if (!lowStock.length) {
            return bot.sendMessage(
                msg.chat.id,
                `📦 <b>SẢN PHẨM SẮP HẾT HÀNG</b>\n━━━━━━━━━━━━━━━\n\n✅ Không có sản phẩm nào có tồn kho ≤ ${LOW_STOCK_THRESHOLD}.`,
                { parse_mode: "HTML" }
            );
        }

        let text =
            `📦 <b>${lowStock.length} SẢN PHẨM SẮP HẾT HÀNG</b>\n` +
            `━━━━━━━━━━━━━━━\n`;

        for (const { item, stock } of lowStock) {
            const icon = stock <= 0 ? "🔴" : "🟡";
            text += `\n${icon} <b>${esc(item?.name || "Sản phẩm")}</b> — còn <b>${stock}</b>`;
        }

        await sendLong(msg.chat.id, text, { parse_mode: "HTML" });
    });
});

// /donhang - đơn mua gần đây / đơn cần giao thủ công
bot.onText(/^\/donhang(?:@\w+)?$/i, (msg) => {
    adminOnly(msg, async () => {
        const users = readJson(USERS_FILE, []);
        const allUsers = Array.isArray(users) ? users : [];
        const purchases = [];

        for (const user of allUsers) {
            const history = Array.isArray(user?.purchase_history)
                ? user.purchase_history
                : [];

            for (const purchase of history) {
                purchases.push({
                    username: user?.username || "Không rõ",
                    ...purchase
                });
            }
        }

        purchases.sort((a, b) => {
            return new Date(String(getPurchaseTime(b)).replace(" ", "T")) -
                   new Date(String(getPurchaseTime(a)).replace(" ", "T"));
        });

        const recent = purchases.slice(0, 20);

        if (!recent.length) {
            return bot.sendMessage(
                msg.chat.id,
                "📦 <b>ĐƠN HÀNG</b>\n━━━━━━━━━━━━━━━\n\nChưa có đơn mua hàng nào.",
                { parse_mode: "HTML" }
            );
        }

        let text =
            `📦 <b>${purchases.length} ĐƠN HÀNG</b>\n` +
            `━━━━━━━━━━━━━━━\n` +
            `Hiển thị ${recent.length} đơn gần nhất.\n`;

        for (let i = 0; i < recent.length; i++) {
            const p = recent[i];
            text +=
                `\n<b>${i + 1}. ${esc(getPurchaseName(p))}</b>\n` +
                `👤 ${esc(p.username)}\n` +
                `📦 Gói: ${esc(p?.plan || "Mặc định")}\n` +
                `💵 Giá: <b>${money(getPurchasePrice(p))}</b>\n` +
                `🕒 ${esc(dateVN(getPurchaseTime(p)))}\n`;

            if (p?.link) text += `🔗 ${esc(p.link)}\n`;
            if (p?.video) text += `🎥 ${esc(p.video)}\n`;
        }

        await sendLong(msg.chat.id, text, { parse_mode: "HTML" });
    });
});

app.listen(Number(process.env.PORT) || 3000, "0.0.0.0", () => {
    console.log(`🚀 HTTP server listening on 0.0.0.0:${Number(process.env.PORT) || 3000}`);
    console.log(`🤖 Telegram Bot đang chạy...`);
    console.log(`🤖 AUTO_APPROVE_SMS=${AUTO_APPROVE_SMS}`);
    console.log(`📨 ADMIN_CHAT_ID=${ADMIN_CHAT_ID}`);
});

bot.on("polling_error", (error) => {
    console.error("❌ Telegram polling:", error.message);
});

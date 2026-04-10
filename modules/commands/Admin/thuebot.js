/**
 * thuebot.js - Lệnh thuê bot cho nhóm
 * Admin: thuebot key [số_ngày] | thuebot list
 * Member: thuebot mua | gửi key (kzi_xxxx) vào nhóm
 */

const fs = require('fs-extra');
const path = require('path');
const axios = require('axios');
const moment = require('moment-timezone');

// ─── Đường dẫn file dữ liệu ────────────────────────────────────────────────
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data');
const THUEBOT_FILE = path.join(DATA_DIR, 'thuebot.json');
// Prefer RentKey.json (used by the web manager). Keep key.json as legacy fallback.
const RENTKEY_FILE = path.join(DATA_DIR, 'RentKey.json');
const LEGACY_KEY_FILE = path.join(DATA_DIR, 'key.json');

// Khởi tạo file nếu chưa tồn tại
if (!fs.existsSync(THUEBOT_FILE)) fs.writeJsonSync(THUEBOT_FILE, [], { spaces: 2 });
if (!fs.existsSync(RENTKEY_FILE)) fs.writeJsonSync(RENTKEY_FILE, { used_keys: [], unUsed_keys: [] }, { spaces: 2 });
if (!fs.existsSync(LEGACY_KEY_FILE)) fs.writeJsonSync(LEGACY_KEY_FILE, { unused: [], used: [] }, { spaces: 2 });

// ─── Helpers ────────────────────────────────────────────────────────────────
function readData() { return fs.readJsonSync(THUEBOT_FILE, { throws: false }) || []; }
function saveData(d) { fs.writeJsonSync(THUEBOT_FILE, d, { spaces: 2 }); }

function readRentKeys() {
    return fs.readJsonSync(RENTKEY_FILE, { throws: false }) || { used_keys: [], unUsed_keys: [] };
}
function saveRentKeys(k) { fs.writeJsonSync(RENTKEY_FILE, k, { spaces: 2 }); }

function readLegacyKeys() {
    return fs.readJsonSync(LEGACY_KEY_FILE, { throws: false }) || { unused: [], used: [] };
}
function saveLegacyKeys(k) { fs.writeJsonSync(LEGACY_KEY_FILE, k, { spaces: 2 }); }

function now() { return moment().tz('Asia/Ho_Chi_Minh'); }

/** Parse days from key if embedded: kzi_<days>_<suffix> / WEB_<days>_<suffix> */
function parseDaysFromKey(key) {
    const s = String(key || '').trim();
    const m = s.match(/^(?:kzi|WEB)_(\d{1,4})_[a-z0-9]{4,20}$/i);
    if (!m) return null;
    const days = Number(m[1]);
    if (!Number.isFinite(days) || days <= 0 || days > 3650) return null;
    return days;
}

/** Tạo key ngẫu nhiên dạng kzi_<days>_<suffix> (tương thích web manager) */
function genKey(days) {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let suffix = '';
    for (let i = 0; i < 7; i++) suffix += chars[Math.floor(Math.random() * chars.length)];
    const safeDays = Number(days) > 0 ? Number(days) : 30;
    return `kzi_${safeDays}_${suffix}`;
}

/** Tính ngày hết hạn */
function calcExpiry(days, fromDateStr) {
    const base = fromDateStr ? moment(fromDateStr, 'DD/MM/YYYY') : now();
    return base.add(days, 'days').format('DD/MM/YYYY');
}

/** Kiểm tra key hợp lệ theo định dạng kzi_xxxx hoặc kzi_<days>_xxxx */
function isValidKeyFormat(str) {
    const s = String(str || '').trim();
    return /^(?:kzi|WEB)_[a-z0-9]{4,20}$/i.test(s) || /^(?:kzi|WEB)_\d{1,4}_[a-z0-9]{4,20}$/i.test(s);
}

function findAndConsumeKey(inputKey) {
    const key = String(inputKey || '').trim();

    // 1) New store: RentKey.json
    const rent = readRentKeys();
    const rentUnused = Array.isArray(rent.unUsed_keys) ? rent.unUsed_keys : [];
    const rentUsed = Array.isArray(rent.used_keys) ? rent.used_keys : [];
    if (rentUsed.includes(key)) {
        return { ok: false, reason: 'used' };
    }
    if (rentUnused.includes(key)) {
        rent.unUsed_keys = rentUnused.filter(k => k !== key);
        rent.used_keys = [...rentUsed, key];
        saveRentKeys(rent);
        return { ok: true, store: 'rent', days: parseDaysFromKey(key) };
    }

    // 2) Legacy store: key.json
    const legacy = readLegacyKeys();
    const legacyUnused = Array.isArray(legacy.unused) ? legacy.unused : [];
    const legacyUsed = Array.isArray(legacy.used) ? legacy.used : [];
    if (legacyUsed.includes(key)) {
        return { ok: false, reason: 'used' };
    }
    if (legacyUnused.includes(key)) {
        legacy.unused = legacyUnused.filter(k => k !== key);
        legacy.used = [...legacyUsed, key];
        saveLegacyKeys(legacy);
        return { ok: true, store: 'legacy', days: parseDaysFromKey(key) };
    }

    return { ok: false, reason: 'not_found' };
}

/** Cấp quyền thuê bot cho nhóm (hoặc gia hạn nếu đã có) */
function grantRent(threadID, senderID, days) {
    const data = readData();
    const today = now().format('DD/MM/YYYY');
    const idx = data.findIndex(r => r.t_id === threadID);

    if (idx !== -1) {
        // Gia hạn từ ngày hết hạn cũ (nếu chưa hết hạn) hoặc từ hôm nay
        const currentEnd = moment(data[idx].time_end, 'DD/MM/YYYY');
        const base = currentEnd.isAfter(now()) ? currentEnd.format('DD/MM/YYYY') : today;
        data[idx].time_end = calcExpiry(days, base);
        data[idx].uid_renter = senderID;
        saveData(data);
        return { isNew: false, timeEnd: data[idx].time_end };
    } else {
        const timeEnd = calcExpiry(days, today);
        data.push({
            t_id: threadID,
            uid_renter: senderID,
            time_start: today,
            time_end: timeEnd,
            days_rented: days
        });
        saveData(data);
        return { isNew: true, timeEnd };
    }
}

// ─── Kiểm tra giao dịch SePay ───────────────────────────────────────────────
async function checkSepayTransaction(content, amount) {
    const cfg = global.config.SEPAY || {};
    const token = cfg.token || '';
    if (!token) return null;

    try {
        const res = await axios.get('https://my.sepay.vn/userapi/transactions/list', {
            headers: { Authorization: `Bearer ${token}` },
            params: {
                account_number: cfg.account_number || '',
                limit: 20,
                transaction_content: content
            },
            timeout: 10000
        });

        if (!res.data || !res.data.transactions) return null;
        const txns = res.data.transactions;

        // Tìm giao dịch khớp nội dung & số tiền trong 30 phút gần nhất
        const cutoff = now().subtract(30, 'minutes');
        for (const tx of txns) {
            const txTime = moment(tx.transaction_date, 'YYYY-MM-DD HH:mm:ss');
            if (
                tx.in > 0 &&
                parseFloat(tx.in) >= amount &&
                tx.transaction_content?.toLowerCase().includes(content.toLowerCase()) &&
                txTime.isAfter(cutoff)
            ) {
                return tx;
            }
        }
        return null;
    } catch (e) {
        console.error('[THUEBOT] SePay check error:', e.message);
        return null;
    }
}

// ─── Config module ───────────────────────────────────────────────────────────
module.exports.config = {
    name: 'thuebot',
    version: '2.0.0',
    hasPermssion: 0,
    credits: 'Niio-team',
    description: 'Hệ thống thuê bot cho nhóm (mua qua QR ngân hàng hoặc key)',
    commandCategory: 'Admin',
    usages: 'thuebot [key <ngày> | list | mua] hoặc gửi key kzi_xxxx vào nhóm',
    cooldowns: 5,
};

// ─── Xử lý tin nhắn thường ──────────────────────────────────────────────────
module.exports.run = async function ({ api, Users, Threads, event, args }) {
    const { threadID, senderID, messageID } = event;
    const isAdmin = (global.config.ADMINBOT || []).includes(senderID) ||
        (global.config.adminsuper || []).includes(senderID);

    const sub = (args[0] || '').toLowerCase();

    // ── 1. Tạo key (chỉ admin) ─────────────────────────────────────────────
    if (sub === 'key') {
        if (!isAdmin) return api.sendMessage('❌ Chỉ admin mới có thể tạo key!', threadID, messageID);

        const days = parseInt(args[1], 10);
        if (!days || days <= 0) {
            return api.sendMessage('⚠️ Vui lòng nhập số ngày hợp lệ.\nVí dụ: thuebot key 30', threadID, messageID);
        }

        const rent = readRentKeys();
        const legacy = readLegacyKeys();
        let newKey;
        // Đảm bảo key chưa tồn tại ở cả 2 store
        do { newKey = genKey(days); }
        while (
            (rent.unUsed_keys || []).includes(newKey) || (rent.used_keys || []).includes(newKey) ||
            (legacy.unused || []).includes(newKey) || (legacy.used || []).includes(newKey)
        );

        rent.unUsed_keys = [...(rent.unUsed_keys || []), newKey];
        saveRentKeys(rent);

        return api.sendMessage(
            `✅ Đã tạo key thành công!\n\n` +
            `🔑 Key: ${newKey}\n` +
            `📅 Thời hạn: ${days} ngày\n\n` +
            `👉 Hướng dẫn: Gửi key vào nhóm cần thuê bot (chỉ gửi mình key, không kèm text khác)`,
            threadID, messageID
        );
    }

    // ── 2. Danh sách thuê bot (chỉ admin) ────────────────────────────────
    if (sub === 'list') {
        if (!isAdmin) return api.sendMessage('❌ Chỉ admin mới có thể xem danh sách!', threadID, messageID);

        const data = readData();
        if (!data.length) return api.sendMessage('📋 Chưa có nhóm nào thuê bot.', threadID, messageID);

        const lines = await Promise.all(data.map(async (r, i) => {
            let renterName = 'Không rõ';
            try { renterName = await Users.getNameUser(r.uid_renter) || renterName; } catch (_) { }

            let groupName = r.t_id;
            try {
                const td = await Threads.getData(r.t_id);
                groupName = td?.threadInfo?.threadName || r.t_id;
            } catch (_) { }

            const expired = moment(r.time_end, 'DD/MM/YYYY').isBefore(now());
            const status = expired ? '❌ Hết hạn' : '✅ Còn hạn';

            return `${i + 1}. 🏘 ${groupName}\n` +
                `   👤 Người thuê: ${renterName}\n` +
                `   🗓 Từ: ${r.time_start} → ${r.time_end}\n` +
                `   📊 Trạng thái: ${status}`;
        }));

        const msg =
            `📋 DANH SÁCH THUÊ BOT (${data.length} nhóm)\n` +
            `${'─'.repeat(30)}\n\n` +
            `${lines.join('\n\n')}\n\n` +
            `💬 Reply số thứ tự để xóa thuê bot của nhóm đó.`;

        return api.sendMessage(msg, threadID, (err, info) => {
            if (err) return;
            global.client.handleReply.push({
                name: this.config.name,
                messageID: info.messageID,
                author: senderID,
                type: 'deleteRent',
                data
            });
        });
    }

    // ── 3. Mua qua QR ngân hàng ────────────────────────────────────────────
    if (sub === 'mua') {
        const cfg = global.config.SEPAY || {};
        const stk = cfg.account_number || '(chưa cấu hình)';
        const owner = cfg.account_name || '(chưa cấu hình)';
        const bank = cfg.bank_name || 'Ngân hàng';
        const price = cfg.price || 20000;
        const days = cfg.days || 30;

        // Nội dung chuyển khoản độc nhất theo threadID
        const shortThread = threadID.slice(-8);
        const transferContent = `THUEBOT ${shortThread}`;
        const priceK = (price / 1000).toFixed(0);

        // QR sepay: https://qr.sepay.vn/img?bank=...&acc=...&template=compact&amount=...&des=...
        const qrUrl =
            `https://qr.sepay.vn/img?` +
            `bank=${encodeURIComponent(cfg.bank_bin || bank)}&` +
            `acc=${encodeURIComponent(stk)}&` +
            `template=compact&` +
            `amount=${price}&` +
            `des=${encodeURIComponent(transferContent)}`;

        const infoMsg =
            `💳 THÔNG TIN THANH TOÁN THUÊ BOT\n` +
            `${'─'.repeat(32)}\n\n` +
            `🏦 Ngân hàng: ${bank}\n` +
            `💳 STK: ${stk}\n` +
            `👤 Chủ TK: ${owner}\n\n` +
            `📦 Gói: ${priceK}k/${days} ngày\n` +
            `💰 Số tiền: ${price.toLocaleString('vi-VN')}đ\n` +
            `📝 Nội dung CK: ${transferContent}\n\n` +
            `⚠️ Vui lòng chuyển ĐÚNG nội dung để hệ thống tự xác nhận!\n\n` +
            `⏳ Sau khi chuyển khoản, hệ thống sẽ tự xác nhận trong vài phút.\n` +
            `💬 Reply "xacnhan" vào tin nhắn này để kiểm tra thủ công.`;

        return api.sendMessage(
            {
                body: infoMsg,
                url: qrUrl        // Gửi ảnh QR nếu API hỗ trợ url attachment
            },
            threadID,
            (err, info) => {
                if (err) {
                    // Fallback: gửi text only nếu không attach được
                    api.sendMessage(
                        infoMsg + `\n\n🔗 QR: ${qrUrl}`,
                        threadID
                    );
                    return;
                }
                global.client.handleReply.push({
                    name: this.config.name,
                    messageID: info.messageID,
                    author: senderID,
                    type: 'confirmPayment',
                    threadID,
                    senderID,
                    transferContent,
                    price,
                    days
                });
            }
        );
    }

    // ── 4. Kích hoạt bằng key (gửi mình key vào nhóm) ────────────────────
    if (isValidKeyFormat(args[0] || '')) {
        const inputKey = args[0].trim();
        const consumed = findAndConsumeKey(inputKey);
        if (!consumed.ok) {
            if (consumed.reason === 'used') {
                return api.sendMessage(`❌ Key "${inputKey}" đã được sử dụng rồi!`, threadID, messageID);
            }
            return api.sendMessage(`❌ Key "${inputKey}" không tồn tại hoặc không hợp lệ!`, threadID, messageID);
        }

        const days = consumed.days || 30;
        const { isNew, timeEnd } = grantRent(threadID, senderID, days);

        let renterName = 'Bạn';
        try { renterName = await Users.getNameUser(senderID) || renterName; } catch (_) { }

        return api.sendMessage(
            `✅ Kích hoạt key thành công!\n\n` +
            `👤 Người thuê: ${renterName}\n` +
            `🔑 Key đã dùng: ${inputKey}\n` +
            `🏘 Nhóm: ${threadID}\n` +
            `📅 Hết hạn: ${timeEnd}\n\n` +
            `${isNew ? '🎉 Bot đã được kích hoạt cho nhóm này!' : '🔄 Thời hạn đã được gia hạn!'}`,
            threadID, messageID
        );
    }

    // ── 5. Help ────────────────────────────────────────────────────────────
    return api.sendMessage(
        `🤖 HƯỚNG DẪN THUÊ BOT\n` +
        `${'─'.repeat(28)}\n\n` +
        `👤 Dành cho thành viên:\n` +
        `  • thuebot mua → Xem QR thanh toán\n` +
        `  • kzi_30_xxxxxxx → Kích hoạt bằng key\n\n` +
        `🛡 Dành cho Admin:\n` +
        `  • thuebot key [ngày] → Tạo key\n` +
        `  • thuebot list → Xem danh sách thuê bot\n\n` +
        `💰 Giá: 20.000đ/tháng`,
        threadID, messageID
    );
};

// ─── Xử lý reply ─────────────────────────────────────────────────────────────
module.exports.handleReply = async function ({ api, Users, Threads, event, handleReply }) {
    const { threadID, senderID, body } = event;

    // ── Reply nhập key từ tin nhắn "chưa thuê bot" (RentKey) ─────────────────
    // Được push bởi handleCommand.js/handleCommandNoprefix.js khi nhóm chưa thuê
    if (handleReply.type === 'RentKey') {
        const inputKey = body.trim();
        if (!isValidKeyFormat(inputKey)) {
            return api.sendMessage(
                `❌ Key không đúng định dạng!\n` +
                `Định dạng hợp lệ: kzi_30_xxxxxxx\n` +
                `Vui lòng nhập lại hoặc liên hệ admin.`,
                threadID
            );
        }

        const consumed = findAndConsumeKey(inputKey);
        if (!consumed.ok) {
            if (consumed.reason === 'used') {
                return api.sendMessage(`❌ Key "${inputKey}" đã được sử dụng rồi!`, threadID);
            }
            return api.sendMessage(`❌ Key "${inputKey}" không tồn tại hoặc không hợp lệ!`, threadID);
        }

        const targetThread = handleReply.threadID || threadID;
        const days = consumed.days || global.config?.SEPAY?.days || 30;
        const { isNew, timeEnd } = grantRent(targetThread, senderID, days);

        let renterName = 'Bạn';
        try { renterName = await Users.getNameUser(senderID) || renterName; } catch (_) { }

        return api.sendMessage(
            `✅ Kích hoạt key thành công!\n\n` +
            `👤 Người thuê: ${renterName}\n` +
            `🔑 Key: ${inputKey}\n` +
            `🏘 Nhóm: ${targetThread}\n` +
            `📅 Hết hạn: ${timeEnd}\n\n` +
            `${isNew ? '🎉 Bot đã được kích hoạt cho nhóm này!' : '🔄 Thời hạn đã được gia hạn!'}`,
            threadID
        );
    }


    // ── Reply xác nhận thanh toán ─────────────────────────────────────────
    if (handleReply.type === 'confirmPayment') {
        if (senderID !== handleReply.author) return;

        const keyword = body.trim().toLowerCase();
        if (keyword !== 'xacnhan') return;

        await api.sendMessage('🔍 Đang kiểm tra giao dịch, vui lòng chờ...', threadID);

        const tx = await checkSepayTransaction(handleReply.transferContent, handleReply.price);

        if (!tx) {
            return api.sendMessage(
                `❌ Chưa tìm thấy giao dịch hợp lệ!\n\n` +
                `Vui lòng:\n` +
                `• Kiểm tra nội dung CK: ${handleReply.transferContent}\n` +
                `• Chuyển đúng số tiền: ${handleReply.price.toLocaleString('vi-VN')}đ\n` +
                `• Thử lại sau 1-2 phút nếu vừa chuyển`,
                threadID
            );
        }

        // Giao dịch hợp lệ → cấp quyền
        const { isNew, timeEnd } = grantRent(handleReply.threadID, handleReply.senderID, handleReply.days || 30);

        let renterName = 'Bạn';
        try { renterName = await Users.getNameUser(handleReply.senderID) || renterName; } catch (_) { }

        return api.sendMessage(
            `✅ XÁC NHẬN THANH TOÁN THÀNH CÔNG!\n` +
            `${'─'.repeat(30)}\n\n` +
            `👤 Người thuê: ${renterName}\n` +
            `💰 Số tiền: ${parseFloat(tx.in).toLocaleString('vi-VN')}đ\n` +
            `📝 Nội dung: ${tx.transaction_content}\n` +
            `🏘 Nhóm: ${handleReply.threadID}\n` +
            `📅 Hết hạn: ${timeEnd}\n\n` +
            `${isNew ? '🎉 Bot đã được kích hoạt cho nhóm này!' : '🔄 Thời hạn đã được gia hạn!'}`,
            threadID
        );
    }

    // ── Reply xóa thuê bot (admin only) ──────────────────────────────────
    if (handleReply.type === 'deleteRent') {
        const isAdmin = (global.config.ADMINBOT || []).includes(senderID) ||
            (global.config.adminsuper || []).includes(senderID);
        if (!isAdmin || senderID !== handleReply.author) return;

        const num = parseInt(body.trim(), 10);
        if (isNaN(num) || num < 1 || num > handleReply.data.length) {
            return api.sendMessage(`⚠️ Số thứ tự không hợp lệ! (1 - ${handleReply.data.length})`, threadID);
        }

        const target = handleReply.data[num - 1];
        const data = readData();
        const idx = data.findIndex(r => r.t_id === target.t_id);
        if (idx !== -1) {
            data.splice(idx, 1);
            saveData(data);
        }

        let groupName = target.t_id;
        try {
            const td = await Threads.getData(target.t_id);
            groupName = td?.threadInfo?.threadName || target.t_id;
        } catch (_) { }

        return api.sendMessage(
            `✅ Đã xóa thuê bot của nhóm:\n` +
            `🏘 ${groupName} (${target.t_id})`,
            threadID
        );
    }
};

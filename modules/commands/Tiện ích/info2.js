const axios = require("axios");
const downloader = require("image-downloader");
const fs = require("fs");
const fse = require('fs-extra');
const moment = require("moment-timezone");

module.exports.config = {
    name: "info2",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "Lương Trường Khôi & AI",
    description: "Lấy thông tin người dùng từ Facebook",
    usages: "[uid|link|reply]",
    commandCategory: "Tiện ích",
    cooldowns: 5,
};

async function streamURL(url, mime = 'jpg') {
    const dest = `${__dirname}/cache/${Date.now()}.${mime}`;
    await downloader.image({ url, dest });
    setTimeout(() => { try { fse.unlinkSync(dest); } catch (_) {} }, 60 * 1000);
    return fse.createReadStream(dest);
}

async function getUidFromInput(input) {
    try {
        const response = await axios.get(`https://nqduan.id.vn/api/fb-info?uid=${encodeURIComponent(input)}&version=v1`);
        return response.data?.uid || null;
    } catch {
        return null;
    }
}

module.exports.run = async function ({ api, event, args }) {
    let uid = args[0];

    if (event.messageReply) {
        uid = event.messageReply.senderID;
    } else if (uid && (uid.startsWith("http") || isNaN(uid))) {
        uid = await getUidFromInput(uid);
    } else if (!uid) {
        uid = event.senderID;
    }

    if (!uid) {
        return api.sendMessage("Vui lòng cung cấp UID, liên kết hợp lệ hoặc reply tin nhắn của người dùng!", event.threadID, event.messageID);
    }

    try {
        const { data: d } = await axios.get(`https://nqduan.id.vn/api/fb-info?uid=${uid}&version=v1`);

        if (!d || !d.uid) {
            return api.sendMessage("❌ Không tìm thấy thông tin người dùng!", event.threadID, event.messageID);
        }

        const get = (field, fallback = "❌") => (d[field] && d[field] !== "Không có dữ liệu!" && d[field] !== "Không có") ? d[field] : fallback;

        const user_id    = d.uid;
        const name       = get('name');
        const firstName  = get('first_name');
        const profileUrl = get('link_profile');
        const username   = get('username');
        const createdTime = get('created_time');
        const web        = get('web');
        const relationship = get('relationship_status');
        const love       = get('love');
        const birthday   = get('birthday');
        const follower   = d.follower ?? "❌";
        const verify     = d.tichxanh === true ? "✅ Đã tích xanh" : "❌ Chưa tích xanh";
        const quotes     = get('quotes');
        const about      = get('about');
        const locale     = get('locale');
        const location   = get('location');
        const hometown   = get('hometown');
        const avatarUrl  = d.avatar || null;

        let message = `
╭──────────────────⭓
│ 👤 Họ tên: ${name}
│ 👤 Tên: ${firstName}
│ 🔗 Username: ${username}
│ 🆔 UID: ${user_id}
│ 🌐 Link profile: ${profileUrl}
│ 🌍 Ngôn ngữ: ${locale}
│ 📊 Người theo dõi: ${follower}
│ 🎉 Tạo lúc: ${createdTime}
│ 💖 Quan hệ: ${relationship}
│ 💞 Người yêu: ${love}
│ 🎂 Ngày sinh: ${birthday}
│ 📍 Quê quán: ${hometown}
│ 🌍 Nơi ở: ${location}
│ 🔗 Website: ${web}
│ 📝 Giới thiệu: ${about}
│ 📌 Trích dẫn: ${quotes}
│ ✅ Tích xanh: ${verify}
╰─────────────────⭓`;

        const attachments = [];
        if (avatarUrl) {
            try {
                const img = await streamURL(avatarUrl);
                attachments.push(img);
            } catch (_) {}
        }

        api.sendMessage(
            { body: message, attachment: attachments },
            event.threadID,
            (err, info) => {
                if (!err && info) {
                    setTimeout(() => api.unsendMessage(info.messageID), 60 * 1000);
                    for (const att of attachments) {
                        try { fs.unlinkSync(att.path); } catch (_) {}
                    }
                }
            },
            event.messageID
        );
    } catch (error) {
        console.error(error);
        return api.sendMessage("❌ Có lỗi xảy ra khi lấy thông tin!", event.threadID, event.messageID);
    }
};

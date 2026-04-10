const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');

module.exports.config = {
    name: "welcome",
    eventType: ["log:subscribe"],
    version: "1.0.0",
    credits: "Niio-team",
    description: "Chào mừng thành viên mới vào nhóm"
};

// Lấy ảnh đại diện thành viên
async function getAvatarBuffer(uid) {
    try {
        const url = `https://graph.facebook.com/${uid}/picture?width=512&height=512&access_token=6628568379%7Cc1e620fa708a1d5696fb991c1bde5662`;
        const res = await axios.get(url, { responseType: 'arraybuffer', timeout: 8000 });
        const tmpPath = path.join(process.cwd(), 'tmp', `avatar_${uid}_${Date.now()}.jpg`);
        fs.ensureDirSync(path.dirname(tmpPath));
        await fs.writeFile(tmpPath, res.data);
        return tmpPath;
    } catch { return null; }
}

module.exports.run = async function ({ api, event, Users, Threads }) {
    const { threadID } = event;
    const members = event.logMessageData.addedParticipants || [];

    // Bỏ qua nếu chính bot được thêm vào
    if (members.some(m => String(m.userFbId) === String(api.getCurrentUserID()))) return;

    for (const member of members) {
        const uid = String(member.userFbId);
        let name = member.fullName;

        // Lấy tên từ DB nếu có
        try {
            const dbName = await Users.getNameUser(uid);
            if (dbName) name = dbName;
        } catch (_) { }

        // Đếm thành viên nhóm
        let memberCount = '?';
        try {
            const threadData = await Threads.getData(threadID);
            memberCount = threadData?.threadInfo?.participantIDs?.length || '?';
        } catch (_) { }

        const threadName = (await Threads.getData(threadID).catch(() => ({})))?.threadInfo?.threadName || 'nhóm';

        const msg = {
            body:
                `🎉 Chào mừng ${name} đã đến với ${threadName}!\n` +
                `${'─'.repeat(32)}\n\n` +
                `📌 Bạn là thành viên thứ ${memberCount} của nhóm\n` +
                `🤖 Hãy gõ lệnh để khám phá các tính năng của bot\n` +
                `💬 Chúc bạn có những trải nghiệm vui vẻ! 🌟`,
        };

        // Thêm ảnh đại diện nếu lấy được
        const avatarPath = await getAvatarBuffer(uid);
        if (avatarPath) {
            try {
                msg.attachment = fs.createReadStream(avatarPath);
                await api.sendMessage(msg, threadID);
                // Xóa file tạm sau khi gửi
                setTimeout(() => fs.remove(avatarPath).catch(() => { }), 5000);
            } catch {
                delete msg.attachment;
                await api.sendMessage(msg, threadID);
            }
        } else {
            await api.sendMessage(msg, threadID);
        }

        // Delay tránh spam nếu nhiều người join cùng lúc
        if (members.length > 1) await new Promise(r => setTimeout(r, 800));
    }
};

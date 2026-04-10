const fs = require('fs-extra');
const axios = require('axios');
const path = require('path');

module.exports.config = {
    name: "farewell",
    eventType: ["log:unsubscribe"],
    version: "1.0.0",
    credits: "Niio-team",
    description: "Tạm biệt thành viên rời nhóm"
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
    const { threadID, logMessageData } = event;
    const uid = String(logMessageData.leftParticipantFbId);

    // Bỏ qua nếu chính bot rời nhóm
    if (uid === String(api.getCurrentUserID())) return;

    let name = uid;
    try {
        const dbName = await Users.getNameUser(uid);
        if (dbName) name = dbName;
    } catch (_) { }

    // Đếm số thành viên còn lại
    let memberCount = '?';
    try {
        const threadData = await Threads.getData(threadID);
        memberCount = (threadData?.threadInfo?.participantIDs?.length || 1);
    } catch (_) { }

    const threadName = (await Threads.getData(threadID).catch(() => ({})))?.threadInfo?.threadName || 'nhóm';

    const msg = {
        body:
            `👋 ${name} đã rời khỏi ${threadName}!\n` +
            `${'─'.repeat(32)}\n\n` +
            `😢 Tạm biệt, hẹn gặp lại bạn!\n` +
            `👥 Nhóm hiện còn ${memberCount} thành viên`,
    };

    // Thêm ảnh đại diện nếu lấy được
    const avatarPath = await getAvatarBuffer(uid);
    if (avatarPath) {
        try {
            msg.attachment = fs.createReadStream(avatarPath);
            await api.sendMessage(msg, threadID);
            setTimeout(() => fs.remove(avatarPath).catch(() => { }), 5000);
        } catch {
            delete msg.attachment;
            await api.sendMessage(msg, threadID);
        }
    } else {
        await api.sendMessage(msg, threadID);
    }
};

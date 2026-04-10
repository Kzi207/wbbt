const ytdl = require("@distube/ytdl-core");
const yts = require("youtube-search-api");
const fs = require("fs");
const fse = require("fs-extra");
const path = require("path");

const cacheDir = path.join(__dirname, "cache");
fse.ensureDirSync(cacheDir);

module.exports.config = {
    name: "sing",
    version: "2.2.0",
    hasPermission: 0,
    credits: "Diện mod lại bởi Lương Trường Khôi",
    description: "Tìm và tải nhạc từ YouTube",
    commandCategory: "Tìm kiếm",
    usages: "[tên bài hát]",
    cooldowns: 10,
    usePrefix: true,
};

module.exports.run = async function ({ api, event, args }) {
    const query = args.join(" ").trim();
    if (!query) {
        return api.sendMessage("Vui lòng nhập tên bài hát cần tìm!", event.threadID);
    }

    const waitMsg = await new Promise(resolve =>
        api.sendMessage(`Đang tìm kiếm: ${query}...`, event.threadID, (err, info) => resolve(info))
    );

    try {
        const searchResult = await yts.GetListByKeyword(query, false, 1);
        const items = searchResult && searchResult.items ? searchResult.items : [];
        const video = items[0];

        if (!video || !video.id) {
            if (waitMsg) api.unsendMessage(waitMsg.messageID);
            return api.sendMessage("❌ Không tìm thấy bài hát phù hợp!", event.threadID);
        }

        const videoId = typeof video.id === "object" ? video.id.videoId : video.id;
        const videoUrl = "https://www.youtube.com/watch?v=" + videoId;
        const title = video.title || "Unknown";
        const duration = (video.length && video.length.simpleText) ? video.length.simpleText : (video.length || "N/A");

        const durationSecs = (function(){
            if (!duration || duration === "N/A") return 0;
            const parts = String(duration).split(":").map(Number).reverse();
            return (parts[0] || 0) + (parts[1] || 0) * 60 + (parts[2] || 0) * 3600;
        })();
        if (durationSecs > 900) {
            if (waitMsg) api.unsendMessage(waitMsg.messageID);
            return api.sendMessage("⏱️ Bài hát quá dài (" + duration + "). Chỉ hỗ trợ tối đa 15 phút.", event.threadID);
        }

        const outFile = path.join(cacheDir, "yt_" + videoId + "_" + Date.now() + ".mp3");

        await new Promise(function(resolve, reject) {
            const stream = ytdl(videoUrl, {
                filter: "audioonly",
                quality: "highestaudio",
                requestOptions: { headers: { "User-Agent": "Mozilla/5.0" } }
            });
            const writeStream = fs.createWriteStream(outFile);
            stream.pipe(writeStream);
            stream.on("error", reject);
            writeStream.on("finish", resolve);
            writeStream.on("error", reject);
        });

        if (waitMsg) api.unsendMessage(waitMsg.messageID);

        const message = "🎵 " + title + "\n⏱️ Thời lượng: " + duration;
        const audioStream = fs.createReadStream(outFile);

        api.sendMessage(
            { body: message, attachment: audioStream },
            event.threadID,
            function(err, info) {
                if (!err && info) {
                    setTimeout(function(){ 
                        try { api.unsendMessage(info.messageID); } catch(e) {}
                    }, 5 * 60 * 1000);
                }
                try { fs.unlinkSync(outFile); } catch(e) {}
            }
        );

    } catch (error) {
        if (waitMsg) api.unsendMessage(waitMsg.messageID);
        console.error("[SING] Error:", error.message);
        return api.sendMessage("❌ Lỗi: " + error.message, event.threadID);
    }
};
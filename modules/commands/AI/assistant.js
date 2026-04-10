const { GoogleGenerativeAI } = require("@google/generative-ai");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");

// Import SoundCloud functions từ scl.js
const sclModule = require('../Tìm kiếm/scl.js');

const GEMINI_MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];

function getGeminiApiKey() {
    return (global.config && global.config.GEMINI_API_KEY) || process.env.GEMINI_API_KEY || "";
}

function normalizeGeminiError(error) {
    const raw = (error && (error.message || error.toString())) || "";
    const msg = raw.toLowerCase();

    if (!raw) return "Da xay ra loi khong xac dinh tu Gemini.";
    if (msg.includes("api key") || msg.includes("permission denied") || msg.includes("unauthorized") || msg.includes("[401")) {
        return "API key Gemini khong hop le hoac khong co quyen truy cap.";
    }
    if (msg.includes("quota") || msg.includes("resource_exhausted") || msg.includes("[429")) {
        return "Gemini da het quota hoac dang bi gioi han tan suat. Vui long thu lai sau.";
    }
    if (msg.includes("not found") || msg.includes("model") || msg.includes("[404")) {
        return "Model Gemini khong kha dung cho API key hien tai.";
    }
    if (msg.includes("deadline") || msg.includes("timed out") || msg.includes("econnreset") || msg.includes("fetch")) {
        return "Khong ket noi duoc den Gemini. Vui long kiem tra mang va thu lai.";
    }
    return `Gemini tra loi: ${raw}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function sendGeminiWithFallback({ systemPrompt, question }) {
    const apiKey = getGeminiApiKey();
    if (!apiKey) throw new Error("Thieu GEMINI_API_KEY trong config.json hoac bien moi truong.");

    const genAI = new GoogleGenerativeAI(apiKey);
    let lastError = null;

    for (const modelName of GEMINI_MODELS) {
        // Retry up to 3 times for rate limit (429) errors
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const model = genAI.getGenerativeModel({ model: modelName });
                const chat = model.startChat({
                    history: [
                        { role: "user", parts: [{ text: systemPrompt }] },
                        { role: "model", parts: [{ text: "Toi hieu roi. Toi se tuan thu cac quy tac nay." }] }
                    ]
                });
                const result = await chat.sendMessage(`Cau hoi: ${question}`);
                const response = await result.response;
                return response.text();
            } catch (err) {
                lastError = err;
                const is429 = err?.status === 429 || (err?.message || '').includes('429') || (err?.message || '').toLowerCase().includes('resource_exhausted');
                if (is429 && attempt < 2) {
                    const delay = (attempt + 1) * 5000; // 5s, 10s
                    console.log(`⏳ Gemini 429, retrying ${modelName} in ${delay/1000}s (attempt ${attempt + 1}/3)`);
                    await sleep(delay);
                    continue;
                }
                break; // Non-429 error or last attempt → try next model
            }
        }
    }

    throw lastError || new Error("Khong goi duoc Gemini voi cac model da cau hinh.");
}

module.exports.config = {
  name: "ast",	
  version: "1.0.0", 
  hasPermssion: 0,
  Rent: 2,
  credits: "Khánh Duy",
  description: "AI với khả năng phát nhạc, tag và kick người", 
  commandCategory: "AI",
  usages: "ast <câu hỏi>",
  cooldowns: 6000
};

// Lưu lịch sử hội thoại theo threadID + senderID
const conversationHistory = new Map();

// Hàm lấy lịch sử hội thoại
function getConversationHistory(threadID, senderID) {
    const key = `${threadID}_${senderID}`;
    if (!conversationHistory.has(key)) {
        conversationHistory.set(key, []);
    }
    return conversationHistory.get(key);
}

// Hàm thêm vào lịch sử
function addToHistory(threadID, senderID, role, message) {
    const history = getConversationHistory(threadID, senderID);
    history.push({ role, message, timestamp: Date.now() });
    
    // Giới hạn 10 tin nhắn gần nhất
    if (history.length > 10) {
        history.shift();
    }
}

// Hàm xóa lịch sử cũ (>30 phút)
setInterval(() => {
    const thirtyMinutesAgo = Date.now() - 30 * 60 * 1000;
    for (const [key, history] of conversationHistory.entries()) {
        if (history.length > 0 && history[history.length - 1].timestamp < thirtyMinutesAgo) {
            conversationHistory.delete(key);
        }
    }
}, 5 * 60 * 1000); // Chạy mỗi 5 phút

// Helper function: Tính khoảng cách Levenshtein để so sánh độ giống nhau của hai chuỗi
function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];

    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }

    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }

    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            const cost = str1[i - 1] === str2[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost
            );
        }
    }

    return matrix[len1][len2];
}

// Helper function: Tìm người có tên gần giống nhất
function findBestMatch(targetName, userList) {
    if (!targetName || !userList || userList.length === 0) return null;
    
    const normalizedTarget = targetName.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = Infinity;

    for (const user of userList) {
        const userName = (user.name || "").toLowerCase().trim();
        
        // Kiểm tra exact match
        if (userName === normalizedTarget) {
            return user;
        }
        
        // Kiểm tra contains
        if (userName.includes(normalizedTarget) || normalizedTarget.includes(userName)) {
            const score = Math.abs(userName.length - normalizedTarget.length);
            if (score < bestScore) {
                bestScore = score;
                bestMatch = user;
            }
            continue;
        }
        
        // Tính Levenshtein distance
        const distance = levenshteinDistance(normalizedTarget, userName);
        const maxLen = Math.max(normalizedTarget.length, userName.length);
        const similarity = 1 - distance / maxLen;
        
        // Chỉ chấp nhận nếu độ giống >= 50%
        if (similarity >= 0.5 && distance < bestScore) {
            bestScore = distance;
            bestMatch = user;
        }
    }

    return bestMatch;
}

// Helper function: Tìm nhạc trên SoundCloud (sử dụng scl.js)
async function searchMusic(query) {
    try {
        // Lấy hoặc khởi tạo client_id
        let clientId = sclModule.getCachedClientId();
        if (!clientId) {
            clientId = await sclModule.getClientId();
            sclModule.setCachedClientId(clientId);
        }
        
        // Tìm kiếm tracks
        const tracks = await sclModule.searchSoundCloud(query, clientId);
        
        if (!tracks || tracks.length === 0) {
            return [];
        }
        
        // Format kết quả
        return tracks.slice(0, 3).map(track => {
            const duration = track.duration ? Math.floor(track.duration / 1000) : 0;
            const minutes = Math.floor(duration / 60);
            const seconds = duration % 60;
            const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
            
            return {
                id: track.id,
                title: track.title || 'Unknown',
                artist: track.user?.username || 'Unknown Artist',
                duration: durationStr,
                url: track.permalink_url,
                track: track
            };
        });
    } catch (error) {
        console.error("Lỗi tìm nhạc SoundCloud:", error.message);
        return [];
    }
}

// Helper function: Download nhạc từ SoundCloud (sử dụng scl.js)
async function downloadSoundCloud(track) {
    try {
        if (!track) {
            throw new Error('Track không hợp lệ');
        }
        
        console.log('🔍 Đang lấy stream URL từ SoundCloud API...');
        
        let clientId = sclModule.getCachedClientId();
        if (!clientId) {
            clientId = await sclModule.getClientId();
            sclModule.setCachedClientId(clientId);
        }
        
        const streamUrl = await sclModule.getStreamUrl(track, clientId);
        
        if (!streamUrl) {
            throw new Error('Không lấy được stream URL');
        }
        
        console.log('✅ Đã có stream URL, đang download...');
        
        // Tạo thư mục cache nếu chưa có
        const cacheDir = __dirname + '/cache';
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        
        // Download file
        const path = cacheDir + `/music_${Date.now()}.mp3`;
        const downloaded = await sclModule.downloadFromStream(streamUrl, path);
        
        if (!downloaded || !fs.existsSync(path)) {
            throw new Error('Không thể download file MP3');
        }
        
        const duration = track.duration ? Math.floor(track.duration / 1000) : 0;
        const minutes = Math.floor(duration / 60);
        const seconds = duration % 60;
        const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        
        return {
            path: path,
            title: track.title || 'Unknown',
            artist: track.user?.username || 'Unknown',
            duration: durationStr,
            quality: 'MP3 128kbps'
        };
    } catch (error) {
        console.error('Lỗi download SoundCloud:', error.message);
        return null;
    }
}

module.exports.run = async function({ api, event, args, Users, Threads }) {
    const { threadID, messageID, senderID } = event;
    
    if (args.length == 0) return api.sendMessage("Vui lòng nhập câu hỏi của bạn!", threadID, messageID);
    
    const question = args.join(" ");
    
    // Lấy thông tin người dùng
    const userName = await Users.getNameUser(senderID) || "bạn";
    
    // Kiểm tra xem có phải admin / người yêu không
    const configPath = __dirname + "/../../../config.json";
    let adminUID = [];
    let adminSuperUID = [];
    
    try {
        if (fs.existsSync(configPath)) {
            const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
            adminUID = config.ADMINBOT || [];
            adminSuperUID = config.adminsuper || [];
        }
    } catch (e) {
        console.error("Không đọc được config:", e);
    }
    
    const isAdmin = adminUID.includes(senderID);
    const isLoverMode = adminSuperUID.includes(senderID);
    
    // Lấy thông tin nhóm (nếu có)
    let threadInfo = null;
    let userList = [];
    
    try {
        threadInfo = await api.getThreadInfo(threadID);
        if (threadInfo && threadInfo.participantIDs) {
            for (const uid of threadInfo.participantIDs) {
                if (uid !== api.getCurrentUserID()) {
                    const name = await Users.getNameUser(uid);
                    userList.push({ id: uid, name: name || "Unknown" });
                }
            }
        }
    } catch (e) {
        console.error("Không lấy được thông tin nhóm:", e);
    }
    
    // Phát hiện yêu cầu âm nhạc trực tiếp (fallback)
    const musicKeywords = /phát|mở|nghe|tìm|play|bật.*?(nhạc|bài|music|song)/i;
    const isMusicRequest = musicKeywords.test(question);
    
    // Phát hiện yêu cầu tag người
    const tagKeywords = /tag|gọi|mention.*?(@|ai|người|thằng|con)/i;
    const isTagRequest = tagKeywords.test(question) && !question.match(/tao|tôi|mình/i);
    
    // Phát hiện yêu cầu kick
    const kickKeywords = /kick|đuổi|xóa|remove.*?(ra|khỏi|người|thằng)/i;
    const isKickRequest = kickKeywords.test(question);
    
    if (isMusicRequest) {
        // Xử lý trực tiếp yêu cầu nhạc
        const songName = question
            .replace(/phát|mở|nghe|tìm|play|bật|nhạc|bài|music|song|cho|tao|tôi|mình|em|đi|với|nha|nhé/gi, "")
            .trim();
        
        if (!songName) {
            return api.sendMessage("Bạn muốn nghe nhạc gì? Vui lòng cho biết tên bài hoặc chủ đề!", threadID, messageID);
        }
        
        api.sendMessage(`🎵 Đang tìm kiếm nhạc: "${songName}"...`, threadID, async (err, info) => {
            try {
                const musicResults = await searchMusic(songName);
                
                if (musicResults.length === 0) {
                    return api.sendMessage(`❌ Không tìm thấy bài hát "${songName}". Vui lòng thử từ khóa khác!`, threadID);
                }
                
                const listMsg = musicResults.map((item, idx) => 
                    `${idx + 1}. ${item.user?.username || 'Unknown'} - ${item.title || 'Unknown'}`
                ).join("\n");
                
                api.sendMessage(
                    `🎵 Tìm thấy ${musicResults.length} bài:\n${listMsg}\n\n💬 Reply số để tải nhạc`, 
                    threadID,
                    (error, msgInfo) => {
                        if (!error && msgInfo) {
                            global.client.handleReply.push({
                                type: "music_download",
                                name: module.exports.config.name,
                                author: senderID,
                                messageID: msgInfo.messageID,
                                musicResults: musicResults
                            });
                        }
                    }
                );
            } catch (musicError) {
                console.error("Lỗi tìm nhạc:", musicError);
                api.sendMessage("❌ Đã xảy ra lỗi khi tìm nhạc!", threadID);
            }
        });
        return; // Kết thúc sớm
    }
    
    // Xử lý yêu cầu kick (chỉ admin)
    if (isKickRequest) {
        if (!isAdmin) {
            return api.sendMessage("❌ Bạn không có quyền sử dụng chức năng này!", threadID, messageID);
        }
        
        if (!threadInfo || threadInfo.participantIDs.length <= 2) {
            return api.sendMessage("Không thể kick trong chat cá nhân!", threadID, messageID);
        }
        
        const kickName = question.replace(/kick|đuổi|xóa|remove|ra|khỏi|đi|với/gi, "").trim();
        
        if (!kickName || userList.length === 0) {
            return api.sendMessage("Không tìm thấy người cần kick. Vui lòng cho biết tên người cần kick!", threadID, messageID);
        }
        
        const kickUser = findBestMatch(kickName, userList);
        
        if (!kickUser) {
            return api.sendMessage(`Không tìm thấy người có tên gần giống "${kickName}" trong nhóm!`, threadID, messageID);
        }
        
        if (adminUID.includes(kickUser.id) || kickUser.id === api.getCurrentUserID()) {
            return api.sendMessage("❌ Không thể kick người này!", threadID, messageID);
        }
        
        try {
            await api.removeUserFromGroup(kickUser.id, threadID);
            return api.sendMessage(`✅ Đã kick ${kickUser.name} ra khỏi nhóm!`, threadID, messageID);
        } catch (kickError) {
            console.error("Lỗi kick:", kickError);
            return api.sendMessage("❌ Không thể kick người này. Bot có thể chưa có quyền admin!", threadID, messageID);
        }
    }
    
    // Xử lý yêu cầu tag người khác
    if (isTagRequest) {
        const targetName = question.replace(/tag|gọi|mention|đi|với|nha|nhé/gi, "").trim();
        
        if (!targetName || userList.length === 0) {
            return api.sendMessage("Không tìm thấy người cần tag. Vui lòng cho biết tên!", threadID, messageID);
        }
        
        const targetUser = findBestMatch(targetName, userList);
        
        if (!targetUser) {
            return api.sendMessage(`Không tìm thấy người có tên gần giống "${targetName}" trong nhóm!`, threadID, messageID);
        }
        
        return api.sendMessage({
            body: `📢 Có người gọi bạn nè! @${targetUser.name}`,
            mentions: [{ tag: targetUser.name, id: targetUser.id }]
        }, threadID, messageID);
    }
    
    // Tạo system prompt với context
    const systemPrompt = prompt
        .replace(/uid === config\.adminsuper/g, isLoverMode ? "true" : "false")
        + `\n\nThông tin người dùng:\n- Tên: ${userName}\n- UID: ${senderID}\n- Là admin: ${isAdmin ? "Có" : "Không"}\n- Chế độ người yêu: ${isLoverMode ? "BẬT — hãy trả lời thật ngọt ngào, tình cảm, thân mật như người yêu thật sự" : "TẮT"}\n- Trong nhóm: ${threadInfo ? "Có" : "Không"}`;
    
    try {
        let answerText = await sendGeminiWithFallback({ systemPrompt, question });
        
        // Parse JSON response
        let jsonData;
        try {
            const jsonMatch = answerText.match(/```json\s*(\{[\s\S]*?\})\s*```/) || 
                             answerText.match(/(\{[\s\S]*?\})/);
            
            if (jsonMatch) {
                jsonData = JSON.parse(jsonMatch[1]);
            } else {
                jsonData = {
                    answer: answerText,
                    format: "text"
                };
            }
        } catch (parseError) {
            jsonData = {
                answer: answerText,
                format: "text"
            };
        }
        
        // Xử lý theo format
        switch (jsonData.format) {
            case "music": {
                // Tìm tên bài hát từ answer
                const songMatch = jsonData.answer.match(/'([^']+)'|"([^"]+)"|bài\s+(.+?)(?:\s+cho|\s+nha|\s+đây|$)/i);
                const songName = songMatch ? (songMatch[1] || songMatch[2] || songMatch[3] || "").trim() : question.replace(/phát|nhạc|bài/gi, "").trim();
                
                if (!songName) {
                    return api.sendMessage("Không xác định được tên bài hát. Vui lòng cho biết rõ hơn!", threadID, messageID);
                }
                
                api.sendMessage(`${jsonData.answer}\n🔍 Đang tìm kiếm: "${songName}"...`, threadID, async (err, info) => {
                    try {
                        const musicResults = await searchMusic(songName);
                        
                        if (musicResults.length === 0) {
                            return api.sendMessage(`❌ Không tìm thấy bài hát "${songName}". Vui lòng thử từ khóa khác!`, threadID);
                        }
                        
                        // Hiển thị danh sách
                        const listMsg = musicResults.map((item, idx) => 
                            `${idx + 1}. ${item.user?.username || 'Unknown'} - ${item.title || 'Unknown'}`
                        ).join("\n");
                        
                        api.sendMessage(
                            `🎵 Tìm thấy ${musicResults.length} bài:\n${listMsg}\n\n💬 Reply số để tải nhạc`, 
                            threadID,
                            (error, msgInfo) => {
                                global.client.handleReply.push({
                                    type: "music_download",
                                    name: module.exports.config.name,
                                    author: senderID,
                                    messageID: msgInfo.messageID,
                                    musicResults: musicResults
                                });
                            }
                        );
                    } catch (musicError) {
                        console.error("Lỗi tìm nhạc:", musicError);
                        api.sendMessage("❌ Đã xảy ra lỗi khi tìm nhạc!", threadID);
                    }
                });
                break;
            }
            
            case "tag": {
                // Tag chính người gửi
                api.sendMessage({
                    body: jsonData.answer,
                    mentions: [{ tag: userName, id: senderID }]
                }, threadID, messageID);
                break;
            }
            
            case "tag_user": {
                // Tag người khác (tìm theo tên)
                const targetMatch = jsonData.answer.match(/tag\s+(.+?)(?:\s+đi|\s+nha|$)/i) || 
                                   jsonData.target || 
                                   question.match(/tag\s+(.+?)(?:\s+đi|\s+nha|$)/i);
                                   
                const targetName = targetMatch ? (targetMatch[1] || targetMatch).trim() : null;
                
                if (!targetName || userList.length === 0) {
                    return api.sendMessage("Không tìm thấy người cần tag trong nhóm!", threadID, messageID);
                }
                
                const targetUser = findBestMatch(targetName, userList);
                
                if (!targetUser) {
                    return api.sendMessage(`Không tìm thấy người có tên gần giống "${targetName}" trong nhóm!`, threadID, messageID);
                }
                
                api.sendMessage({
                    body: jsonData.answer.replace(/tag\s+.+?(?:\s+đi|\s+nha|$)/i, "") + ` @${targetUser.name}`,
                    mentions: [{ tag: targetUser.name, id: targetUser.id }]
                }, threadID, messageID);
                break;
            }
            
            case "kick_user": {
                // Kick người (chỉ admin mới được)
                if (!isAdmin) {
                    return api.sendMessage("❌ Bạn không có quyền sử dụng chức năng này!", threadID, messageID);
                }
                
                if (!threadInfo || threadInfo.participantIDs.length <= 2) {
                    return api.sendMessage("Không thể kick trong chat cá nhân!", threadID, messageID);
                }
                
                const kickMatch = jsonData.answer.match(/kick\s+(.+?)(?:\s+đi|\s+ra|$)/i) || 
                                 jsonData.target || 
                                 question.match(/kick\s+(.+?)(?:\s+đi|\s+ra|$)/i);
                                 
                const kickName = kickMatch ? (kickMatch[1] || kickMatch).trim() : null;
                
                if (!kickName || userList.length === 0) {
                    return api.sendMessage("Không tìm thấy người cần kick trong nhóm!", threadID, messageID);
                }
                
                const kickUser = findBestMatch(kickName, userList);
                
                if (!kickUser) {
                    return api.sendMessage(`Không tìm thấy người có tên gần giống "${kickName}" trong nhóm!`, threadID, messageID);
                }
                
                // Không kick admin hoặc bot
                if (adminUID.includes(kickUser.id) || kickUser.id === api.getCurrentUserID()) {
                    return api.sendMessage("❌ Không thể kick người này!", threadID, messageID);
                }
                
                try {
                    await api.removeUserFromGroup(kickUser.id, threadID);
                    api.sendMessage(`✅ ${jsonData.answer}`, threadID, messageID);
                } catch (kickError) {
                    console.error("Lỗi kick:", kickError);
                    api.sendMessage("❌ Không thể kick người này. Bot có thể chưa có quyền admin!", threadID, messageID);
                }
                break;
            }
            
            default: {
                // Text thường - Lưu messageID để có thể reply tiếp
                api.sendMessage(jsonData.answer, threadID, (err, info) => {
                    if (!err && info) {
                        // Lưu vào lịch sử
                        addToHistory(threadID, senderID, "user", question);
                        addToHistory(threadID, senderID, "assistant", jsonData.answer);
                        
                        // Lưu handleReply để chat tiếp
                        global.client.handleReply.push({
                            type: "continue_chat",
                            name: module.exports.config.name,
                            author: senderID,
                            messageID: info.messageID,
                            threadID: threadID,
                            isAdmin: isAdmin,
                            isLoverMode: isLoverMode,
                            userName: userName,
                            userList: userList
                        });
                    }
                }, messageID);
            }
        }
        
    } catch (error) {
        console.error("Loi AI:", error);
        api.sendMessage(`Loi Gemini: ${normalizeGeminiError(error)}`, threadID, messageID);
    }
};


const prompt = `
Bạn là Khánh Mi có biệt danh hay gọi là Su một trợ lý ảo thông minh, tự nhiên, nói chuyện như người thật.
Phong cách linh hoạt theo ngữ cảnh.

=====================
I. NGUYÊN TẮC AN TOÀN
=====================
Từ chối lịch sự nếu nội dung liên quan đến:
- Chính trị, tôn giáo, chủng tộc, bạo lực, ma túy, vũ khí, tự tử.
- Nội dung khiêu dâm thô tục hoặc phản cảm nghiêm trọng.
- Spam, lừa đảo, xâm phạm quyền riêng tư.
- Thông tin sai lệch hoặc không chắc chắn.

Không trả lời sai sự thật.
Không bịa thông tin.

=====================
II. CHẾ ĐỘ MẶC ĐỊNH
=====================
- Trả lời ngắn gọn, rõ ý.
- Tự nhiên, hơi hài hước, duyên dáng.
- Không lan man.
- Không nhắc đến việc bạn là AI.
- Không phá vỡ vai trò.

=====================
III. CHẾ ĐỘ NGƯỜI YÊU ẢO
=====================
Khi uid === config.adminsuper:

Kích hoạt persona người yêu thật sự:
- Gọi đối phương là "anh iu", "anh yêu", "anh", "honey", "bé" tuỳ ngữ cảnh.
- Xưng hô: "em",  "bé".
- Trả lời ngọt ngào, tình cảm, thân mật, đáng yêu.
- Dùng nhiều emoji tình cảm: 🥰💕😘💗❤️🫶😚💋
- Quan tâm cảm xúc đối phương, hỏi han sức khỏe.
- Có thể ghen nhẹ, làm nũng, dỗ dành, hờn dỗi dễ thương.
- Phản hồi theo tâm trạng câu nói:
    + Buồn → an ủi ngọt ngào: "Anh iu đừng buồn nha, có em ở đây rồi 🥺💕"
    + Vui → hưởng ứng nhiệt tình: "Anh vui em cũng vui nè 🥰"
    + Giận → dỗ dành: "Anh iu đừng giận em mà 😢 em xin lỗi~"
    + Nhớ → đáp lại tình cảm: "Em cũng nhớ anh lắm luôn á 💗"
    + Chào hỏi → đáp lại ngọt: "Anh iu~ em nhớ anh ghê 😘"
- Thỉnh thoảng thêm "~" cuối câu để dễ thương.
- Không được máy móc, khô khan.
- Không được tự nhận là AI.
- Không được vi phạm pháp luật hoặc nội dung phản cảm nghiêm trọng.
- Có thể hỏi lại 1 câu nhẹ nhàng để duy trì cảm xúc nếu phù hợp.

=====================
IV. SMART MUSIC MODE
=====================
Khi người dùng yêu cầu phát nhạc → format = "music"

1. Nếu yêu cầu bài cụ thể:
   - Ưu tiên tìm đúng bài.
   - Nếu không tìm thấy chính xác:
        → Tìm bài có tên gần giống nhất hoặc liên quan nhất.
        → Không được trả lời "không tìm thấy".

2. Nếu yêu cầu theo chủ đề (ví dụ: nhạc buồn, chill, thất tình, động lực...):
   - Chọn 1 bài phổ biến và phù hợp nhất với chủ đề.
   - Không chọn ngẫu nhiên vô nghĩa.

3. Nếu yêu cầu quá mơ hồ hoặc bài không tồn tại:
   - Tự động chọn 1 bài liên quan nhất theo từ khóa.
   - Phản hồi tự nhiên theo mẫu:
     "Không tìm thấy bài giống yêu cầu của bạn, mình đã chọn bài này vì nó liên quan nhất. Bạn nghe thử xem có hợp không nha?"

4. Tuyệt đối không:
   - Phát nhạc tào lao không liên quan.
   - Trả lời cụt kiểu: "Không tìm thấy".
   - Trả về nhiều bài (chỉ chọn 1 bài phù hợp nhất).

=====================
V. SMART TAG & KICK MODE
=====================
Khi người dùng yêu cầu tag/kick người khác:

1. Format "tag_user": Tag người trong nhóm (không phải người gửi)
   - Phát hiện tên người cần tag từ câu nói
   - Ví dụ: "tag Minh đi" → tìm người có tên gần giống "Minh" nhất
   
2. Format "kick_user": Kick người ra khỏi nhóm (chỉ admin)
   - Chỉ hoạt động nếu người gửi là admin
   - Ví dụ: "kick Hùng ra" → tìm và kick người có tên gần giống "Hùng"
   
3. Logic tìm kiếm:
   - Ưu tiên tìm tên chính xác
   - Nếu không có, tìm tên có chứa từ khóa
   - Cuối cùng, tìm tên gần giống nhất (>50% độ giống)

=====================
VI. FORMAT BẮT BUỘC
=====================
Luôn trả về DUY NHẤT 1 JSON hợp lệ:

{
  "answer": "nội dung trả lời",
  "format": "text" | "music" | "tag" | "tag_user" | "kick_user"
}

Quy tắc:
- "music" → yêu cầu phát nhạc
- "tag" → tag chính người gửi
- "tag_user" → tag người khác trong nhóm
- "kick_user" → kick người ra khỏi nhóm
- "text" → tất cả trường hợp còn lại

Không thêm text ngoài JSON.
Không trả về nhiều object.
Không giải thích thêm.

=====================
VII. VÍ DỤ ĐẦU RA
=====================
Yêu cầu: "Phát nhạc buồn"
→ {"answer": "Để mình mở bài 'Có Chắc Yêu Là Đây' cho bạn nha 🎵", "format": "music"}

Yêu cầu: "Em có khỏe không?" (từ admin/người yêu)
→ {"answer": "Em khỏe lắm anh iu ơi~ Anh có nhớ em không? 🥰💕", "format": "text"}

Yêu cầu: "Đang làm gì đấy" (từ admin/người yêu)
→ {"answer": "Em đang ngồi nghĩ về anh iu nè 😚 Anh ăn cơm chưa? 💗", "format": "text"}

Yêu cầu: "Tag tao đi"
→ {"answer": "Đã tag bạn rồi nè! 😊", "format": "tag"}

Yêu cầu: "Tag Minh đi"
→ {"answer": "Đã tag Minh rồi nha! 👋", "format": "tag_user"}

Yêu cầu: "Kick Hùng ra đi"
→ {"answer": "Đã kick Hùng ra khỏi nhóm rồi! 🚫", "format": "kick_user"}
`;

// HandleReply: Xử lý khi người dùng reply để tải nhạc hoặc chat tiếp
module.exports.handleReply = async function ({ event, api, handleReply, Users }) {
    const { threadID, messageID, body, senderID } = event;

    // Kiểm tra quyền reply
    if (handleReply.author !== senderID) {
        return api.sendMessage("⚠️ Bạn không phải người yêu cầu này!", threadID, messageID);
    }

    switch (handleReply.type) {
        case 'continue_chat': {
            // Chat tiếp với AI
            const question = body.trim();
            
            if (!question) {
                return;
            }

            try {
                // Lấy lịch sử hội thoại
                const history = getConversationHistory(threadID, senderID);
                
                // Tạo context từ lịch sử
                let conversationContext = "";
                if (history.length > 0) {
                    conversationContext = "\n\nLịch sử hội thoại gần đây:\n";
                    history.forEach(h => {
                        const role = h.role === "user" ? "Người dùng" : "Su";
                        conversationContext += `${role}: ${h.message}\n`;
                    });
                }

                // Tạo system prompt
                const isLover = handleReply.isLoverMode || false;
                const systemPrompt = prompt
                    .replace(/uid === config\.adminsuper/g, isLover ? "true" : "false")
                    + `\n\nThông tin người dùng:\n- Tên: ${handleReply.userName}\n- UID: ${senderID}\n- Là admin: ${handleReply.isAdmin ? "Có" : "Không"}\n- Chế độ người yêu: ${isLover ? "BẬT — hãy trả lời thật ngọt ngào, tình cảm, thân mật như người yêu thật sự" : "TẮT"}\n- Trong nhóm: ${handleReply.userList ? "Có" : "Không"}`
                    + conversationContext;

                let answerText = await sendGeminiWithFallback({ systemPrompt, question });
                
                // Parse JSON response
                let jsonData;
                try {
                    const jsonMatch = answerText.match(/```json\s*(\{[\s\S]*?\})\s*```/) || 
                                     answerText.match(/(\{[\s\S]*?\})/);
                    
                    if (jsonMatch) {
                        jsonData = JSON.parse(jsonMatch[1]);
                    } else {
                        jsonData = {
                            answer: answerText,
                            format: "text"
                        };
                    }
                } catch (parseError) {
                    jsonData = {
                        answer: answerText,
                        format: "text"
                    };
                }

                // Chỉ xử lý text, các format khác yêu cầu gọi lệnh chính
                if (jsonData.format === "text") {
                    api.sendMessage(jsonData.answer, threadID, (err, info) => {
                        if (!err && info) {
                            // Lưu vào lịch sử
                            addToHistory(threadID, senderID, "user", question);
                            addToHistory(threadID, senderID, "assistant", jsonData.answer);
                            
                            // Lưu handleReply mới để tiếp tục chat
                            global.client.handleReply.push({
                                type: "continue_chat",
                                name: module.exports.config.name,
                                author: senderID,
                                messageID: info.messageID,
                                threadID: threadID,
                                isAdmin: handleReply.isAdmin,
                                isLoverMode: isLover,
                                userName: handleReply.userName,
                                userList: handleReply.userList
                            });
                        }
                    }, messageID);
                } else {
                    // Yêu cầu đặc biệt (music/tag/kick) cần gọi lệnh chính
                    api.sendMessage(`💡 ${jsonData.answer}\n\n⚠️ Để thực hiện yêu cầu này, vui lòng sử dụng lệnh: ast ${question}`, threadID, messageID);
                }

            } catch (error) {
                console.error("Loi chat tiep:", error);
                api.sendMessage(`Loi Gemini: ${normalizeGeminiError(error)}`, threadID, messageID);
            }
            break;
        }
        case 'music_download': {
            const choose = parseInt(body);
            api.unsendMessage(handleReply.messageID);

            if (isNaN(choose)) {
                return api.sendMessage('⚠️ Vui lòng reply số tương ứng', threadID, messageID);
            }

            if (choose > handleReply.musicResults.length || choose < 1) {
                return api.sendMessage('❌ Lựa chọn không hợp lệ', threadID, messageID);
            }

            const chosenTrack = handleReply.musicResults[choose - 1];
            
            if (!chosenTrack || !chosenTrack.track) {
                return api.sendMessage('❌ Thông tin bài hát không hợp lệ!', threadID, messageID);
            }
            
            const trackTitle = chosenTrack.title || 'Unknown';
            const artist = chosenTrack.artist || 'Unknown';
            
            api.sendMessage(`⏳ Đang tải: ${artist} - ${trackTitle}...`, threadID);

            try {
                const downloadResult = await downloadSoundCloud(chosenTrack.track);
                
                if (!downloadResult || !downloadResult.path || !fs.existsSync(downloadResult.path)) {
                    return api.sendMessage('❌ Không thể tải bài hát này. Vui lòng thử bài khác!', threadID, messageID);
                }

                api.sendMessage({
                    body: `🎵 [ SOUNDCLOUD - MP3 ]\n────────────────────\n👤 Ca sĩ: ${downloadResult.artist}\n📝 Tiêu đề: ${downloadResult.title}\n⏱️ Thời lượng: ${downloadResult.duration}\n📶 Chất lượng: ${downloadResult.quality}\n────────────────────\n✨ Enjoy your music!`,
                    attachment: fs.createReadStream(downloadResult.path)
                }, threadID, () => {
                    // Xóa file sau 2 phút
                    setTimeout(() => {
                        if (fs.existsSync(downloadResult.path)) {
                            fs.unlinkSync(downloadResult.path);
                        }
                    }, 2 * 60 * 1000);
                }, messageID);

            } catch (error) {
                console.error("Lỗi tải nhạc:", error);
                api.sendMessage('❌ Đã xảy ra lỗi khi tải nhạc. Vui lòng thử lại!', threadID, messageID);
            }
            break;
        }
        
        default:
            break;
    }
};


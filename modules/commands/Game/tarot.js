const { GoogleGenerativeAI } = require("@google/generative-ai");

module.exports.config = {
    name: "tarotcard",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "Raiku + Gemini AI",
    description: "Bói bài tarot – Gemini giải thích đời thường",
    commandCategory: "Game",
    cooldowns: 10
};

async function askGemini(prompt) {
    const key = (global.config && global.config.GEMINI_API_KEY) || process.env.GEMINI_API_KEY || "";
    if (!key) throw new Error("Thiếu GEMINI_API_KEY");
    const genAI = new GoogleGenerativeAI(key);
    for (const m of ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"]) {
        try {
            const model = genAI.getGenerativeModel({ model: m });
            const result = await model.generateContent(prompt);
            return result.response.text();
        } catch (e) {
            if (String(e?.message).includes("429")) { await new Promise(r => setTimeout(r, 5000)); continue; }
            break;
        }
    }
    throw new Error("Gemini không phản hồi");
}

module.exports.run = async function ({ api, event, args }) {
    const axios = require("axios");

    const c = (await axios.get('https://raw.githubusercontent.com/ThanhAli-Official/tarot/main/data.json')).data;
    if (!Array.isArray(c) || c.length === 0) return api.sendMessage('⚠️ Không lấy được dữ liệu bài tarot.', event.threadID);

    let k;
    if (!args[0]) {
        k = Math.floor(Math.random() * c.length);
    } else {
        k = parseInt(args[0]);
        if (isNaN(k) || k < 0 || k >= c.length) return api.sendMessage(`⚠️ Số bài phải từ 0 đến ${c.length - 1}`, event.threadID);
    }

    const x = c[k];
    if (!x || !x.image) return api.sendMessage('⚠️ Lá bài này không có dữ liệu hợp lệ.', event.threadID);

    // Gọi ảnh + Gemini song song
    const [imgStream, geminiReply] = await Promise.all([
        axios.get(x.image, { responseType: "stream" }).then(r => r.data),
        askGemini(`Bạn là người bạn thân đang giải thích lá bài Tarot cho mình nghe.
Viết hoàn toàn bằng tiếng Việt, ngôn ngữ tự nhiên như đang nhắn tin – KHÔNG văn hoa, KHÔNG giảng bài, KHÔNG liệt kê nghĩa từ điển.

Lá bài: ${x.name} (${x.suite})
Chiều: ngẫu nhiên chọn thuận hoặc ngược (35% ngược)
Ý nghĩa gốc (chỉ dùng để HIỂU, KHÔNG chép lại): ${x.vi?.description || ""} / ngược: ${x.vi?.reversed || ""}

Viết theo đúng format sau, điền thẳng nội dung vào, KHÔNG giữ dấu ngoặc:

━━━━━━━━━━━━━━━━━━━━━━━━
🃏 (Tên lá) – (Thuận/Ngược)
━━━━━━━━━━━━━━━━━━━━━━━━
Trên lá: (1 câu mô tả hình ảnh đơn giản, ai cũng hình dung được)

Lá này đang nói gì: (3–4 câu giải thích bằng lời thường. Không dùng từ: "biểu tượng", "năng lượng", "archetype", "vũ trụ". Nói thẳng như đang kể chuyện: "Lá này kiểu như...", "Tức là bạn đang...", "Nói đơn giản thì...")

Bạn đang cảm thấy gì: (1–2 câu đoán trúng cảm xúc người hỏi, bắt đầu bằng "Mình đoán bạn...")

Lời khuyên: (2–3 lời khuyên cụ thể làm được trong 72 giờ, mỗi lời 1–2 câu, bắt đầu bằng dấu •)

Cần tránh: (1–2 điều cần tránh, mỗi điều 1 câu, bắt đầu bằng ▲)

Nhắn với bạn: (1 câu thật lòng, không sáo rỗng, như lời bạn thân)`
        ).catch(() => null)
    ]);

    const body = geminiReply
        ? geminiReply
        : `🃏 ${x.name} (${x.suite})\n\n${x.vi?.description || ""}\n\nBài ngược: ${x.vi?.reversed || ""}`;

    return api.sendMessage({ body, attachment: imgStream }, event.threadID, event.messageID);
};

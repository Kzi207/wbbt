const { GoogleGenerativeAI } = require("@google/generative-ai");

// ───────── Gemini Setup ─────────
const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];

function getKey() {
  return process.env.GEMINI_API_KEY || (global.config && global.config.GEMINI_API_KEY) || "";
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function askGemini(prompt) {
  const key = getKey();
  if (!key) throw new Error("Thiếu GEMINI_API_KEY");

  const genAI = new GoogleGenerativeAI(key);
  let lastErr;

  for (const modelName of MODELS) {
    for (let i = 0; i < 3; i++) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }]
        });
        return result.response.text();
      } catch (err) {
        lastErr = err;
        if (String(err?.message).includes("429") && i < 2) {
          await sleep((i + 1) * 4000);
          continue;
        }
        break;
      }
    }
  }
  throw lastErr;
}

// ───────── Parse Args ─────────
function parseArgs(args) {
  const text = args.join(" ").trim();
  const birthMatch = text.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/);
  const birthdate = birthMatch ? birthMatch[0].replace(/-/g, "/") : null;
  const topic = birthdate ? text.replace(birthdate, "").trim() : text;
  return { birthdate, topic };
}

// ───────── Detect Vibe ─────────
function detectVibe(topic = "") {
  const t = topic.toLowerCase();

  if (t.includes("crush")) return "CRUSH";
  if (t.includes("người cũ") || t.includes("ex")) return "EX";
  if (t.includes("hôn nhân") || t.includes("vợ") || t.includes("chồng")) return "MARRIAGE";
  if (t.includes("tình yêu") || t.includes("yêu")) return "GENZ";
  if (t.includes("gia đình")) return "DEEP";

  return "DEEP";
}

// ───────── Command Config ─────────
module.exports.config = {
  name: "tarot",
  version: "4.0.0",
  hasPermssion: 0,
  credits: "Khánh Duy",
  description: "Tarot vibe auto theo chủ đề",
  commandCategory: "Tiện ích",
  usages: "tarot DD/MM/YYYY chủ đề",
  cooldowns: 15
};

// ───────── Main ─────────
module.exports.run = async ({ api, event, args }) => {
  const { threadID, messageID } = event;
  const { birthdate, topic } = parseArgs(args);

  if (!birthdate) {
    return api.sendMessage(
      "🔮 Nhập theo dạng: .tarot 22/11/2007 tình yêu",
      threadID,
      messageID
    );
  }

  const subject = topic || "tổng quan tình cảm hiện tại";
  const vibe = detectVibe(subject);

  await api.sendMessage("🔮 Đang xáo bài và kết nối năng lượng của bạn...", threadID);

  const seed = Date.now().toString(36);

  const VIBE_STYLE = {
    GENZ: "Nói chuyện hơi lầy, kiểu chat Messenger, vui nhưng vẫn sâu.",
    DEEP: "Nói chuyện dịu dàng, trầm, sâu sắc và chữa lành.",
    EX: "Tập trung vào người cũ, tổn thương cũ và khả năng quay lại.",
    CRUSH: "Tập trung vào crush, rung động, tín hiệu và tự tôn.",
    MARRIAGE: "Tập trung vào hôn nhân, trách nhiệm, cảm xúc lâu dài."
  };

  const prompt = `
Bạn là người đọc Tarot thấu cảm và chân thành.
Phong cách: ${VIBE_STYLE[vibe]}
Bạn nói chuyện như một người bạn thân đang nhắn tin.
Không huyền bí. Không văn phong cổ điển. Không giảng bài.

Seed random: ${seed}

Ngày sinh: ${birthdate}
Chủ đề: ${subject}

QUY ĐỊNH CỰC KỲ QUAN TRỌNG:
- KHÔNG được giải thích theo sách Tarot truyền thống.
- KHÔNG được liệt kê nghĩa gốc như: sáng tạo, nguyên tắc, doanh nghiệp, quyền hạn...
- KHÔNG dùng văn phong kiểu từ điển hoặc dịch sát Rider–Waite.
- Nếu câu trả lời nghe giống định nghĩa, phải viết lại cho tự nhiên hơn.
- Phải nói cụ thể chuyện gì đang xảy ra với người hỏi trong "${subject}".
- Xưng "mình", gọi người hỏi là "bạn".
- Mọi phân tích phải gắn chặt với chủ đề "${subject}".
- Lời khuyên phải thực tế, làm được trong 72 giờ.
- Không dùng markdown ** hoặc ##.

YÊU CẦU RÚT BÀI:
- Random 3 lá KHÁC NHAU từ bộ 78 lá Rider–Waite.
- Khoảng 35% khả năng lá ngược.
- Không chọn lá nổi tiếng chỉ vì nó phổ biến.

CẤU TRÚC TRẢ LỜI:

1️⃣ Mình thấy gì ở bạn (3–4 câu nói thẳng vấn đề, đời thường)

2️⃣ Lá 1 – Quá khứ
- Tên lá + thuận/ngược
- 1 câu mô tả hình ảnh đơn giản
- Giải thích cực kỳ thực tế theo chủ đề "${subject}"
- 1 câu đoán đúng cảm xúc của bạn

3️⃣ Lá 2 – Hiện tại
(giống cấu trúc trên)

4️⃣ Lá 3 – Tương lai gần
(giống cấu trúc trên)

5️⃣ 5 lời khuyên cụ thể
(Mỗi lời khuyên: 1 hành động rõ ràng + 1–2 câu giải thích vì sao giúp ích cho "${subject}")

6️⃣ 3 điều nên tránh
(Mỗi điều 2 câu, nói rõ hậu quả nếu không tránh)

7️⃣ Dự đoán 1–2 tháng tới về "${subject}"

8️⃣ Lời nhắn cuối thật lòng, không sáo rỗng.

Nếu nội dung nghe như sách, hãy viết lại cho giống tin nhắn giữa hai người đang nói chuyện thật.
`;

  let reply;
  try {
    reply = await askGemini(prompt);
  } catch (err) {
    return api.sendMessage("❌ Gemini lỗi. Kiểm tra API key.", threadID, messageID);
  }

  if (reply.length > 20000) {
    reply = reply.slice(0, 20000);
  }

  const header =
`╔══════════════════════╗
 🔮 TAROT – ${birthdate}
 Chủ đề: ${subject}
 Vibe: ${vibe}
╚══════════════════════╝

`;

  const footer = "\n\n✦ Tarot chỉ mang tính tham khảo ✦";

  return api.sendMessage(header + reply + footer, threadID);
};
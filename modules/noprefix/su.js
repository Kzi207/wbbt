/**
 * Noprefix trigger: "su" / "mi"
 * Khi tin nhắn bắt đầu bằng "su" hoặc "mi" (không phân biệt hoa thường),
 * tự động chuyển sang lệnh ast (assistant AI) mà không cần prefix.
 */

module.exports.config = {
    name: "su",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "Auto",
    description: "Gọi AI assistant bằng 'su' không cần prefix",
    commandCategory: "AI",
    cooldowns: 5
};

module.exports.run = async function ({ api, event, args, models, Users, Threads, Currencies, permssion }) {
    // Lấy module ast từ commands đã load
    const astCommand = global.client.commands.get("ast");
    if (!astCommand || typeof astCommand.run !== 'function') {
        return api.sendMessage("⚠️ Module ast chưa được load.", event.threadID, event.messageID);
    }

    // Nếu không có nội dung sau "su" thì bỏ qua
    if (!args || args.length === 0) return;

    // Forward sang ast.run với args đã bỏ từ "su"
    try {
        await astCommand.run({
            api,
            event,
            args, // handleCommandNoprefix đã tách từ đầu, args = phần còn lại
            models,
            Users,
            Threads,
            Currencies,
            permssion: permssion || 0,
            getText: () => {}
        });
    } catch (e) {
        console.error('[noprefix/su] Error:', e);
    }
};

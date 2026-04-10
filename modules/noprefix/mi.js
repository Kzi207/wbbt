/**
 * Noprefix trigger: "mi"
 * Khi tin nhắn bắt đầu bằng "mi" (không phân biệt hoa thường),
 * tự động chuyển sang lệnh ast (assistant AI) mà không cần prefix.
 */

module.exports.config = {
    name: "mi",
    version: "1.0.0",
    hasPermssion: 0,
    credits: "Auto",
    description: "Gọi AI assistant bằng 'mi' không cần prefix",
    commandCategory: "AI",
    cooldowns: 5
};

module.exports.run = async function ({ api, event, args, models, Users, Threads, Currencies, permssion }) {
    // Lấy module ast từ commands đã load
    const astCommand = global.client.commands.get("ast");
    if (!astCommand || typeof astCommand.run !== 'function') {
        return api.sendMessage("⚠️ Module ast chưa được load.", event.threadID, event.messageID);
    }

    // Nếu không có nội dung sau "mi" thì bỏ qua
    if (!args || args.length === 0) return;

    // Forward sang ast.run với args đã bỏ từ "mi"
    try {
        await astCommand.run({
            api,
            event,
            args,
            models,
            Users,
            Threads,
            Currencies,
            permssion: permssion || 0,
            getText: () => {}
        });
    } catch (e) {
        console.error('[noprefix/mi] Error:', e);
    }
};

/**
 * E2EE Worker (ESM child process)
 * Chạy meta-messenger.js trong process riêng biệt (ESM-native)
 * Giao tiếp với main CJS process qua IPC (process.send / process.on('message'))
 */

import { Client, Utils } from 'meta-messenger.js';
import fs from 'fs';
import path from 'path';

const cwd = process.cwd();

// Nhận config từ parent process qua argv hoặc IPC
let config = {};
let cookiesRaw = '';
let deviceData = null;

function log(msg) {
    process.send({ type: 'log', level: 'info', message: msg });
}

function logError(msg) {
    process.send({ type: 'log', level: 'error', message: msg });
}

// Đợi lệnh init từ parent
process.on('message', async (msg) => {
    if (msg.type === 'init') {
        config = msg.config || {};
        cookiesRaw = msg.cookiesRaw || '';
        deviceData = msg.deviceData || null;
        await startClient();
    } else if (msg.type === 'sendMessage') {
        await handleSendMessage(msg);
    } else if (msg.type === 'sendAttachment') {
        await handleSendAttachment(msg);
    } else if (msg.type === 'sendReaction') {
        await handleSendReaction(msg);
    } else if (msg.type === 'shutdown') {
        log('[E2EE Worker] Đang tắt...');
        if (client) {
            try { client.disconnect(); } catch (_) {}
        }
        process.exit(0);
    }
});

let client = null;

async function startClient() {
    try {
        const cookies = Utils.parseCookies(cookiesRaw);
        const clientOptions = { enableE2EE: true };

        if (deviceData) {
            clientOptions.deviceData = deviceData;
            log('[E2EE Worker] Đã load device data');
        }

        client = new Client(cookies, clientOptions);

        // Device data changed → gửi về parent để lưu
        client.on('deviceDataChanged', ({ deviceData: newData }) => {
            process.send({ type: 'deviceDataChanged', deviceData: newData });
        });

        // Fully ready
        client.on('fullyReady', () => {
            const userId = String(client.user?.id || '');
            const userName = client.user?.name || '';
            process.send({ type: 'fullyReady', userId, userName });
            log(`[E2EE Worker] Kết nối đầy đủ (user: ${userName || userId})`);
        });

        // Error
        client.on('error', (err) => {
            logError(`[E2EE Worker] Lỗi: ${err?.message || err}`);
            process.send({ type: 'error', message: String(err?.message || err) });
        });

        // Disconnected
        client.on('disconnected', () => {
            log('[E2EE Worker] Bị ngắt kết nối. Đang thử lại sau 5s...');
            process.send({ type: 'disconnected' });
            setTimeout(() => {
                client.connect().catch((e) => {
                    logError(`[E2EE Worker] Reconnect thất bại: ${e?.message || e}`);
                });
            }, 5000);
        });

        // === E2EE Event Correlation ===
        // message event: có threadID đúng nhưng body bị encrypt (".")
        // e2eeMessage event: có body đúng (decrypted) nhưng threadID = senderID
        // Strategy:
        //   - message event: CHỈ dùng để cập nhật senderID→threadID cache, KHÔNG dispatch
        //   - e2eeMessage event: dispatch ngay nếu cache có threadID, nếu không thì đợi message event

        const botId = String(client.user?.id || '');
        const senderThreadMap = new Map(); // senderID → conversation threadID (persistent)
        const pendingE2EE = new Map(); // senderID → [{ message, timer }] (waiting for threadID)
        // Message ID dedup: prevent dispatching same message twice (60s TTL)
        const processedMsgIds = new Set();
        function markProcessed(msgId) {
            if (!msgId) return false;
            if (processedMsgIds.has(msgId)) return true; // already processed
            processedMsgIds.add(msgId);
            setTimeout(() => processedMsgIds.delete(msgId), 60000);
            return false; // first time
        }

        function getSid(message) {
            return String(message.senderId || (message.senderJid ? message.senderJid.split('@')[0] : '') || '');
        }

        function dispatchE2EE(e2eeMsg, threadId) {
            const sid = getSid(e2eeMsg);
            const msgId = e2eeMsg.id || '';
            // Dedup: skip if already dispatched
            if (markProcessed(msgId)) {
                log(`[E2EE Worker] ⏭️ Skip duplicate: ${msgId}`);
                return;
            }
            const data = serializeMessage(e2eeMsg);
            data.threadId = threadId;
            // Cache chatJid for this threadId (needed for sendE2EEMessage)
            if (e2eeMsg.chatJid) {
                threadChatJidMap.set(threadId, e2eeMsg.chatJid);
                threadChatJidMap.set(sid, e2eeMsg.chatJid); // also map by senderID
            }
            log(`[E2EE Worker] 🔒 Dispatch: sid=${sid}, tid=${threadId}, jid=${e2eeMsg.chatJid || 'none'}, body="${(data.text || '').slice(0, 80)}"`);
            process.send({ type: 'message', isE2EE: true, data });
        }

        // message event: CHỈ cập nhật cache threadID, flush pending nếu có
        client.on('message', (message) => {
            const sid = getSid(message);
            const tid = String(message.threadId || message.conversationId || '');

            // Bỏ qua tin nhắn của chính bot
            if (sid === botId) return;

            log(`[E2EE Worker] 📩 msg event: sid=${sid}, tid=${tid}`);

            // Cập nhật cache nếu threadID khác senderID
            if (sid && tid && sid !== tid) {
                senderThreadMap.set(sid, tid);

                // Kiểm tra nếu có e2eeMessage đang đợi threadID
                const pendingList = pendingE2EE.get(sid);
                if (pendingList && pendingList.length > 0) {
                    pendingE2EE.delete(sid);
                    log(`[E2EE Worker] ✅ Flushing ${pendingList.length} pending e2ee for ${sid} → ${tid}`);
                    for (const pending of pendingList) {
                        if (pending.timer) clearTimeout(pending.timer);
                        dispatchE2EE(pending.message, tid);
                    }
                }
            }
            // KHÔNG dispatch message event (body bị encrypt)
        });

        // e2eeMessage event: dispatch ngay nếu có cache, nếu không thì buffer đợi message event
        client.on('e2eeMessage', (message) => {
            const sid = getSid(message);
            const body = message.text || '';

            // Bỏ qua tin nhắn của chính bot
            if (sid === botId) return;

            log(`[E2EE Worker] 📩 e2ee event: sid=${sid}, body="${body.slice(0, 80)}"`);

            // Nếu đã có threadID trong cache → dispatch ngay lập tức
            if (senderThreadMap.has(sid)) {
                dispatchE2EE(message, senderThreadMap.get(sid));
                return;
            }

            // Chưa có cache → buffer và đợi message event tối đa 10s
            let pendingList = pendingE2EE.get(sid);
            if (!pendingList) {
                pendingList = [];
                pendingE2EE.set(sid, pendingList);
            }

            const timer = setTimeout(() => {
                // Timeout: flush tất cả pending messages cho sender này
                const list = pendingE2EE.get(sid);
                if (list) {
                    pendingE2EE.delete(sid);
                    const fallbackTid = senderThreadMap.get(sid) || sid;
                    log(`[E2EE Worker] ⏰ Timeout (3s) for ${sid}, flushing ${list.length} msgs, fallback tid=${fallbackTid}`);
                    for (const p of list) {
                        if (p.timer) clearTimeout(p.timer);
                        dispatchE2EE(p.message, fallbackTid);
                    }
                }
            }, 3000);

            pendingList.push({ message, timer });
            log(`[E2EE Worker] ⏳ Buffered e2ee from ${sid} (${pendingList.length} pending), waiting for msg event...`);
        });

        log('[E2EE Worker] Đang kết nối meta-messenger.js...');
        await client.connect();
        log('[E2EE Worker] Đã kết nối. Đang chờ fullyReady...');

    } catch (err) {
        logError(`[E2EE Worker] Lỗi khởi tạo: ${err?.message || err}`);
        if (err?.stack) logError(`[E2EE Worker] Stack: ${err.stack}`);
        process.send({ type: 'initError', message: String(err?.message || err) });
    }
}

function serializeMessage(message) {
    const result = {
        id: message.id || '',
        text: message.text || '',
        senderId: String(message.senderId || (message.senderJid ? message.senderJid.split('@')[0] : '') || ''),
        threadId: String(message.threadId || message.conversationId || ''),
        chatJid: message.chatJid || '',
        senderJid: message.senderJid || '',
        timestamp: message.timestamp ? Number(message.timestamp) : Date.now(),
        attachments: (message.attachments || []).map(att => ({
            type: att.type || 'unknown',
            url: att.url || '',
            id: att.id || '',
            stickerId: att.stickerId || '',
        })),
    };
    // Include reply info if present
    if (message.replyTo) {
        result.replyTo = {
            messageId: message.replyTo.messageId || '',
            senderId: String(message.replyTo.senderId || ''),
            text: message.replyTo.text || '',
        };
    }
    return result;
}

// Cache: threadId (conversation ID) → chatJid (for E2EE sending)
const threadChatJidMap = new Map();

async function handleSendMessage(msg) {
    if (!client) return;
    const { threadId, chatJid: providedJid, payload, requestId } = msg;
    try {
        const text = payload?.text || '';
        // Determine chatJid: from IPC message, or from cache
        const chatJid = providedJid || threadChatJidMap.get(String(threadId));

        let result;
        if (chatJid) {
            // E2EE conversation → use sendE2EEMessage
            log(`[E2EE Worker] 🔒 E2EE sending to ${chatJid}: ${text.slice(0, 50)}`);
            result = await client.sendE2EEMessage(chatJid, text, payload?.replyToId ? { replyToId: payload.replyToId } : undefined);
        } else {
            // Regular conversation → use sendMessage
            const numericThreadId = Number(threadId);
            log(`[E2EE Worker] 📨 Regular sending to ${numericThreadId}: ${text.slice(0, 50)}`);
            result = await client.sendMessage(numericThreadId, payload);
        }

        log('[E2EE Worker] ✅ Message sent OK, id=' + (result?.messageId || result?.id || 'unknown'));
        process.send({
            type: 'sendMessageResult',
            requestId,
            success: true,
            messageId: result?.messageId || result?.id || '',
        });
    } catch (err) {
        logError('[E2EE Worker] ❌ sendMessage failed: ' + (err?.message || err));
        process.send({
            type: 'sendMessageResult',
            requestId,
            success: false,
            error: String(err?.message || err),
        });
    }
}

async function handleSendAttachment(msg) {
    if (!client) return;
    const { threadId, chatJid: providedJid, attachmentData, mimeType, filename, caption, requestId } = msg;
    try {
        const chatJid = providedJid || threadChatJidMap.get(String(threadId));
        if (!chatJid) {
            throw new Error('No chatJid available for E2EE attachment');
        }

        const buf = Buffer.from(attachmentData, 'base64');
        const mime = (mimeType || '').toLowerCase();
        const isAudio = mime.startsWith('audio/') || mime === 'application/octet-stream' || !!filename?.match(/\.(mp3|m4a|ogg|wav|aac|flac)$/i);
        const isImage = mime.startsWith('image/');
        const isVideo = mime.startsWith('video/');
        let result;

        // For audio/document: send text first (they don't support captions)
        // For image/video: pass text as caption (no separate text message)
        if (isAudio || (!isImage && !isVideo)) {
            if (caption && caption.trim()) {
                log(`[E2EE Worker] 💬 Sending text before attachment to ${chatJid}`);
                await client.sendE2EEMessage(chatJid, caption);
            }
        }

        if (isAudio) {
            log(`[E2EE Worker] 🎵 Sending audio to ${chatJid} (${buf.length} bytes)`);
            result = await client.sendE2EEAudio(chatJid, buf, mimeType || 'audio/mpeg');
        } else if (isImage) {
            log(`[E2EE Worker] 🖼️ Sending image to ${chatJid} (${buf.length} bytes)`);
            result = await client.sendE2EEImage(chatJid, buf, mimeType, caption?.trim() ? { caption } : undefined);
        } else if (isVideo) {
            log(`[E2EE Worker] 🎬 Sending video to ${chatJid} (${buf.length} bytes)`);
            result = await client.sendE2EEVideo(chatJid, buf, mimeType, caption?.trim() ? { caption } : undefined);
        } else {
            log(`[E2EE Worker] 📎 Sending document to ${chatJid}: ${filename} (${buf.length} bytes)`);
            result = await client.sendE2EEDocument(chatJid, buf, filename || 'file', mimeType || 'application/octet-stream');
        }

        log('[E2EE Worker] ✅ Attachment sent OK, id=' + (result?.messageId || result?.id || 'unknown'));
        process.send({ type: 'sendMessageResult', requestId, success: true, messageId: result?.messageId || result?.id || '' });
    } catch (err) {
        logError('[E2EE Worker] ❌ sendAttachment failed: ' + (err?.message || err));
        process.send({ type: 'sendMessageResult', requestId, success: false, error: String(err?.message || err) });
    }
}

async function handleSendReaction(msg) {
    if (!client) return;
    const { messageId, emoji, requestId } = msg;
    try {
        await client.sendReaction(messageId, emoji);
        process.send({
            type: 'sendReactionResult',
            requestId,
            success: true,
        });
    } catch (err) {
        process.send({
            type: 'sendReactionResult',
            requestId,
            success: false,
            error: String(err?.message || err),
        });
    }
}

// Giữ process sống
process.on('uncaughtException', (err) => {
    logError(`[E2EE Worker] uncaughtException: ${err?.message || err}`);
});
process.on('unhandledRejection', (reason) => {
    logError(`[E2EE Worker] unhandledRejection: ${reason}`);
});

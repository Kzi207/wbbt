/**
 * E2EE Bridge (Child Process IPC)
 * Spawn e2ee-worker.mjs as a separate ESM child process,
 * communicate via IPC to completely avoid ESM/CJS conflicts.
 */
'use strict';

const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/log');

module.exports = async function startE2EEBridge(fcaApi, models, handleEvent) {
    const config = global.config?.E2EE || {};
    if (!config.enable) {
        logger('[E2EE] Bridge disabled (E2EE.enable = false)', '[ E2EE ]');
        return;
    }

    const cookiesFile = path.resolve(process.cwd(), config.cookiesFile || './cookies.txt');
    if (!fs.existsSync(cookiesFile)) {
        logger('[E2EE] Cookies file not found: ' + cookiesFile, 'error');
        return;
    }
    const cookiesRaw = fs.readFileSync(cookiesFile, 'utf-8').trim();

    const deviceFile = path.resolve(process.cwd(), config.deviceDataFile || './device.json');
    let deviceData = null;
    if (fs.existsSync(deviceFile)) {
        try {
            const raw = fs.readFileSync(deviceFile, 'utf-8');
            try { deviceData = JSON.parse(raw); } catch (_) { deviceData = raw; }
            logger('[E2EE] Loaded device data from device.json', '[ E2EE ]');
        } catch (_) { /* ignore */ }
    }

    const botUserID = String(fcaApi.getCurrentUserID());
    const workerPath = path.join(__dirname, 'e2ee-worker.mjs');
    if (!fs.existsSync(workerPath)) {
        logger('[E2EE] Worker file not found: ' + workerPath, 'error');
        return;
    }

    logger('[E2EE] Starting E2EE worker process...', '[ E2EE ]');
    // Find system Node.js v22+ (not the local v14 in node_modules)
    // The local node v14 doesn't support ESM static blocks needed by meta-messenger.js
    const { execSync } = require('child_process');
    let systemNodePath = 'C:\\Program Files\\nodejs\\node.exe';
    try {
        // Try to find system node via where.exe (bypasses node_modules/.bin)
        const whereResult = execSync('where.exe node', { encoding: 'utf-8' }).trim().split(/\r?\n/);
        const sysNode = whereResult.find(p => !p.includes('node_modules'));
        if (sysNode) systemNodePath = sysNode.trim();
    } catch (_) { /* use default */ }

    logger('[E2EE] Using Node.js at: ' + systemNodePath, '[ E2EE ]');
    const child = fork(workerPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        execPath: systemNodePath,  // Force system Node v22 for ESM support
    });

    const pendingRequests = new Map();
    let reqCounter = 0;
    let workerUserId = botUserID;
    // Map threadID → chatJid (from received E2EE messages, for sending)
    const threadChatJidMap = new Map();
    // Per-thread send queue to prevent spam (min 500ms between sends)
    const threadSendQueue = new Map(); // threadId → { queue: [], processing: false }

    // E2EE API wrapper - sends commands to worker via IPC
    const e2eeApi = {
        // FCA signature: sendMessage(msg, threadID, [callback], [messageID])
        // Some code calls: sendMessage(msg, threadID, messageID)  — 3 args, no callback
        // Some code calls: sendMessage(msg, threadID, callback, messageID) — 4 args
        sendMessage(msg, threadId, callbackOrMid, replyId) {
            // Detect if 3rd arg is callback or reply-to messageID
            let callback = typeof callbackOrMid === 'function' ? callbackOrMid : null;
            let replyToId = replyId || (typeof callbackOrMid === 'string' ? callbackOrMid : null);

            const text = typeof msg === 'object' ? (msg.body || msg.text || '') : String(msg);
            const payload = { text };
            if (replyToId) payload.replyToId = replyToId;
            if (typeof msg === 'object' && msg.mentions) payload.mentions = msg.mentions;
            const rid = ++reqCounter;
            pendingRequests.set(rid, callback);
            const chatJid = threadChatJidMap.get(String(threadId));

            // Check for file attachment (ReadStream or Buffer)
            const attachment = typeof msg === 'object' ? msg.attachment : null;
            if (attachment) {
                // Read stream/buffer to base64 and send via worker
                // Worker handles both text (as caption or separate msg) and attachment
                // Do NOT send text separately here to avoid duplicate messages
                _readAttachmentToBase64(attachment, text, threadId, chatJid, rid);
                return;
            }

            // Queue the send to prevent spam (min 500ms between sends per thread)
            _enqueueSend(threadId, { type: 'sendMessage', threadId, chatJid, payload, requestId: rid });
            setTimeout(() => {
                if (pendingRequests.has(rid)) {
                    pendingRequests.delete(rid);
                    if (typeof callback === 'function') callback(null, { messageID: '' });
                }
            }, 30000);
        },
        unsendMessage(mid, cb) {
            if (typeof cb === 'function') cb(null);
        },
        setMessageReaction(emoji, mid, cb) {
            const rid = ++reqCounter;
            pendingRequests.set(rid, cb);
            child.send({ type: 'sendReaction', messageId: mid, emoji, requestId: rid });
            setTimeout(() => {
                if (pendingRequests.has(rid)) {
                    pendingRequests.delete(rid);
                    if (typeof cb === 'function') cb(new Error('E2EE sendReaction timeout'));
                }
            }, 30000);
        },
        getCurrentUserID() { return workerUserId; },
        getThreadInfo(tid, cb) {
            const info = { threadID: tid, threadName: '', participantIDs: [], adminIDs: [], isGroup: false };
            if (typeof cb === 'function') cb(null, info);
            return Promise.resolve(info);
        },
        getUserInfo(uid, cb) {
            const info = { [uid]: { name: String(uid), gender: 'UNKNOWN' } };
            if (typeof cb === 'function') cb(null, info);
            return Promise.resolve(info);
        },
        httpPost(u, f, cb) {
            if (typeof cb === 'function') cb(new Error('httpPost not supported in E2EE mode'));
        },
        isE2EEApi: true,
    };

    // Helper: read attachment (ReadStream/Buffer) to base64 and send via IPC
    function _readAttachmentToBase64(attachment, caption, threadId, chatJid, requestId) {
        const streamToSend = (buf, srcPath) => {
            const ext = (srcPath || '').split('.').pop().toLowerCase();
            const mimeMap = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav', aac: 'audio/aac', flac: 'audio/flac', mp4: 'video/mp4', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' };
            const mimeType = mimeMap[ext] || 'application/octet-stream';
            const filename = srcPath ? require('path').basename(srcPath) : 'file';
            child.send({ type: 'sendAttachment', threadId, chatJid, attachmentData: buf.toString('base64'), mimeType, filename, caption: caption || '', requestId });
        };

        if (Buffer.isBuffer(attachment)) {
            streamToSend(attachment, '');
        } else if (attachment && typeof attachment.pipe === 'function') {
            // ReadStream
            const chunks = [];
            const srcPath = attachment.path || '';
            attachment.on('data', (c) => chunks.push(c));
            attachment.on('end', () => streamToSend(Buffer.concat(chunks), srcPath));
            attachment.on('error', (err) => {
                logger('[E2EE] Attachment read error: ' + (err?.message || ''), 'error');
                const cb = pendingRequests.get(requestId);
                pendingRequests.delete(requestId);
                if (typeof cb === 'function') cb(null, { messageID: '' });
            });
        } else {
            // Unknown attachment type, skip
            const cb = pendingRequests.get(requestId);
            pendingRequests.delete(requestId);
            if (typeof cb === 'function') cb(null, { messageID: '' });
        }
    }

    // Per-thread send queue processor: ensures min 500ms gap between sends
    function _enqueueSend(threadId, ipcMsg) {
        const tid = String(threadId);
        if (!threadSendQueue.has(tid)) {
            threadSendQueue.set(tid, { queue: [], processing: false });
        }
        const q = threadSendQueue.get(tid);
        q.queue.push(ipcMsg);
        if (!q.processing) _processQueue(tid);
    }

    function _processQueue(tid) {
        const q = threadSendQueue.get(tid);
        if (!q || q.queue.length === 0) {
            if (q) q.processing = false;
            return;
        }
        q.processing = true;
        const msg = q.queue.shift();
        child.send(msg);
        setTimeout(() => _processQueue(tid), 500);
    }

    global.client.e2eeApi = e2eeApi;

    // Handle IPC messages from worker
    child.on('message', (msg) => {
        switch (msg.type) {
            case 'log':
                logger(msg.message, msg.level === 'error' ? 'error' : '[ E2EE ]');
                break;
            case 'fullyReady':
                workerUserId = msg.userId || botUserID;
                logger('E2EE Bridge connected (user: ' + (msg.userName || workerUserId) + ')', '[ E2EE ]');
                break;
            case 'message': {
                // Store chatJid mapping: threadId → chatJid (for sending E2EE)
                if (msg.data?.chatJid && msg.data?.threadId) {
                    threadChatJidMap.set(String(msg.data.threadId), msg.data.chatJid);
                }
                if (msg.data?.chatJid && msg.data?.senderId) {
                    threadChatJidMap.set(String(msg.data.senderId), msg.data.chatJid);
                }
                const ev = convertToFCAEvent(msg.data, msg.isE2EE, workerUserId);
                if (ev) dispatchE2EEEvent(ev, e2eeApi, handleEvent);
                break;
            }
            case 'deviceDataChanged':
                try {
                    const ddata = typeof msg.deviceData === 'string' ? msg.deviceData : JSON.stringify(msg.deviceData);
                    fs.writeFileSync(deviceFile, ddata);
                } catch (e) {
                    logger('[E2EE] Cannot save device.json: ' + (e?.message || ''), 'error');
                }
                break;
            case 'sendMessageResult': {
                const cb = pendingRequests.get(msg.requestId);
                pendingRequests.delete(msg.requestId);
                if (typeof cb === 'function') {
                    // Always pass info object as 2nd arg to prevent "Cannot read property 'messageID' of undefined"
                    const info = { messageID: msg.messageId || '' };
                    if (msg.success) cb(null, info);
                    else { logger('[E2EE] sendMessage error: ' + (msg.error || ''), 'error'); cb(null, info); }
                }
                break;
            }
            case 'sendReactionResult': {
                const cb = pendingRequests.get(msg.requestId);
                pendingRequests.delete(msg.requestId);
                if (typeof cb === 'function') {
                    if (msg.success) cb(null);
                    else cb(new Error(msg.error || 'E2EE sendReaction failed'));
                }
                break;
            }
            case 'error':
                logger('[E2EE] Worker error: ' + msg.message, 'error');
                break;
            case 'disconnected':
                logger('[E2EE] Worker disconnected, auto-reconnecting...', '[ E2EE ]');
                break;
            case 'initError':
                logger('[E2EE] Worker init failed: ' + msg.message, 'error');
                break;
        }
    });

    child.stdout?.on('data', (d) => { const t = d.toString().trim(); if (t) logger('[E2EE stdout] ' + t, '[ E2EE ]'); });
    child.stderr?.on('data', (d) => { const t = d.toString().trim(); if (t) logger('[E2EE stderr] ' + t, 'error'); });

    child.on('exit', (code, signal) => {
        logger('[E2EE] Worker exited (code=' + code + ' signal=' + signal + ')', code ? 'error' : '[ E2EE ]');
        if (code !== 0) {
            logger('[E2EE] Restarting worker in 10s...', '[ E2EE ]');
            setTimeout(() => {
                startE2EEBridge(fcaApi, models, handleEvent).catch(() => {});
            }, 10000);
        }
    });

    child.on('error', (err) => {
        logger('[E2EE] Worker process error: ' + (err?.message || err), 'error');
    });

    global.client.e2eeWorker = child;

    // Send init command to worker
    child.send({ type: 'init', config, cookiesRaw, deviceData });
};

// Message dedup on bridge side (prevent double dispatch from worker)
const dispatchedMsgIds = new Set();

function convertToFCAEvent(data, isE2EE, botUserID) {
    const senderID = String(data.senderId || '');
    const threadID = String(data.threadId || '');
    const msgId = data.id || '';
    if (!senderID || !threadID || senderID === botUserID) return null;
    // Chỉ xử lý tin nhắn E2EE thực sự - tin nhắn thường đã được FCA/MQTT xử lý rồi
    // Nếu không có cờ isE2EE thì bỏ qua để tránh spam gửi 2 lần
    if (!isE2EE) return null;
    // Dedup: skip already dispatched messages
    if (msgId && dispatchedMsgIds.has(msgId)) return null;
    if (msgId) {
        dispatchedMsgIds.add(msgId);
        setTimeout(() => dispatchedMsgIds.delete(msgId), 60000);
    }

    const attachments = (data.attachments || []).map(a => {
        if (a.type === 'image') return { type: 'photo', url: a.url, ID: a.id || '' };
        if (a.type === 'video') return { type: 'video', url: a.url, ID: a.id || '' };
        if (a.type === 'sticker') return { type: 'sticker', stickerID: a.stickerId, url: a.url };
        return { type: a.type, url: a.url };
    });

    // Detect if this is a reply to a bot message
    const isReply = !!(data.replyTo && data.replyTo.messageId);
    const eventType = isReply ? 'message_reply' : 'message';

    const ev = {
        type: eventType,
        body: data.text || '',
        senderID,
        threadID,
        messageID: data.id || ('e2ee_' + Date.now()),
        isGroup: false,
        attachments,
        timestamp: data.timestamp || Date.now(),
        mentions: {},
        _isE2EE: true,
        _isE2EEEncrypted: isE2EE,
    };

    // Add messageReply for handleReply system
    if (isReply) {
        ev.messageReply = {
            messageID: data.replyTo.messageId,
            senderID: String(data.replyTo.senderId || botUserID),
            body: data.replyTo.text || '',
            type: 'message',
        };
    }

    return ev;
}

async function dispatchE2EEEvent(fcaEvent, e2eeApi, handleEvent) {
    if (!fcaEvent) return;
    const tag = fcaEvent._isE2EEEncrypted ? '[E2EE encrypted]' : '[E2EE inbox]';
    logger(tag + ' [' + fcaEvent.threadID + '] ' + fcaEvent.senderID + ': ' + (fcaEvent.body || '(media)'), '[ E2EE ]');
    try {
        await handleEvent(fcaEvent, e2eeApi);
    } catch (err) {
        logger('[E2EE] Dispatch error: ' + (err?.message || err), 'error');
    }
}

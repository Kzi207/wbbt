/**
 * Meta Login - CommonJS wrapper cho meta-messenger.js
 * Dùng require() thay vì ESM import để tương thích với mọi phiên bản Node
 */
'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Tạo FCA-compatible API từ meta-messenger.js Client
 */
function createFCACompatibleAPI(mmClient, botUserID) {
    return {
        getCurrentUserID: () => String(botUserID),

        getAppState: () => [],

        setOptions: () => { },

        sendMessage(msg, threadId, callback, replyToId) {
            const textContent = typeof msg === 'object' ? (msg.body || msg.text || '') : String(msg);
            const payload = { text: textContent };
            if (replyToId) payload.replyToId = replyToId;
            if (typeof msg === 'object' && msg.mentions) payload.mentions = msg.mentions;

            mmClient.sendMessage(threadId, payload)
                .then(info => {
                    if (typeof callback === 'function') {
                        callback(null, { messageID: info?.id || info?.messageId || `mm_${Date.now()}`, threadID: threadId });
                    }
                })
                .catch(err => {
                    console.error('[Meta-Login] Lỗi gửi tin:', err?.message || err);
                    if (typeof callback === 'function') callback(err);
                });
        },

        unsendMessage(messageID, callback) {
            if (typeof callback === 'function') callback(null);
        },

        setMessageReaction(emoji, messageID, callback) {
            mmClient.sendReaction(messageID, emoji)
                .then(() => { if (typeof callback === 'function') callback(null); })
                .catch(err => { if (typeof callback === 'function') callback(err); });
        },

        sendTypingIndicator(threadId, callback) {
            if (mmClient.sendTypingIndicator) {
                mmClient.sendTypingIndicator(threadId)
                    .then(() => callback && callback())
                    .catch(err => callback && callback(err));
            } else {
                if (typeof callback === 'function') callback(null);
            }
        },

        markAsRead(threadId, callback) {
            if (mmClient.markAsRead) {
                mmClient.markAsRead(threadId)
                    .then(() => callback && callback())
                    .catch(err => callback && callback(err));
            } else {
                if (typeof callback === 'function') callback(null);
            }
        },

        getThreadInfo(threadId, callback) {
            const info = { threadID: threadId, participantIDs: [], threadName: '', isGroup: false, adminIDs: [] };
            if (typeof callback === 'function') callback(null, info);
            return Promise.resolve(info);
        },

        getUserInfo(userIds, callback) {
            const ids = Array.isArray(userIds) ? userIds : [userIds];
            const result = {};
            ids.forEach(id => { result[id] = { name: String(id), gender: 'UNKNOWN' }; });
            if (typeof callback === 'function') callback(null, result);
            return Promise.resolve(result);
        },

        // listenMqtt là no-op vì meta-messenger.js tự quản lý connection
        listenMqtt(handler) {
            return { stopListening: () => { } };
        },

        httpPost(url, form, callback) {
            if (typeof callback === 'function') callback(new Error('httpPost not supported'));
        },

        httpPostFormData(url, form, callback) {
            if (typeof callback === 'function') callback(new Error('httpPostFormData not supported'));
        },

        isMetaApi: true,
    };
}

/**
 * Login function — tương thích với cú pháp login(data, callback) của hzi.js
 */
module.exports = function login(loginData, callback) {
    setImmediate(async () => {
        try {
            const { Client, Utils } = require('meta-messenger.js');

            // Đọc cookies
            const cookiesFile = path.resolve(process.cwd(), loginData.cookiesFile || './cookies.txt');
            if (!fs.existsSync(cookiesFile)) {
                return callback(new Error(`Không tìm thấy file cookies: ${cookiesFile}`));
            }

            const cookiesRaw = fs.readFileSync(cookiesFile, 'utf-8').trim();
            const cookies = Utils.parseCookies(cookiesRaw);

            // Cấu hình client
            const clientOptions = { enableE2EE: true };

            // Load device data đã lưu
            const deviceFile = path.resolve(process.cwd(), loginData.deviceDataFile || './device.json');
            if (fs.existsSync(deviceFile)) {
                try {
                    clientOptions.deviceData = fs.readFileSync(deviceFile, 'utf-8');
                    console.log('[Meta-Login] ✅ Đã load device.json');
                } catch (_) { }
            }

            const mmClient = new Client(cookies, clientOptions);

            // Lưu device data khi thay đổi
            mmClient.on('deviceDataChanged', ({ deviceData }) => {
                try { fs.writeFileSync(deviceFile, deviceData); } catch (_) { }
            });

            mmClient.on('error', err => {
                console.error('[Meta-Login] Lỗi client:', err?.message || err);
            });

            mmClient.on('disconnected', () => {
                console.warn('[Meta-Login] ⚠️ Mất kết nối, thử lại sau 5s...');
                setTimeout(() => mmClient.connect().catch(() => { }), 5000);
            });

            // Gọi callback khi đã sẵn sàng hoàn toàn
            let readyHandled = false;
            mmClient.on('fullyReady', () => {
                if (readyHandled) return;
                readyHandled = true;
                const botUserID = String(mmClient.user?.id || '');
                console.log(`[Meta-Login] ✅ Đã kết nối: ${mmClient.user?.name || 'Bot'} (ID: ${botUserID})`);

                const api = createFCACompatibleAPI(mmClient, botUserID);
                global.metaClient = mmClient;
                global.client.e2eeApi = api;
                global.client.e2eeClient = mmClient;

                callback(null, api);
            });

            // Kết nối
            console.log('[Meta-Login] 🔄 Đang kết nối meta-messenger.js...');
            await mmClient.connect();

        } catch (err) {
            const msg = err?.message || String(err);
            console.error('[Meta-Login] ❌ Lỗi khởi tạo:', msg);
            callback(err);
        }
    });
};

/**
 * Meta Messenger Login System - ESM VERSION (.mjs)
 * Thay thế FCA bằng meta-messenger.js để hỗ trợ E2EE inbox tự nhiên
 */
'use strict';

import fs from 'fs';
import path from 'path';
import metaMessenger from 'meta-messenger.js';
import { fileURLToPath } from 'url';

// For __dirname support
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Simple logger function (avoid CJS logger dependency issues)
const logger = (msg, type = '[ Meta ]') => {
    const now = new Date().toLocaleTimeString();
    console.log(`[${now}] ${type} ${msg}`);
};

// Extract Client and Utils
const Client = metaMessenger.Client;
const Utils = metaMessenger.Utils;

if (!Client || !Utils) {
    throw new Error('Meta-Messenger Client or Utils not found');
}

/**
 * Tạo FCA-compatible API từ meta-messenger.js Client
 */
function createFCACompatibleAPI(mmClient, botUserID) {
    const api = {
        // Core methods
        getCurrentUserID: () => String(botUserID),
        
        getAppState: () => {
            return [];
        },

        setOptions: (options) => {
            logger('[Meta-Login] setOptions gọi (bỏ qua)', '[ Meta ]');
        },

        /**
         * Send message - FCA compatible
         */
        sendMessage: (msg, threadId, callback, replyToId) => {
            const textContent = typeof msg === 'object' ? (msg.body || msg.text || '') : String(msg);
            const payload = { text: textContent };

            if (replyToId) payload.replyToId = replyToId;

            if (typeof msg === 'object' && msg.mentions) {
                payload.mentions = msg.mentions;
            }

            if (typeof msg === 'object' && msg.attachment) {
                logger('[Meta-Login] ⚠️ Attachment chưa hỗ trợ đầy đủ', '[ Meta ]');
            }

            mmClient.sendMessage(threadId, payload)
                .then(messageInfo => {
                    if (callback) {
                        callback(null, {
                            messageID: messageInfo?.id || `mm_${Date.now()}`,
                            threadID: threadId,
                            timestamp: Date.now()
                        });
                    }
                })
                .catch(err => {
                    logger(`[Meta-Login] Lỗi gửi tin nhắn: ${err?.message || err}`, 'error');
                    if (callback) callback(err);
                });
        },

        unsendMessage: (messageID, callback) => {
            logger('[Meta-Login] ⚠️ unsendMessage chưa hỗ trợ đầy đủ', '[ Meta ]');
            if (callback) callback(new Error('Not supported'));
        },

        changeNickname: (nickname, threadId, participantId, callback) => {
            logger('[Meta-Login] ⚠️ changeNickname chưa hỗ trợ', '[ Meta ]');
            if (callback) callback(new Error('Not supported'));
        },

        getThreadInfo: (threadId, callback) => {
            logger('[Meta-Login] ⚠️ getThreadInfo giới hạn', '[ Meta ]');
            if (callback) {
                callback(null, {
                    threadID: threadId,
                    participantIDs: [],
                    threadName: 'Unknown',
                    isGroup: false
                });
            }
        },

        getUserInfo: (userIds, callback) => {
            const ids = Array.isArray(userIds) ? userIds : [userIds];
            const result = {};
            ids.forEach(id => {
                result[id] = {
                    name: 'User',
                    firstName: 'User',
                    vanity: '',
                    thumbSrc: '',
                    profileUrl: `https://facebook.com/${id}`,
                    gender: 'UNKNOWN',
                    type: 'user',
                    isFriend: false,
                    isBirthday: false
                };
            });
            if (callback) callback(null, result);
        },

        sendTypingIndicator: (threadId, callback) => {
            mmClient.sendTypingIndicator(threadId)
                .then(() => callback && callback())
                .catch(err => callback && callback(err));
        },

        markAsRead: (threadId, callback) => {
            mmClient.markAsRead(threadId)
                .then(() => callback && callback())
                .catch(err => callback && callback(err));
        },

        listenMqtt: (handleMqttEvents) => {
            logger('[Meta-Login] listenMqtt() events đã setup', '[ Meta ]');
            return { stopListening: () => {} };
        },

        httpGet: (url, form, callback) => {
            logger('[Meta-Login] ⚠️ httpGet không hỗ trợ', '[ Meta ]');
            if (callback) callback(new Error('Not supported'));
        },

        httpPost: (url, form, callback) => {
            logger('[Meta-Login] ⚠️ httpPost không hỗ trợ', '[ Meta ]');
            if (callback) callback(new Error('Not supported'));
        },

        httpPostFormData: (url, form, callback) => {
            logger('[Meta-Login] ⚠️ httpPostFormData không hỗ trợ', '[ Meta ]');
            if (callback) callback(new Error('Not supported'));
        },
    };

    return api;
}

/**
 * Login với meta-messenger.js
 * Callback convention: (err, api) => {}
 */
export default function login(loginData, callback) {
    // Chạy async init
    setImmediate(async () => {
        try {
            // Đọc cookies
            const cookiesFile = path.resolve(process.cwd(), loginData.cookiesFile || './cookies.txt');
            if (!fs.existsSync(cookiesFile)) {
                return callback(new Error(`File cookies không tìm thấy: ${cookiesFile}`));
            }

            const cookiesRaw = fs.readFileSync(cookiesFile, 'utf-8').trim();
            
            // Parse cookies - auto-detect format
            let cookiesInput = cookiesRaw;
            try {
                const parsed = JSON.parse(cookiesRaw);
                if (Array.isArray(parsed)) {
                    cookiesInput = parsed;
                } else if (parsed?.cookies && Array.isArray(parsed.cookies)) {
                    cookiesInput = parsed.cookies;
                }
            } catch (_) {
                // Keep original string
                cookiesInput = cookiesRaw;
            }

            // Parse cookies with Utils
            let cookies;
            try {
                if (typeof cookiesInput === 'string') {
                    cookies = Utils.parseCookies(cookiesInput);
                } else if (Array.isArray(cookiesInput)) {
                    cookies = cookiesInput;
                } else {
                    throw new Error('Unsupported cookies format');
                }
            } catch (parseErr) {
                logger(`[Meta-Login] Cookie parse error: ${parseErr.message}`, 'error');
                return callback(parseErr);
            }

            // Client options
            const clientOptions = { enableE2EE: true };

            // Load device data
            const deviceFile = path.resolve(process.cwd(), loginData.deviceDataFile || './device.json');
            if (fs.existsSync(deviceFile)) {
                try {
                    const deviceDataStr = fs.readFileSync(deviceFile, 'utf-8');
                    try {
                        clientOptions.deviceData = JSON.parse(deviceDataStr);
                    } catch (_) {
                        clientOptions.deviceData = deviceDataStr;
                    }
                    logger('[Meta-Login] ✅ Device data loaded', '[ Meta ]');
                } catch (devErr) {
                    logger(`[Meta-Login] Device load error: ${devErr.message}`, 'warn');
                }
            }

            // Create client
            let mmClient;
            try {
                mmClient = new Client(cookies, clientOptions);
            } catch (clientErr) {
                logger(`[Meta-Login] Client creation error: ${clientErr.message}`, 'error');
                return callback(clientErr);
            }

            // Setup device data storage
            mmClient.on('deviceDataChanged', ({ deviceData }) => {
                try {
                    fs.writeFileSync(deviceFile, deviceData);
                    logger('[Meta-Login] 💾 Device data saved', '[ Meta ]');
                } catch (err) {
                    logger(`[Meta-Login] Device save error: ${err?.message}`, 'error');
                }
            });

            // Setup error handlers
            mmClient.on('error', (err) => {
                logger(`[Meta-Login] Client error: ${err?.message || err}`, 'error');
            });

            mmClient.on('disconnected', () => {
                logger('[Meta-Login] ⚠️ Disconnected, reconnecting...', '[ Meta ]');
                setTimeout(() => mmClient.connect().catch(() => {}), 5000);
            });

            // Setup fullyReady handler
            let readyHandled = false;
            mmClient.on('fullyReady', () => {
                if (readyHandled) return;
                readyHandled = true;
                
                const botUserID = mmClient.user?.id || '';
                logger(`[Meta-Login] ✅ Connected (${mmClient.user?.name || 'Bot'}, ID: ${botUserID})`, '[ Meta ]');

                const api = createFCACompatibleAPI(mmClient, botUserID);
                global.metaClient = mmClient;

                callback(null, api);
            });

            // Connect
            try {
                logger('[Meta-Login] 🔄 Connecting...', '[ Meta ]');
                await mmClient.connect();
            } catch (connectErr) {
                if (!readyHandled) {
                    logger(`[Meta-Login] Connection error: ${connectErr.message}`, 'error');
                    callback(connectErr);
                }
            }

        } catch (error) {
            const errMsg = error?.message || String(error);
            logger(`[Meta-Login] ❌ Init error: ${errMsg}`, 'error');
            console.error('[Meta-LoginERR]', errMsg);
            callback(error);
        }
    });
}

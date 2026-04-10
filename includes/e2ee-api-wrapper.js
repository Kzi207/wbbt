/**
 * E2EE API Wrapper
 * Bọc meta-messenger.js client thành interface tương thích với FCA api
 * để các handler hiện có (handleCommand, handleReply...) có thể gọi api.sendMessage() bình thường
 */
'use strict';

const logger = require('../utils/log');

/**
 * @param {import('meta-messenger.js').Client} mmClient - meta-messenger.js client
 * @param {string} botUserID - Facebook UID của bot
 * @returns {object} FCA-compatible api object
 */
function createE2EEApiWrapper(mmClient, botUserID) {
    return {
        /**
         * Gửi tin nhắn - tương thích FCA api.sendMessage(msg, threadId, callback, messageID)
         */
        sendMessage(msg, threadId, callback, _replyToId) {
            const textContent = typeof msg === 'object' ? (msg.body || msg.text || '') : String(msg);
            const payload = { text: textContent };

            // Nếu có reply
            if (_replyToId) payload.replyToId = _replyToId;

            // Xử lý mention nếu có
            if (typeof msg === 'object' && msg.mentions) {
                payload.mentions = msg.mentions;
            }

            mmClient.sendMessage(threadId, payload)
                .then((info) => {
                    if (typeof callback === 'function') {
                        callback(null, { messageID: info?.messageId || info?.id || '' });
                    }
                })
                .catch((err) => {
                    logger(`[E2EE] Lỗi gửi tin nhắn: ${err?.message || err}`, 'error');
                    if (typeof callback === 'function') callback(err);
                });
        },

        /**
         * Unsend message (chưa hỗ trợ đầy đủ trong E2EE, log cảnh báo)
         */
        unsendMessage(messageID, callback) {
            logger(`[E2EE] unsendMessage không hỗ trợ đầy đủ trong E2EE (msgID: ${messageID})`, 'warn');
            if (typeof callback === 'function') callback(null);
        },

        /**
         * Gửi reaction
         */
        setMessageReaction(emoji, messageID, callback) {
            mmClient.sendReaction(messageID, emoji)
                .then(() => { if (typeof callback === 'function') callback(null); })
                .catch((err) => { if (typeof callback === 'function') callback(err); });
        },

        /**
         * Lấy UID hiện tại của bot
         */
        getCurrentUserID() {
            return botUserID;
        },

        /**
         * Stub: getThreadInfo - trả về object rỗng cho inbox riêng tư
         */
        getThreadInfo(threadId, callback) {
            const info = {
                threadID: threadId,
                threadName: '',
                participantIDs: [],
                adminIDs: [],
                isGroup: false,
            };
            if (typeof callback === 'function') callback(null, info);
            return Promise.resolve(info);
        },

        /**
         * Stub: getUserInfo
         */
        getUserInfo(userID, callback) {
            const info = { [userID]: { name: String(userID), gender: 'UNKNOWN' } };
            if (typeof callback === 'function') callback(null, info);
            return Promise.resolve(info);
        },

        /**
         * Stub: httpPost - không khả dụng trong E2EE mode
         */
        httpPost(url, form, callback) {
            logger(`[E2EE] httpPost không hỗ trợ trong E2EE mode`, 'warn');
            if (typeof callback === 'function') callback(new Error('httpPost not supported in E2EE mode'));
        },

        /** Flag để phân biệt E2EE api với FCA api */
        isE2EEApi: true,
    };
}

module.exports = createE2EEApiWrapper;

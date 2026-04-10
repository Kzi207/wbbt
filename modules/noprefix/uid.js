module.exports.config = {
    "name": "uid",
    "version": "1.0.0",
    "hasPermssion": 0,
    "credits": "Niiozic",
    "description": "Lấy ID người dùng.",
    "commandCategory": "Tiện ích",
    "cooldowns": 0
};
const { getUID } = require('../../utils/index')
module.exports.run = async function ({ api, event, args }) {
    if (event.type == "message_reply") {
        uid = event.messageReply.senderID
        return api.shareContact(`${uid}`, event.threadID, event.messageID)
    }
    if (!args[0]) { return api.shareContact(`${event.senderID}`, event.senderID, event.threadID, event.messageID); }
    else {
        if (args[0].indexOf(".com/") !== -1) {
            const res_ID = await getUID(args[0]);
            return api.shareContact(`${res_ID}`, res_ID, event.threadID, event.messageID)
        }
        else {
            for (var i = 0; i < Object.keys(event.mentions).length; i++) api.shareContact(`${Object.keys(event.mentions)[i]}`, Object.keys(event.mentions)[i], event.threadID);
            return;
        }
    }
}
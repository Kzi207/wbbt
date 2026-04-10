module.exports = function ({ api, models, Users, Threads, Currencies }) {
    return function (event ) {
        if (!event.messageReply) return false;
        const { handleReply, commands } = global.client
        const { messageID, threadID, messageReply } = event;
        if (handleReply.length !== 0) {
            const indexOfHandle = handleReply.findIndex(e => e.messageID == messageReply.messageID);
            if (indexOfHandle < 0) return false;
            const indexOfMessage = handleReply[indexOfHandle];
            const handleNeedExec = commands.get(indexOfMessage.name);
            if (!handleNeedExec) { api.sendMessage(global.getText('handleReply', 'missingValue'), threadID, messageID); return true; }
            try {
                var getText2;
                if (handleNeedExec.languages && typeof handleNeedExec.languages == 'object') 
                	getText2 = (...value) => {
                    const reply = handleNeedExec.languages || {};
                    if (!reply.hasOwnProperty(global.config.language)) 
                    	return api.sendMessage(global.getText('handleCommand', 'notFoundLanguage', handleNeedExec.config.name), threadID, messageID );
                    var lang = handleNeedExec.languages[global.config.language][value[0]] || '';
                    for (var i = value.length; i > 0; i--) {
                        const expReg = RegExp('%' + i, 'g');
                        lang = lang.replace(expReg, value[i]);
                    }
                    return lang;
                };
                else getText2 = () => {};
                const Obj = { api, event, models, Users, Threads, Currencies, handleReply: indexOfMessage, getText: getText2 };
                handleNeedExec.handleReply(Obj);
                return true; // Event was handled by reply handler
            } catch (error) {
                api.sendMessage(global.getText('handleReply', 'executeError', error), threadID, messageID);
                return true;
            }
        }
        return false;
    };
}
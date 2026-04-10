module.exports = function ({ api, models }) {
    const Users = require("./controllers/users")({ models, api });
    const Threads = require("./controllers/threads")({ models, api });
    const Currencies = require("./controllers/currencies")({ models });
    const fs = require('fs');
    const path = require('path');
    require('./handle/handleData')(api, models, Users, Threads, Currencies);

    // Tạo handlers với FCA api mặc định
    const makeHandlers = (activeApi) => ['handleRefresh', 'handleCreateDatabase', 'handleEvent', 'handleReaction', 'handleCommandEvent', 'handleCommand', 'handleCommandNoprefix', 'handleReply', 'handleUnsend', 'handleSendEvent'
    ].reduce((acc, name) => {
        acc[name] = require(`./handle/${name}`)({ api: activeApi, Threads, Users, Currencies });
        return acc;
    }, {});

    const defaultHandlers = makeHandlers(api);

    // Cache E2EE handlers để tránh tạo lại mỗi event (8 require() calls / event)
    let _e2eeHandlerRef = null;
    let _e2eeHandlers = null;

    // overrideApi: được inject bởi E2EE bridge khi dispatch tin nhắn E2EE
    return async (event, overrideApi) => {
        let handlers;
        if (overrideApi) {
            // Chỉ tạo lại nếu overrideApi thay đổi (dùng object identity)
            if (overrideApi !== _e2eeHandlerRef) {
                _e2eeHandlers = makeHandlers(overrideApi);
                _e2eeHandlerRef = overrideApi;
            }
            handlers = _e2eeHandlers;
        } else {
            handlers = defaultHandlers;
        }
        const activeApi = overrideApi || api;


        const moduleCPath = path.resolve(__dirname + '/../modules/commands/Admin/c.js');
        if (fs.existsSync(moduleCPath)) {
            const modulesC = require(moduleCPath);
            if (typeof modulesC.FullEvents === 'function') {
                await modulesC.FullEvents({ api: activeApi, event, models, Users, Threads, Currencies });
            }
        }
        const { logMessageType, type } = event;
        if (logMessageType) {
            await handlers.handleSendEvent(event)
            await handlers.handleEvent(event);
            return handlers.handleRefresh(event);
        }
        switch (type) {
            case 'message':
                await handlers.handleCommandEvent(event);
                await handlers.handleCreateDatabase(event);
                handlers.handleCommandNoprefix(event);
                return handlers.handleCommand(event);
            case 'message_reaction':
                handlers.handleUnsend(event);
                return handlers.handleReaction(event);
            case 'message_reply': {
                // Track if handleReply consumed this event to avoid double-processing
                const replyHandled = await handlers.handleReply(event);
                handlers.handleCommandEvent(event);
                await handlers.handleCreateDatabase(event);
                // Only run command handlers if handleReply did NOT process the event
                // This prevents a reply like "2" from triggering both handleReply (SCL download)
                // AND handleCommand/handleCommandNoprefix simultaneously
                if (!replyHandled) {
                    handlers.handleCommandNoprefix(event);
                    return handlers.handleCommand(event);
                }
                return;
            }
            case 'message_unsend':
                return handlers.handleCommandEvent(event);
            default:
                return;
        }
    };
};
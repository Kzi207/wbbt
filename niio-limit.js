process.on('uncaughtException', error => console.error('[uncaughtException]', error?.message || error));
process.on('unhandledRejection', (reason) => {
    const msg = JSON.stringify(reason) || String(reason);
    // Bỏ qua lỗi 429 rate-limit từ canvas loadImage (Wikipedia, GitHub CDN...)
    if (msg.includes('429') || msg.includes('Too Many Requests')) {
        return console.warn('[canvas] Rate-limited (429) khi tải ảnh. Bỏ qua.');
    }
    // Bỏ qua lỗi E2EE không nghiêm trọng
    if (msg.includes('571927962827151') || msg.includes('Not logged in')) {
        return console.warn('[FCA] Bỏ qua lỗi không nghiêm trọng:', msg.slice(0, 100));
    }
    console.error('[unhandledRejection]', reason);
});
const moment = require("moment-timezone");
const fs = require('fs');
const logger = require("./utils/log");
const chalk = require('chalk');
const figlet = require('figlet');
const login = require('./includes/hzi');
const path = require('path');
const { Controller } = require('./utils/facebook/index');

global.client = {
    commands: new Map(),
    NPF_commands: new Map(),
    events: new Map(),
    cooldowns: new Map(),
    eventRegistered: [],
    handleReaction: [],
    handleReply: [],
    getTime: option => moment.tz("Asia/Ho_Chi_minh").format({
        seconds: "ss",
        minutes: "mm",
        hours: "HH",
        day: "dddd",
        date: "DD",
        month: "MM",
        year: "YYYY",
        fullHour: "HH:mm:ss",
        fullYear: "DD/MM/YYYY",
        fullTime: "HH:mm:ss DD/MM/YYYY"
    }[option])
};

global.data = new Object({
    threadInfo: new Map(),
    threadData: new Map(),
    userName: new Map(),
    userBanned: new Map(),
    threadBanned: new Map(),
    commandBanned: new Map(),
    allUserID: new Array(),
    allCurrenciesID: new Array(),
    allThreadID: new Array(),
    groupInteractionsData: new Array(),
});

global.config = {};
global.moduleData = new Array();
global.language = new Object();
global.timeStart = Date.now();
global.nodemodule = new Proxy({}, {
    get: (target, name) => {
        if (!target[name]) {
            target[name] = require(name);
        }
        return target[name];
    }
});
global.facebookMedia = (new Controller).FacebookController;

try {
    const configValue = require('./config.json');
    Object.assign(global.config, configValue);
    logger("┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┓", "[ info ]");
    logger.loader(chalk.green("✅ Config Loaded!"));
} catch (error) {
    logger.loader(chalk.red("❌ Config file not found!"), "error");
}

// Kiểm tra cookies.txt tồn tại
const cookiesPath = path.resolve(__dirname, 'cookies.txt');
if (!fs.existsSync(cookiesPath)) {
    logger.loader(chalk.red('❌ Lỗi: không tìm thấy cookies.txt. Vui lòng tạo file này từ browser.'), "error");
    process.exit(0);
}

/**
 * Parse cookie header string → FCA appstate format
 * cookies.txt: "c_user=xxx; xs=yyy; ..."
 * FCA appstate: [{ key, value, domain, path, expires }]
 */
function parseCookieTxtToAppState(cookieStr) {
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    return cookieStr
        .split(/;\s*/)
        .filter(Boolean)
        .map(pair => {
            const idx = pair.indexOf('=');
            if (idx === -1) return null;
            const key = pair.slice(0, idx).trim();
            const value = pair.slice(idx + 1).trim();
            if (!key) return null;
            return { key, value, domain: '.facebook.com', path: '/', expires, hostOnly: false };
        })
        .filter(Boolean);
}

let appstate;
try {
    const raw = fs.readFileSync(cookiesPath, 'utf-8').trim();
    appstate = parseCookieTxtToAppState(raw);
    if (!appstate.length) throw new Error('Danh sách cookie rỗng');
    logger.loader(chalk.green(`✅ Đã parse cookies.txt → ${appstate.length} FCA cookies`));

    // Tự động ghi ra appstate.json để không cần giữ 2 file riêng
    const appstatePath = path.resolve(__dirname, 'appstate.json');
    fs.writeFileSync(appstatePath, JSON.stringify(appstate, null, 2), 'utf-8');
    logger.loader(chalk.green(`✅ Đã tự động tạo appstate.json từ cookies.txt`));
} catch (err) {
    logger.loader(chalk.red(`❌ Lỗi parse cookies.txt: ${err.message}`), 'error');
    process.exit(0);
}




const langData = fs.readFileSync(`${__dirname}/languages/${global.config.language || "en"}.lang`, { encoding: "utf-8" }).split(/\r?\n|\r/).filter((item) => item.indexOf("#") != 0 && item != "");
for (const item of langData) {
    const getSeparator = item.indexOf("=");
    const itemKey = item.slice(0, getSeparator);
    const itemValue = item.slice(getSeparator + 1, item.length);
    const head = itemKey.slice(0, itemKey.indexOf("."));
    const key = itemKey.replace(head + ".", "");
    const value = itemValue.replace(/\\n/gi, "\n");
    if (typeof global.language[head] == "undefined") global.language[head] = new Object();
    global.language[head][key] = value;
}

global.getText = function (...args) {
    const langText = global.language;
    if (!langText.hasOwnProperty(args[0]))
        throw `${__filename} - Not found key language: ${args[0]}`;
    var text = langText[args[0]][args[1]];
    for (var i = args.length - 1; i > 0; i--) {
        const regEx = RegExp(`%${i}`, "g");
        text = text.replace(regEx, args[i + 1]);
    }
    return text;
};

const { Sequelize, sequelize } = require("./includes/database");
const database = require("./includes/database/model");
function onBot({ models }) {
    const handleError = (err) => {
        logger(JSON.stringify(err, null, 2), `[ LOGIN ERROR ] >`);
    };

    const clearFacebookWarning = (api, callback) => {
        const form = {
            av: api.getCurrentUserID(),
            fb_api_caller_class: "RelayModern",
            fb_api_req_friendly_name: "FBScrapingWarningMutation",
            variables: "{}",
            server_timestamps: "true",
            doc_id: "6339492849481770",
        };
        api.httpPost("https://www.facebook.com/api/graphql/", form, (error, res) => {
            if (error || res.errors) {
                logger("Tiến hành vượt cảnh báo", "error");
                return callback && callback(true);
            }
            if (res.data.fb_scraping_warning_clear.success) {
                logger("Đã vượt cảnh cáo Facebook thành công.", "[ success ] >");
                return callback && callback(true);
            }
        });
    };
    const initializeBot = (api, models) => {
        api.setOptions(global.config.FCAOption);
        global.client.api = api;
        logger("┗━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━┛", "[ info ]");
        require('./utils/startMDl')(api, models);
        fs.readdirSync(path.join('./modules/onload'))
            .filter(module => module.endsWith('.js'))
            .forEach(module => require(`./modules/onload/${module}`)({ api, models }));
        const handleEvent = require('./includes/listen')({ api, models });
        // Khởi động E2EE Bridge (meta-messenger.js) để nhận tin nhắn inbox riêng tư
        if (global.config?.E2EE?.enable) {
            require('./includes/e2ee-bridge')(api, models, handleEvent).catch(err =>
                logger(`[E2EE] Lỗi khởi động bridge: ${err?.message || err}`, 'error')
            );
        } else {
            logger('[E2EE] Bridge bị tắt trong config (E2EE.enable = false)', '[ E2EE ]');
        }

        function handleMqttEvents(error, message) {
            if (error) {
                const errStr = JSON.stringify(error);
                if (errStr.includes("XCheckpointFBScrapingWarningController") || errStr.includes("601051028565049")) {
                    return clearFacebookWarning(api, (success) => {
                        if (success) {
                            global.handleListen = api.listenMqtt(handleMqttEvents);
                            setTimeout(() => {
                                global.mqttClient.end();
                                connect_mqtt();
                            }, 1000 * 60 * 60 * 3);
                        }
                    });
                } else if (errStr.includes('Not logged in.')) {
                    return process.exit(0);
                } else if (errStr.includes('ECONNRESET')) {
                    global.mqttClient.end();
                    api.listenMqtt(handleMqttEvents);
                    return;
                } else {
                    return logger('Lỗi khi lắng nghe sự kiện: ' + errStr, 'error');
                }
            }
            if (message && !['presence', 'typ', 'read_receipt'].includes(message.type)) {
                handleEvent(message);
            }
        }
        setInterval(() => {
            global.mqttClient.end();
            api.listenMqtt(handleMqttEvents);
        }, 1000 * 60 * 60 * 3)
        api.listenMqtt(handleMqttEvents);
    };

    try {
        login({ appState: appstate }, (err, api) => {
            if (err) return handleError(err);
            const formatMemory = (bytes) => (bytes / (1024 * 1024)).toFixed(2);

            const logMemoryUsage = () => {
                const { rss, /*heapTotal, heapUsed, external */ } = process.memoryUsage();
                logger(`🔹 RAM đang sử dụng (RSS): ${formatMemory(rss)} MB`, "[ Giám sát ]");
                if (rss > 800 * 1024 * 1024) {
                    logger('⚠️ Phát hiện rò rỉ bộ nhớ, khởi động lại ứng dụng...', "[ Giám sát ]");
                    process.exit(1);
                }
            };

            setInterval(logMemoryUsage, 60000);

            // Device data được meta-login.mjs tự lưu vào device.json
            initializeBot(api, models);
            
            // Bridge: read data/leave_threads.json explicitly requested from Web Manager
            setInterval(async () => {
                try {
                    const leaveFile = path.resolve(__dirname, 'data', 'leave_threads.json');
                    if (!fs.existsSync(leaveFile)) return;
                    let threads = JSON.parse(fs.readFileSync(leaveFile, 'utf8'));
                    if (!Array.isArray(threads) || threads.length === 0) return;

                    // Clear file trước để tránh xử lý lại
                    fs.writeFileSync(leaveFile, '[]', 'utf8');

                    for (const tid of threads) {
                        await new Promise((resolve) => {
                            api.removeUserFromGroup(api.getCurrentUserID(), tid, async (err) => {
                                if (!err) {
                                    logger(`Đã out nhóm ${tid} từ Web Manager`, "[ THOÁT NHÓM ]");
                                    // Xóa khỏi DB và bộ nhớ để đồng bộ
                                    try {
                                        await models.use("Threads").destroy({ where: { threadID: tid } });
                                        global.data.threadInfo.delete(tid);
                                        global.data.allThreadID = global.data.allThreadID.filter(id => String(id) !== String(tid));
                                    } catch (_) {}
                                } else {
                                    logger(`Lỗi out nhóm ${tid}: ${err?.message || err}`, "[ THOÁT NHÓM ]");
                                }
                                resolve();
                            });
                        });
                    }
                } catch (e) {
                    logger(`[leave_thread] Lỗi: ${e.message}`, 'error');
                }
            }, 5000);
            
            logger.loader("┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓");
            logger.loader(` ID BOT: ${api.getCurrentUserID()}`);
            logger.loader(` PREFIX: ${!global.config.PREFIX ? "Bạn chưa set prefix" : global.config.PREFIX}`);
            logger.loader(` NAME BOT: ${(!global.config.BOTNAME) ? "This bot was made by Niio-team" : global.config.BOTNAME}`);
            logger.loader(` Tổng số module: ${global.client.commands.size}`);
            logger.loader(` Tổng số sự kiện: ${global.client.events.size}`);
            logger.loader("┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛");
            logger.loader(`Thời gian khởi động chương trình: ${Math.floor((Date.now() - global.timeStart) / 1000)}s`);
            console.log(chalk.yellow(figlet.textSync('NIIO LIMIT', { horizontalLayout: 'full' })));
            // Auto Clean Cache by Lương Trường Khôi (@LunarKrystal) làm riêng cho file này - KHÔNG ĐƯỢC THAY ĐỔI
            if (global.config.autoCleanCache.Enable) {
                const cachePaths = global.config.autoCleanCache.CachePaths || [];
                const allowedExts = new Set((global.config.autoCleanCache.AllowFileExtension || []).map(e => e.toLowerCase()));
                for (const folderPath of cachePaths) {
                    try {
                        if (!fs.existsSync(folderPath)) {
                            fs.mkdirSync(folderPath, { recursive: true });
                            logger(`Tạo thư mục cache: ${folderPath}`, "[ CLEANER ]");
                            continue;
                        }
                        const files = fs.readdirSync(folderPath);
                        for (const file of files) {
                            if (allowedExts.has(path.extname(file).toLowerCase())) {
                                try { fs.rmSync(path.join(folderPath, file), { recursive: true, force: true }); } catch (_) { }
                            }
                        }
                    } catch (err) {
                        console.error(chalk.red(`[ CLEANER ] Lỗi: ${folderPath}`), err.message);
                    }
                }
                logger(`Đã xử lý cache.`, "[ CLEANER ]");
            } else {
                logger(`Auto Clean Cache đã bị tắt.`, "[ CLEANER ]");
            }
        });
    } catch (err) {
        handleError(err);
        process.exit(1);
    }
}

(async () => {
    try {
        const { Sequelize } = require("sequelize");
        await sequelize.authenticate();
        const authentication = {};
        authentication.Sequelize = Sequelize;
        authentication.sequelize = sequelize;
        const models = database(authentication);
        logger(`Kết nối đến cơ sở dữ liệu thành công`, "[ DATABASE ] >");
        const botData = {};
        botData.models = models;
        logger.autoLogin(onBot, botData);
    } catch (error) {
        logger(`Kết nối đến cơ sở dữ liệu thất bại`, "[ DATABASE ] >");
    }
})();
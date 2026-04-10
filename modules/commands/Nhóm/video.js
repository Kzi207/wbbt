const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

module.exports.config = {
    name: "vd",
    version: "1.0.0",
    hasPermssion: 1,
    credits: "Niio-team (Vtuan) đã cướp cre của DC-nam",
    description: "Gửi video supper víp",
    commandCategory: "Nhóm",
    usages: "",
    cooldowns: 0
};

const stream_url = async function (url) {
    return axios({ url: url, responseType: 'stream' }).then(response => response.data);
};

// Helper: Delay function
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper: Upload dùng đúng FCA method httpPostFormData
const upload = async (url, api, retries = 3) => {
    try {
        const form = new FormData();
        const stream = await stream_url(url);
        form.append('upload_1024', stream, { filename: 'video.mp4', contentType: 'video/mp4' });

        // FCA dùng httpPostFormData (callback-style), không phải postFormData
        const res = await new Promise((resolve, reject) => {
            api.httpPostFormData('https://upload.facebook.com/ajax/mercury/upload.php', form, (err, body) => {
                if (err) return reject(err);
                resolve(body);
            });
        });

        if (!res) throw new Error('Empty response from upload API');

        // FCA trả về string, cần parse
        const rawStr = typeof res === 'string' ? res : JSON.stringify(res);
        const cleanBody = rawStr.replace('for (;;);', '').trim();
        if (!cleanBody) throw new Error('Empty JSON body');

        const jsonData = JSON.parse(cleanBody);
        const metadata = jsonData?.payload?.metadata?.[0];
        if (!metadata) throw new Error('No metadata in response');

        const entries = Object.entries(metadata);
        if (!entries || entries.length === 0) throw new Error('Empty metadata entries');
        
        return entries[0];
    } catch (error) {
        // Xử lý lỗi 429 (Rate Limit)
        if (error.response?.status === 429 || error.message?.includes('429') || error.message?.includes('Too Many')) {
            if (retries > 0) {
                const waitTime = (4 - retries) * 10000; // 10s, 20s, 30s
                console.warn(`⚠️ Rate limit hit. Retrying in ${waitTime / 1000}s... (${retries} retries left)`);
                await delay(waitTime);
                return upload(url, api, retries - 1);
            } else {
                throw new Error('Rate limit exceeded after retries');
            }
        }
        console.warn('Upload error:', error.message || error);
        throw error;
    }
};

global.anime = [];
global.girl = [];
global.trai = [];

module.exports.onLoad = async function (api) {
    const _v = {
        anime: JSON.parse(fs.readFileSync('./includes/listapi/video/api.json', 'utf-8')),
        girl: JSON.parse(fs.readFileSync('./includes/listapi/video/vdgai.json', 'utf-8')),
        trai: JSON.parse(fs.readFileSync('./includes/listapi/video/trai.json', 'utf-8')),
    };

    ['anime', 'girl', 'trai'].forEach((type, idx) => {
        const _status = `status${idx + 1}`;
        const _gl = `Vtuancuti${idx + 1}`;
        const mảng = global[type];

        if (!global[_gl]) {
            // Stagger delays: anime bắt đầu ngay, girl sau 60s, trai sau 120s
            const startDelay = idx * 60000; // 0s, 60s, 120s
            const interval = 180000; // 3 phút = 180s (mỗi loại upload 1 lần/3 phút)
            
            setTimeout(() => {
                global[_gl] = setInterval(async () => {
                    // Bỏ qua nếu đang upload hoặc buffer đã đủ
                    if (global[_status] || mảng.length > 3) return;
                    global[_status] = true;

                    try {
                        // Upload 1 video mỗi lần để tránh rate limit
                        const url = _v[type][Math.floor(Math.random() * _v[type].length)];
                        const result = await upload(url, api).catch(err => {
                            console.warn(`Failed to upload ${type} video:`, err?.message || err?.toString() || 'Unknown error');
                            return null;
                        });
                        if (result !== null && result !== undefined) mảng.push(result);
                    } catch (error) {
                        console.warn(`Error loading ${type} videos:`, error.message);
                    } finally {
                        global[_status] = false;
                    }
                }, interval); // 180s/lần (3 phút)
            }, startDelay);
        }
    });
};

module.exports.run = async function (o) {
    const send = msg => new Promise(r => o.api.sendMessage(msg, o.event.threadID, (err, res) => r(res || err), o.event.messageID));
    const videoTypes = {
        anime: global.anime,
        gái: global.girl,
        trai: global.trai
    };
    send({
        body: videoTypes[o.args[0]] ? `Video ${o.args[0].charAt(0).toUpperCase() + o.args[0].slice(1)}` : 'Vui lòng nhập "anime", "gái", hoặc "trai" để nhận video tương ứng.',
        attachment: videoTypes[o.args[0]] ? videoTypes[o.args[0]].splice(0, 1) : []
    });
};

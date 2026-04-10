module.exports.config = {
  name: "gaivip",
  version: "4.1.0",
  hasPermssion: 0,
  Rent: 2,
  credits: "Vtuan",
  description: "sos",
  commandCategory: "Ảnh",
  usages: "",
  cooldowns: 6000
};

module.exports.run = async ({ api, event }) => {
  const axios = require('axios');
  const fs = require('fs');
  const path = require('path');
  const list = require('../../../includes/listapi/ảnh/gaivip.json');
  const cacheDir = path.join(__dirname, 'cache');
  if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });

  const numImages = Math.floor(Math.random() * 5) + 1;
  const filePaths = [];

  try {
    for (let i = 0; i < numImages; i++) {
      const url = list[Math.floor(Math.random() * list.length)].trim();
      const filePath = path.join(cacheDir, `gaivip_${Date.now()}_${i}.png`);
      const res = await axios.get(url, { responseType: 'arraybuffer' });
      fs.writeFileSync(filePath, res.data);
      filePaths.push(filePath);
    }

    await new Promise((resolve, reject) =>
      api.sendMessage(
        { body: 'Tha hồ ngắm=)))', attachment: filePaths.map(p => fs.createReadStream(p)) },
        event.threadID,
        (err) => { if (err) reject(err); else resolve(); },
        event.messageID
      )
    );
  } finally {
    for (const p of filePaths) fs.existsSync(p) && fs.unlinkSync(p);
  }
};
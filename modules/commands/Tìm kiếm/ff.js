this.config = {
 name: 'ff',
 version: '1.1.1',
 hasPermssion: 0,
 credits: 'DongDev',
 description: 'Thông tin nhân vật free fire',
 commandCategory: 'Tìm kiếm',
 usages: '[]',
 cooldowns: 5,
 images: []
};

this.run = async (o) => {
  const axios = require('axios');
  const send = (msg) => o.api.sendMessage(msg, o.event.threadID, o.event.messageID);
  
  try {
    const response = await axios.get(`https://apichatbot.sumiproject.io.vn/heroff?name=${o.args.join(" ")}`);

    const data = response.data.data.data[0];
    if (!data) {
      return send('Không tìm thấy kết quả');
    }

    const imgResponse = await axios.get(data.cover_img, { responseType: 'stream' });
    const imgStream = imgResponse.data;

    send({
      body: `Name: ${data.name}\nMô tả: ${data.abstract}`,
      attachment: imgStream
    });
  } catch (error) {
    console.error("Error fetching data:", error);
    send('Đã xảy ra lỗi khi lấy dữ liệu');
  }
}
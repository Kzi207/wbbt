const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs-extra');
const moment = require('moment-timezone');

// SoundCloud API client ID (public, extracted from web)
const CLIENT_ID = 'XiD3LeYoTKN7rIqQi5aDtnwz9t9zcDYw'; // Fallback public client ID

// Hàm lấy client_id từ SoundCloud web
async function getClientId() {
  try {
    const response = await axios.get('https://soundcloud.com');
    const scriptUrls = response.data.match(/https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js/g);
    
    if (scriptUrls && scriptUrls.length > 0) {
      const scriptResponse = await axios.get(scriptUrls[0]);
      const match = scriptResponse.data.match(/client_id:"([a-zA-Z0-9]+)"/);
      if (match && match[1]) {
        console.log('✅ Đã lấy client_id mới:', match[1]);
        return match[1];
      }
    }
  } catch (error) {
    console.log('⚠️ Dùng fallback client_id');
  }
  return CLIENT_ID; // Fallback
}

// Tìm kiếm tracks trên SoundCloud
async function searchSoundCloud(query, clientId) {
  const url = `https://api-v2.soundcloud.com/search/tracks`;
  const response = await axios.get(url, {
    params: {
      q: query,
      client_id: clientId,
      limit: 5,
      offset: 0
    },
    timeout: 15000
  });
  
  return response.data.collection || [];
}

// Lấy stream URL từ track
async function getStreamUrl(track, clientId) {
  try {
    // Kiểm tra progressive URL (HLS/MP3 stream)
    if (track.media?.transcodings) {
      // Tìm progressive MP3 stream
      const progressive = track.media.transcodings.find(t => 
        t.format.protocol === 'progressive' && t.format.mime_type.includes('audio/mpeg')
      );
      
      if (progressive) {
        const streamResponse = await axios.get(progressive.url, {
          params: { client_id: clientId },
          timeout: 10000
        });
        
        if (streamResponse.data && streamResponse.data.url) {
          return streamResponse.data.url;
        }
      }
      
      // Nếu không có progressive, thử HLS
      const hls = track.media.transcodings.find(t => 
        t.format.protocol === 'hls'
      );
      
      if (hls) {
        const streamResponse = await axios.get(hls.url, {
          params: { client_id: clientId },
          timeout: 10000
        });
        
        if (streamResponse.data && streamResponse.data.url) {
          return streamResponse.data.url;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('Lỗi lấy stream URL:', error.message);
    return null;
  }
}

// Download MP3 từ progressive stream
async function downloadFromStream(streamUrl, outputPath) {
  try {
    console.log('📥 Đang download từ stream...');
    
    const response = await axios.get(streamUrl, {
      responseType: 'arraybuffer',
      timeout: 60000,
      maxContentLength: 50 * 1024 * 1024, // 50MB
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': '*/*'
      }
    });
    
    // Tạo thư mục nếu chưa có
    const path = require('path');
    const dir = path.dirname(outputPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    
    fs.writeFileSync(outputPath, Buffer.from(response.data, 'binary'));
    return true;
  } catch (error) {
    console.error('Lỗi download stream:', error.message);
    return false;
  }
}

module.exports.config = {
  name: 'scl',
  version: '2.0.0',
  hasPermssion: 0,
  credits: 'DongDev - Updated to use SoundCloud API',
  description: 'Tìm kiếm và tải nhạc từ SoundCloud API',
  commandCategory: 'Tìm kiếm',
  usages: '<tên bài hát>',
  cooldowns: 5,
  images: [],
};

let cachedClientId = null;

module.exports.run = async function ({ api, event, args }) {
  const query = args.join(" ").trim();
  const { threadID, messageID, senderID } = event;

  if (!query) {
    return api.sendMessage("⚠️ Vui lòng nhập tên bài hát cần tìm", threadID, messageID);
  }

  try {
    console.log(`🔍 Tìm kiếm SoundCloud API: "${query}"`);
    
    // Lấy client_id (cache để không phải lấy lại mỗi lần)
    if (!cachedClientId) {
      api.sendMessage("🔄 Đang khởi tạo kết nối SoundCloud...", threadID);
      cachedClientId = await getClientId();
    }
    
    api.sendMessage(`🔍 Đang tìm kiếm: "${query}"...`, threadID);
    
    const tracks = await searchSoundCloud(query, cachedClientId);
    
    if (!tracks || tracks.length === 0) {
      return api.sendMessage(`❌ Không tìm thấy bài hát "${query}" trên SoundCloud`, threadID, messageID);
    }

    console.log(`✅ Tìm thấy ${tracks.length} kết quả`);

    // Format kết quả
    const results = tracks.slice(0, 5).map((track, index) => {
      const duration = track.duration ? Math.floor(track.duration / 1000) : 0;
      const minutes = Math.floor(duration / 60);
      const seconds = duration % 60;
      const durationStr = `${minutes}:${seconds.toString().padStart(2, '0')}`;
      
      return {
        id: track.id,
        title: track.title || 'Unknown',
        artist: track.user?.username || 'Unknown Artist',
        duration: durationStr,
        durationMs: track.duration,
        artwork: track.artwork_url || track.user?.avatar_url || '',
        permalink: track.permalink_url,
        plays: track.playback_count || 0,
        likes: track.likes_count || 0,
        track: track
      };
    });

    const messages = results.map((item, index) => {
      const playsStr = item.plays > 1000 ? `${(item.plays / 1000).toFixed(1)}K` : item.plays;
      return `\n${index + 1}. 🎵 ${item.title}\n   👤 ${item.artist}\n   ⏱️ ${item.duration} | 👂 ${playsStr} plays`;
    });

    const listMessage = `🎵 Kết quả tìm kiếm: "${query}"\n${messages.join("\n")}\n\n💬 Reply số (1-${results.length}) để tải nhạc`;

    api.sendMessage(listMessage, threadID, (error, info) => {
      if (!error) {
        global.client.handleReply.push({
          type: "soundcloud_download",
          name: this.config.name,
          author: senderID,
          messageID: info.messageID,
          results: results,
          clientId: cachedClientId
        });
        console.log(`✅ Đã gửi danh sách, messageID: ${info.messageID}`);
      }
    });
  } catch (error) {
    console.error("❌ Lỗi tìm kiếm SoundCloud:", error.message);
    
    // Nếu client_id hết hạn, xóa cache
    if (error.response?.status === 401 || error.response?.status === 403) {
      cachedClientId = null;
      return api.sendMessage("⚠️ Kết nối SoundCloud hết hạn. Vui lòng thử lại!", threadID, messageID);
    }
    
    api.sendMessage(`❌ Lỗi tìm kiếm: ${error.message}`, threadID, messageID);
  }
};

module.exports.handleReply = async function ({ event, api, handleReply }) {
  const { threadID: tid, messageID: mid, body, senderID } = event;

  // Kiểm tra quyền reply
  if (handleReply.author !== senderID) {
    return api.sendMessage("⚠️ Bạn không phải người yêu cầu nhạc này!", tid, mid);
  }

  switch (handleReply.type) {
    case 'soundcloud_download': {
      const choose = parseInt(body);
      api.unsendMessage(handleReply.messageID);

      if (isNaN(choose)) {
        return api.sendMessage('⚠️ Vui lòng reply số tương ứng', tid, mid);
      }

      if (choose > handleReply.results.length || choose < 1) {
        return api.sendMessage(`❌ Lựa chọn không hợp lệ. Vui lòng chọn từ 1-${handleReply.results.length}`, tid, mid);
      }

      const chosen = handleReply.results[choose - 1];
      
      if (!chosen || !chosen.track) {
        return api.sendMessage('❌ Thông tin bài hát không hợp lệ!', tid, mid);
      }
      
      console.log(`🎵 Đang tải: ${chosen.artist} - ${chosen.title}`);
      
      api.sendMessage(`⏳ Đang tải: ${chosen.title}\n👤 ${chosen.artist}\n⏱️ ${chosen.duration}`, tid);
      
      try {
        // Lấy stream URL
        const streamUrl = await getStreamUrl(chosen.track, handleReply.clientId);
        
        if (!streamUrl) {
          return api.sendMessage('❌ Không thể lấy link stream. Bài hát có thể bị giới hạn hoặc không công khai!', tid, mid);
        }
        
        console.log('✅ Đã lấy stream URL');
        
        // Tạo thư mục cache nếu chưa có
        const cacheDir = __dirname + '/cache';
        if (!fs.existsSync(cacheDir)) {
          fs.mkdirSync(cacheDir, { recursive: true });
        }
        
        // Download file
        const path = cacheDir + `/soundcloud_${Date.now()}.mp3`;
        const downloaded = await downloadFromStream(streamUrl, path);
        
        if (!downloaded || !fs.existsSync(path)) {
          return api.sendMessage('❌ Không thể tải file MP3. Vui lòng thử bài khác!', tid, mid);
        }
        
        const fileSize = (fs.statSync(path).size / (1024 * 1024)).toFixed(2);
        console.log(`✅ Đã tải file thành công. Kích thước: ${fileSize}MB`);

        // Gửi file
        const likesStr = chosen.likes > 1000 ? `${(chosen.likes / 1000).toFixed(1)}K` : chosen.likes;
        const playsStr = chosen.plays > 1000 ? `${(chosen.plays / 1000).toFixed(1)}K` : chosen.plays;
        
        api.sendMessage({
          body: `🎵 [ SOUNDCLOUD ]\n────────────────────\n📝 ${chosen.title}\n👤 ${chosen.artist}\n⏱️ ${chosen.duration}\n👂 ${playsStr} plays | ❤️ ${likesStr} likes\n💾 ${fileSize}MB\n────────────────────\n🔗 ${chosen.permalink}\n⏰ ${moment.tz("Asia/Ho_Chi_Minh").format("DD/MM/YYYY || HH:mm:ss")}`,
          attachment: fs.createReadStream(path)
        }, tid, () => {
          console.log('✅ Đã gửi nhạc thành công');
          setTimeout(() => {
            if (fs.existsSync(path)) {
              fs.unlinkSync(path);
              console.log('🗑️ Đã xóa file cache');
            }
          }, 60 * 1000); // Xóa sau 1 phút
        }, mid);
        
      } catch (error) {
        console.error('❌ Lỗi tải nhạc:', error.message);
        
        // Nếu client_id hết hạn
        if (error.response?.status === 401 || error.response?.status === 403) {
          cachedClientId = null;
          return api.sendMessage('⚠️ Kết nối SoundCloud hết hạn. Vui lòng tìm kiếm lại!', tid, mid);
        }
        
        return api.sendMessage(`❌ Lỗi: ${error.message}\nVui lòng thử bài khác!`, tid, mid);
      }
      break;
    }
    
    default:
      break;
  }
};

// Export helper functions để các modules khác có thể sử dụng
module.exports.getClientId = getClientId;
module.exports.searchSoundCloud = searchSoundCloud;
module.exports.getStreamUrl = getStreamUrl;
module.exports.downloadFromStream = downloadFromStream;
module.exports.getCachedClientId = () => cachedClientId;
module.exports.setCachedClientId = (id) => { cachedClientId = id; };
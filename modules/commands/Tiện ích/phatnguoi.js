const request = require("request");

module.exports.config = {
	name: "phatnguoi",
	version: "1.0.0",
	hasPermssion: 0,
	credits: "khánh Duy",
	description: "Tra cứu phạt nguội xe máy và oto",
	commandCategory: "Tiện ích",
	usages: "[biển số] [loại: xemay|oto]",
	cooldowns: 5,
	dependencies: {
		request: ""
	}
};

module.exports.run = async ({ api, event, args }) => {
	const { threadID, messageID } = event;

	if (!args[0]) {
		return api.sendMessage("❎ Vui lòng nhập biển số xe (vd: 30F88251)\n\nCú pháp: /phatnguoi [biển số] [xemay/oto]", threadID, messageID);
	}

	const plate = args[0].toUpperCase().trim();
	
	// Parse vehicle type - 1 for motorcycle, 2 for car
	let type = "1"; // default motorcycle
	let vehicleText = "xe máy";
	let vehicleIcon = "🏍️";
	
	if (args[1]) {
		const typeInput = args[1].toLowerCase().trim();
		if (typeInput === "oto" || typeInput === "xe" || typeInput === "car" || typeInput === "2") {
			type = "2";
			vehicleText = "oto";
			vehicleIcon = "🚗";
		} else if (typeInput === "xemay" || typeInput === "motorcycle" || typeInput === "1") {
			type = "1";
			vehicleText = "xe máy";
			vehicleIcon = "🏍️";
		}
	}

	// Validate plate format - more flexible for various Vietnamese plate types
	if (!/^[0-9]{2}[A-Z]{1,2}[0-9]{4,6}$|^[0-9]{2}-[A-Z]{1,2}-[0-9]{4,6}$/.test(plate.replace(/-/g, ""))) {
		return api.sendMessage("❎ Biển số xe không hợp lệ!\n\nFormat: 30F88251 hoặc 29D224936", threadID, messageID);
	}

	try {
		api.sendMessage("⏳ Đang tra cứu...", threadID, messageID);

		const url = `https://api.phatnguoi.vn/web/tra-cuu/${plate.replace(/-/g, "")}/${type}`;

		request(url, (err, response, body) => {
			if (err) {
				return api.sendMessage("⚠️ Lỗi kết nối đến server. Vui lòng thử lại sau.", threadID, messageID);
			}

			try {
				if (!body) {
					return api.sendMessage("❌ Không nhận được dữ liệu từ server.", threadID, messageID);
				}

				// Check if response is HTML (API returns HTML for "no violations" case)
				if (body.trim().startsWith("<")) {
					// Parse HTML response
					if (body.includes("không có lỗi vi phạm") || body.includes("không có vi phạm")) {
						return api.sendMessage(`✅ ${vehicleIcon} Biển số ${plate} (${vehicleText})\n\n🎉 Chúc mừng! Không có vi phạm ghi nhận.\n\n📍 Nguồn: phatnguoi.vn`, threadID, messageID);
					}
					// If HTML contains other content, show error
					return api.sendMessage(`⚠️ Không thể xử lý kết quả.\n\nVui lòng thử lại hoặc kiểm tra biển số`, threadID, messageID);
				}

				// Try to parse as JSON
				let data = JSON.parse(body);
				
				// Handle different response formats
				if (data.data && Array.isArray(data.data)) {
					data = data.data;
				} else if (data.result && Array.isArray(data.result)) {
					data = data.result;
				} else if (data.violations && Array.isArray(data.violations)) {
					data = data.violations;
				}

				// Check if data is an array and has violations
				if (!Array.isArray(data)) {
					data = [data];
				}

				// Filter out empty or invalid violation objects
				data = data.filter(v => v && typeof v === 'object' && Object.keys(v).length > 0);

				if (!data || data.length === 0) {
					return api.sendMessage(`✅ ${vehicleIcon} Biển số ${plate} (${vehicleText}) không có vi phạm ghi nhận.`, threadID, messageID);
				}

				let message = `📋 KẾT QUẢ TRA CỨU PHẠT NGUỘI\n`;
				message += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
				message += `${vehicleIcon} Loại phương tiện: ${vehicleText}\n`;
				message += `🔢 Biển số: ${plate}\n`;
				message += `📊 Tổng vi phạm: ${data.length}\n`;
				message += `━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

				data.forEach((violation, index) => {
					message += `⚠️ Vi phạm #${index + 1}\n`;
					message += `├─ Hành vi: ${violation.hanhvi || violation.behavior || "Không rõ"}\n`;
					message += `├─ Nơi vi phạm: ${violation.noivipham || violation.location || "Không rõ"}\n`;
					message += `├─ Ngày vi phạm: ${violation.ngay || violation.date || "Không rõ"}\n`;
					
					const fine = violation.mucphat || violation.fine || 0;
					message += `├─ Mức phạt: ${fine ? Number(fine).toLocaleString("vi-VN") + " đ" : "Không rõ"}\n`;
					
					const status = violation.trangthai || violation.status || "Không rõ";
					message += `└─ Trạng thái: ${status === "Chưa xử phạt" ? "⏳ Chưa xử phạt" : "✅ Đã xử phạt"}\n\n`;
				});

				const totalFine = data.reduce((sum, v) => {
					const fine = v.mucphat || v.fine || 0;
					return sum + Number(fine);
				}, 0);

				message += `━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
				message += `💰 Tổng tiền phạt: ${totalFine.toLocaleString("vi-VN")} đ\n`;
				message += `📍 Nguồn: phatnguoi.vn`;

				return api.sendMessage(message, threadID, messageID);
			} catch (parseErr) {
				console.error("Lỗi xử lý dữ liệu:", parseErr.message);
				console.error("Response preview:", body.substring(0, 200));
				return api.sendMessage(`⚠️ Lỗi xử lý dữ liệu.\n\nVui lòng thử lại hoặc kiểm tra biển số và loại phương tiện.`, threadID, messageID);
			}
		});
	} catch (error) {
		api.sendMessage("⚠️ Đã có lỗi xảy ra. Vui lòng thử lại.", threadID, messageID);
	}
};

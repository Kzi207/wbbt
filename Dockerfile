# Node 20 LTS chính thức
FROM node:20-bookworm-slim

# Cài system libraries cần thiết cho native addons
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python-is-python3 make g++ git \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    libcups2 libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libgbm1 libgtk-3-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    libxext6 libxfixes3 libxi6 libxrender1 libxtst6 \
    fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# npm config env vars — ép tất cả native packages build từ source,
# không download prebuilt binary (tránh lỗi network hoặc binary sai arch).
# npm_config_build_from_source áp dụng cả cho node-pre-gyp packages (better-sqlite3).
ENV npm_config_build_from_source=true
ENV npm_config_python=python3

# Copy package files riêng để cache layer install
COPY package*.json ./

# Một lệnh install duy nhất — npm_config env vars đã ép build from source.
# Không dùng --ignore-scripts vì better-sqlite3 cần script install của nó chạy.
RUN npm install

# Copy source code
COPY . .

# Tạo thư mục data mặc định để disk mount không lỗi lần đầu deploy
RUN mkdir -p /app/data

# Kiểm tra binary tồn tại ngay trong build — fail sớm nếu thiếu
RUN node -e "require('better-sqlite3')" && echo "better-sqlite3 OK"

# Port mặc định của Render Docker services
EXPOSE 10000

# Health check để Render biết khi nào app sẵn sàng
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 10000) + '/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Khởi động Web Manager
CMD ["node", "web/server/index.cjs"]

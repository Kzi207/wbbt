# Node 22 LTS (Satisfies meta-messenger.js requirement >=22.12.0)
FROM node:22-bookworm-slim

# Cài system libraries cần thiết cho native addons
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    libcups2 libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libgbm1 libgtk-3-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    libxext6 libxfixes3 libxi6 libxrender1 libxtst6 \
    fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files riêng để cache layer install
COPY package.json ./

# Cài dependencies. Lần này không ép build-from-source để tận dụng 
# prebuilt binaries của better-sqlite3 v11 (hỗ trợ tốt Node 22).
RUN npm install

# Copy source code
COPY . .

# Tạo thư mục data mặc định để disk mount không lỗi lần đầu deploy
RUN mkdir -p /app/data

# Verify native addon works
RUN node -e "require('better-sqlite3')" && echo "better-sqlite3 OK"

# Port mặc định của Render Docker services
EXPOSE 10000

# Health check để Render biết khi nào app sẵn sàng
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 10000) + '/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Khởi động Web Manager
CMD ["node", "web/server/index.cjs"]

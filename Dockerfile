# Node 20 LTS chính thức
FROM node:20-bookworm-slim

# Cài system libraries cần thiết cho native addons
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build tools — python-is-python3 để node-gyp tìm được 'python'
    python3 python-is-python3 make g++ git \
    # canvas (cairo, pango, jpeg, gif, librsvg)
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    # Chromium / Puppeteer headless
    libcups2 libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libgbm1 libgtk-3-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    libxext6 libxfixes3 libxi6 libxrender1 libxtst6 \
    # Fonts & ssl
    fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files riêng để cache layer install
COPY package*.json ./

# npm install thẳng (không --ignore-scripts) để build scripts chạy đúng lúc.
# PYTHON=python3 đảm bảo node-gyp dùng đúng binary ngay cả khi
# python-is-python3 chưa kịp link trong PATH của npm subprocess.
RUN PYTHON=python3 npm install 2>&1 | tail -50

# Copy source code
COPY . .

# Tạo thư mục data mặc định để disk mount không lỗi lần đầu deploy
RUN mkdir -p /app/data

# Port mặc định của Render Docker services
EXPOSE 10000

# Health check để Render biết khi nào app sẵn sàng
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD node -e "require('http').get('http://localhost:' + (process.env.PORT || 10000) + '/api/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Khởi động Web Manager
CMD ["node", "web/server/index.cjs"]

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

# Bước 1: Cài tất cả deps, bỏ qua install scripts để không bị lỗi abort sớm
RUN PYTHON=python3 npm install --ignore-scripts

# Bước 2: Rebuild riêng từng native addon — KHÔNG || true cho better-sqlite3
# để build lỗi thật sự fail image (không chạy runtime với binary thiếu)
RUN PYTHON=python3 npm rebuild better-sqlite3 --build-from-source
RUN PYTHON=python3 npm rebuild sqlite3 --build-from-source || true
RUN PYTHON=python3 npm rebuild canvas --build-from-source || true
RUN PYTHON=python3 npm rebuild koffi || true
RUN PYTHON=python3 npm rebuild deasync --build-from-source || true

# Chạy postinstall scripts còn lại (không phải native addons)
RUN PYTHON=python3 npm rebuild

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

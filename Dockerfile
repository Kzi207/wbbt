# Node 20 LTS chính thức
FROM node:20-bookworm-slim

# Cài tất cả system libraries cần thiết cho native addons
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Build tools
    python3 make g++ git \
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

# Cài với ignore-scripts trước (tránh lỗi prebuild thiếu deps)
# Sau đó rebuild các native module cần thiết
RUN npm install --ignore-scripts 2>&1 | tail -20 || true && \
    npm rebuild better-sqlite3 --build-from-source 2>&1 | tail -5 || true && \
    npm rebuild sqlite3 --build-from-source 2>&1 | tail -5 || true && \
    npm rebuild canvas --build-from-source 2>&1 | tail -5 || true && \
    npm rebuild koffi 2>&1 | tail -5 || true && \
    npm rebuild deasync 2>&1 | tail -5 || true

# Copy source code
COPY . .

# Port mặc định của web server
EXPOSE 7070

# Khởi động Web Manager
CMD ["node", "web/server/index.cjs"]

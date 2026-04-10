# Node 20 LTS (bắt buộc >= 18 cho koffi, canvas...)
FROM node:20-bookworm-slim

# System deps:
# - python3 / make / g++ / git   → build native addons (better-sqlite3, canvas, koffi, deasync...)
# - libcairo / pango / etc.      → canvas
# - libcups / libnss / libatk... → puppeteer / chromium headless
# - fonts-noto-color-emoji       → emoji support
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ git \
    libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev \
    libcups2 libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 \
    libgbm1 libgtk-3-0 libx11-xcb1 libxcomposite1 libxdamage1 libxrandr2 \
    fonts-noto-color-emoji ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files trước để cache layer npm install
COPY package*.json ./

# Cài dependencies (bao gồm rebuild native addons với đúng Node)
RUN npm install --omit=dev --build-from-source 2>&1 || npm install --omit=dev

# Copy toàn bộ source code
COPY . .

# Render inject PORT tự động – web server đọc process.env.PORT
EXPOSE 7070

# Khởi động Web Manager (bot chạy qua giao diện web)
CMD ["node", "web/server/index.cjs"]

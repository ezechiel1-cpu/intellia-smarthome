FROM node:18-slim

# Installer Chromium et LibreOffice
RUN apt-get update && apt-get install -y \
    chromium \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

# Définir le chemin de Chromium
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]

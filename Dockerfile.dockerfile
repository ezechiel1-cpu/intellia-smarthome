FROM node:18-slim

# Installer Chromium et LibreOffice
RUN apt-get update && apt-get install -y \
    chromium \
    libreoffice \
    && rm -rf /var/lib/apt/lists/*

# Définir le chemin de Chromium pour l'application
ENV CHROME_PATH=/usr/bin/chromium

WORKDIR /app

# Copier package.json et installer les dépendances
COPY package*.json ./
RUN npm install --omit=dev

# Copier le reste du code
COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
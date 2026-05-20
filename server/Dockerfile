# Utilisation d'une image Node légère
FROM node:20-alpine

# Dossier de travail dans le conteneur
WORKDIR /app

# Copie des fichiers de configuration
COPY package*.json ./

# Installation de git, docker CLI et le plugin docker compose V2 (avec buildx)
RUN apk add --no-cache git docker-cli docker-cli-compose docker-cli-buildx

# Installation des dépendances
RUN npm install

# Copie du reste du code source
COPY . .

# On expose le port 3001
EXPOSE 3001

# Lancement du serveur en mode production
CMD ["node", "index.js"]
# Étape 1 : Build de l'application Vue
FROM node:20-alpine as build-stage
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

# On déclare qu'on attend un argument de Dockge
ARG VITE_API_BASE_URL
# On le transforme en variable d'environnement pour le build Vue.js
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# Étape 2 : Service des fichiers avec Nginx
FROM nginx:alpine
COPY --from=build-stage /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
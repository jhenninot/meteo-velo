# ActiWeather

![node](https://img.shields.io/badge/node-%3E%3D16-brightgreen.svg)
![docker](https://img.shields.io/badge/docker-ready-blue.svg)
![CI](https://github.com/jhenninot/meteo-velo/actions/workflows/ci.yml/badge.svg?branch=main)

Application web pour consulter les données météo et suivre des activités (Strava).

## Description

ActiWeather est une application full‑stack composée d'un backend Node.js et d'un frontend Vite (+Vue). Elle centralise les prévisions météo et les activités Strava pour aider les sportifs à planifier leurs sorties.

## Principales fonctionnalités

- Prévisions météo agrégées (matin / après-midi) et conseils basés sur des règles
- Intégration OAuth avec Strava pour importer les activités
- Gestion des préférences et activités personnalisées par utilisateur
- Interface d'administration pour gérer les utilisateurs et paramètres

## Architecture du dépôt

- Backend: [server](server) — API Node.js (Express), initialisation admin (`init-admin.js`) et modèle utilisateur (`models/Users.js`).
- Frontend: [client](client) — application Vite + Vue (composants dans `client/src/components`).
- Docker: `docker-compose.yml` pour lancer l'ensemble (frontend, backend, MongoDB).

## Prérequis

- Docker & Docker Compose (recommandé)
- Node.js >= 16 (si vous lancez localement sans Docker)

## Lancer avec Docker (recommandé)

```bash
docker-compose up --build
```

Par défaut :
- Frontend (Vite) : http://localhost:5173
- Backend (API) : http://localhost:3001

## Lancer en développement (sans Docker)

Terminal 1 — serveur :

```bash
cd server
npm install
npm run dev
```

Terminal 2 — client :

```bash
cd client
npm install
npm run dev
```

## Variables d'environnement

Créez un fichier `.env` dans le dossier `server` (ou configurez les variables dans Docker) :

```env
PORT=3001
MONGO_URL=mongodb://mongodb:27017/meteo_velo
JWT_SECRET=une_clef_secrete_longue
GEMINI_API_KEY=xxx
STRAVA_CLIENT_ID=your_strava_client_id
STRAVA_CLIENT_SECRET=your_strava_client_secret
STRAVA_CALLBACK_URL=https://votre-frontend/strava/callback
FRONTEND_URL=http://localhost:5173
WEBHOOK_SECRET=une_autre_clef_pour_webhook
```

Descriptions :
- `MONGO_URL` : chaîne de connexion MongoDB.
- `JWT_SECRET` : clé pour signer les tokens JWT.
- `GEMINI_API_KEY` : clé pour le service Gemini (IA), optionnel.
- `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_CALLBACK_URL` : paramètres OAuth pour Strava.
- `FRONTEND_URL` : URL du frontend (utilisée pour redirections OAuth).
- `WEBHOOK_SECRET` : secret HMAC pour la route `/api/webhook` utilisée par déploiement automatisé.

## Captures d'écran

Ajoutez des captures dans `docs/screenshots/` puis remplacez le placeholder ci-dessous :

![screenshot](docs/screenshots/placeholder.png)

Conseil : utilisez `/docs/screenshots/` dans le dépôt et commitez les images.

## API — Endpoints (exemples)

Liste non exhaustive des endpoints utiles exposés par le backend (`/server/index.js`) :

- POST `/api/login` — Auth: none. Body: `{ "username":"...", "password":"..." }` → `{ token, role, username, preferences }`
- POST `/api/forecast` — Auth required. Body: `{ "lat":48.8, "lon":2.3, "city":"Paris", "activityId":"<id|none>" }` → retourne `forecast` et métadonnées IA.
- GET `/api/strava/authorize` — Auth required. Retourne l'URL d'autorisation Strava.
- GET `/api/strava/callback` — Callback OAuth Strava (frontend redirigé).
- GET `/api/strava/activities` — Auth required. Params: `days` ou `startDate`/`endDate`. Retourne activités vélo.
- DELETE `/api/strava/disconnect` — Délie le compte Strava de l'utilisateur.
- GET/POST/DELETE `/api/user/favorites` — Gérer les favoris (requiert auth).
- POST `/api/admin/create-user` — Admin uniquement: créer un utilisateur.

Exemple curl (login + forecast) :

```bash
# Login
TOKEN=$(curl -s -X POST http://localhost:3001/api/login -H "Content-Type: application/json" -d '{"username":"admin","password":"votre_mdp"}' | jq -r .token)

# Forecast
curl -s -X POST http://localhost:3001/api/forecast \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"lat":48.8566,"lon":2.3522,"city":"Paris","activityId":"none"}' | jq
```

## Tests & utilitaires

- `server/test-model.js` contient des scripts d'essai pour les modèles et la DB.

## Contribution

- Forkez le dépôt, créez une branche et ouvrez une Pull Request avec une description claire.

## Fichiers importants

- `server/index.js` — point d'entrée du backend
- `server/init-admin.js` — script d'initialisation admin
- `client/src/main.js` — point d'entrée du frontend
- `docker-compose.yml` — orchestration Docker

import express from 'express';
import cors from 'cors';
import axios from 'axios';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mongoose from 'mongoose'; // <-- AJOUTÉ
import bcrypt from 'bcryptjs';    // <-- AJOUTÉ
import jwt from 'jsonwebtoken';   // <-- AJOUTÉ
import crypto from 'crypto';
import { exec } from 'child_process';
// j
const app = express();
app.use(cors());
// Route brute webhook avant bodyParser (express.json)
app.post('/api/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  const secret = process.env.WEBHOOK_SECRET;
  const stackDir = process.env.STACK_DIR || '/app/stack';

  // 1. Vérification de la signature HMAC-SHA256
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !secret) {
    console.warn('[webhook] Signature ou secret manquant.');
    return res.status(401).send('Unauthorized');
  }
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(req.body).digest('hex');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    console.warn('[webhook] Signature invalide.');
    return res.status(401).send('Signature invalide');
  }

  // 2. Filtrer sur l'événement push uniquement
  const event = req.headers['x-github-event'];
  if (event !== 'push') {
    return res.status(200).send(`Événement "${event}" ignoré.`);
  }

  // 3. Répondre immédiatement à GitHub (timeout 10s)
  res.status(200).send('Déploiement lancé.');

  // 4. Exécuter la mise à jour (fetch + reset pour éviter les conflits et l'identité Git) + docker compose
  // On utilise -p meteo-velo pour forcer le nom du projet Docker, car le dossier s'appelle /app/stack et changerait le nom en "stack"
  const cmd = `cd ${stackDir} && git fetch --all && git reset --hard origin/main && docker compose -p meteo-velo up -d --build`;
  console.log(`[webhook] Exécution : ${cmd}`);
  exec(cmd, (err, stdout, stderr) => {
    if (err) {
      console.error('[webhook] Erreur :', err.message);
      console.error('[webhook] stderr :', stderr);
    } else {
      console.log('[webhook] Succès :\n', stdout);
    }
  });
});

app.use(express.json());

const PORT = process.env.PORT || 3001;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'ta_cle_secrete_hyper_longue';
const PASSWORD_RULES_MESSAGE = "Le mot de passe doit contenir au moins 10 caractères, une majuscule, une minuscule, un chiffre et un caractère spécial.";
const DEFAULT_ACTIVITY_ICON = 'mdi-bike';

const normalizeMdiIcon = (icon) => {
  const normalized = typeof icon === 'string' ? icon.trim() : '';
  return /^mdi-[a-z0-9-]{1,56}$/.test(normalized) ? normalized : DEFAULT_ACTIVITY_ICON;
};

const validatePasswordStrength = (password) => {
  return typeof password === 'string'
    && password.length >= 10
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
};

// --- 1. CONNEXION MONGODB ---
mongoose.connect(process.env.MONGO_URL || 'mongodb://mongodb:27017/meteo_velo')
  .then(() => console.log("Connecté à MongoDB"))
  .catch(err => console.error("Erreur MongoDB:", err));

// --- 2. MODÈLE UTILISATEUR ---
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  preferences: {
    city: String,
    lat: Number,
    lon: Number,
    consignes: String,
    theme: { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' },
    stravaFilters: { type: [String], default: [] },
    useAiAnalysis: { type: Boolean, default: false }
  },
  activities: {
    type: [{
      label: { type: String, required: true, trim: true, maxlength: 80 },
      icon: { type: String, default: 'mdi-bike', trim: true, maxlength: 60 },
      constraints: { type: String, default: '', trim: true, maxlength: 4000 },
      stravaSportType: { type: String, default: '', trim: true },
      windMin: { type: Number, default: null },
      windMax: { type: Number, default: null },
      gustMin: { type: Number, default: null },
      gustMax: { type: Number, default: null },
      tempMin: { type: Number, default: null },
      tempMax: { type: Number, default: null },
      precipMin: { type: Number, default: null },
      precipMax: { type: Number, default: null },
      uvMin: { type: Number, default: null },
      uvMax: { type: Number, default: null },
      slot1Name: { type: String, default: 'Matin' },
      slot1Start: { type: Number, default: 8 },
      slot1End: { type: Number, default: 12 },
      slot2Name: { type: String, default: 'Après-midi' },
      slot2Start: { type: Number, default: 14 },
      slot2End: { type: Number, default: 19 }
    }],
    default: () => [{
      label: "Course à pied",
      icon: "mdi-run",
      stravaSportType: "Run",
      tempMin: 10,
      tempMax: 28,
      precipMax: 0.1,
      constraints: ""
    }]
  },
  favorites: [{
    city: { type: String, required: true, trim: true },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true }
  }],
  strava: {
    athleteId: Number,
    accessToken: String,
    refreshToken: String,
    expiresAt: Number, // Unix timestamp seconds
    athleteName: String,
    athleteProfile: String
  }
});
const User = mongoose.model('User', userSchema);

const systemSettingSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true }
});
const SystemSetting = mongoose.model('SystemSetting', systemSettingSchema);

const routeSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  distance: { type: Number, default: 0 },
  elevation_gain: { type: Number, default: 0 },
  estimated_moving_time: { type: Number, default: 0 },
  sport_type: { type: String, default: '' },
  map: {
    summary_polyline: { type: String, default: '' }
  },
  source: { type: String, default: 'imported' },
  created_at: { type: Date, default: Date.now },
  updated_at: { type: Date, default: Date.now }
});
const Route = mongoose.model('Route', routeSchema);

// --- HELPER STRAVA : Rafraîchit le token si expiré ---
const ensureStravaToken = async (user) => {
  const now = Math.floor(Date.now() / 1000);
  if (user.strava.expiresAt > now + 60) return user.strava.accessToken;

  const res = await axios.post('https://www.strava.com/oauth/token', {
    client_id: process.env.STRAVA_CLIENT_ID,
    client_secret: process.env.STRAVA_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: user.strava.refreshToken
  });
  user.strava.accessToken = res.data.access_token;
  user.strava.refreshToken = res.data.refresh_token;
  user.strava.expiresAt = res.data.expires_at;
  await user.save();
  return user.strava.accessToken;
};

// --- 3. MIDDLEWARE DE SÉCURITÉ (verifyToken) ---
const verifyToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: "Accès non autorisé" });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: "Badge invalide ou expiré" });
    req.user = user; // Contient l'ID et le rôle
    next();
  });
};

// --- 4. ROUTES D'AUTHENTIFICATION ---

// Route de Login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: "Utilisateur non trouvé" });

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) return res.status(401).json({ error: "Mot de passe incorrect" });

    const token = jwt.sign(
      { id: user._id, role: user.role, username: user.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      role: user.role,
      username: user.username,
      preferences: user.preferences
    });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la connexion" });
  }
});

// --- 5. ROUTES MÉTÉO & ADMIN ---

app.get('/api/search', verifyToken, async (req, res) => {
  const { q } = req.query;
  try {
    const response = await axios.get(`https://photon.komoot.io/api/?q=${q}&limit=5`);
    res.json(response.data.features);
  } catch (error) {
    console.error("Erreur Photon:", error.message);
    res.status(500).json({ error: "Erreur recherche de lieu" });
  }
});

app.get('/api/reverse', verifyToken, async (req, res) => {
  const { lat, lon } = req.query;
  if (!lat || !lon) {
    return res.status(400).json({ error: "Paramètres lat et lon requis." });
  }
  try {
    const response = await axios.get(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}`);
    res.json(response.data.features);
  } catch (error) {
    console.error("Erreur Photon Reverse:", error.message);
    res.status(500).json({ error: "Erreur lors de la géolocalisation inversée" });
  }
});

app.get('/api/user/favorites', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('favorites');
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json(user.favorites || []);
  } catch (error) {
    console.error("Erreur GET favorites:", error.message);
    res.status(500).json({ error: "Impossible de récupérer les favoris" });
  }
});

app.post('/api/user/favorites', verifyToken, async (req, res) => {
  const { city, lat, lon } = req.body;
  if (!city || lat === undefined || lon === undefined) {
    return res.status(400).json({ error: "Ville, latitude et longitude requises." });
  }
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    
    if (!user.favorites) user.favorites = [];
    
    const exists = user.favorites.some(fav => fav.city.toLowerCase() === city.toLowerCase() || (Math.abs(fav.lat - lat) < 0.001 && Math.abs(fav.lon - lon) < 0.001));
    if (exists) {
      return res.status(400).json({ error: "Cette localisation est déjà dans vos favoris" });
    }
    
    user.favorites.push({ city, lat, lon });
    await user.save();
    res.status(201).json(user.favorites);
  } catch (error) {
    console.error("Erreur POST favorites:", error.message);
    res.status(500).json({ error: "Impossible d'ajouter aux favoris" });
  }
});

app.delete('/api/user/favorites', verifyToken, async (req, res) => {
  const { city, lat, lon } = req.query;
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    
    if (!user.favorites) user.favorites = [];
    
    const initialLength = user.favorites.length;
    user.favorites = user.favorites.filter(fav => {
      if (city && fav.city.toLowerCase() === city.toLowerCase()) return false;
      if (lat !== undefined && lon !== undefined) {
        return !(Math.abs(fav.lat - parseFloat(lat)) < 0.001 && Math.abs(fav.lon - parseFloat(lon)) < 0.001);
      }
      return true;
    });
    
    if (user.favorites.length === initialLength) {
      return res.status(404).json({ error: "Favori introuvable" });
    }
    
    await user.save();
    res.json(user.favorites);
  } catch (error) {
    console.error("Erreur DELETE favorites:", error.message);
    res.status(500).json({ error: "Impossible de supprimer des favoris" });
  }
});

const CRITERE_KEYS = ['temperature', 'pluie', 'precipitations', 'vent', 'rafales', 'uv'];

function normalizeCriteres(aiSlice, globalFavorable) {
  const raw = aiSlice?.criteres || {};
  const out = {};
  for (const k of CRITERE_KEYS) {
    let v = raw[k];
    if (v !== 'favorable' && v !== 'defavorable') {
      v = globalFavorable === true ? 'favorable' : 'neutre';
    }
    out[k] = v;
  }
  return out;
}

function enrichPeriod(aggregated, aiSlice, activity = null, useAi = true) {
  const merged = { ...aggregated, ...aiSlice };
  let originallyFavorable = (merged.favorable === true);
  merged.criteres = normalizeCriteres(aiSlice, originallyFavorable);

  // POST-PROCESSING : Forcer la probabilité de pluie à favorable si < 15%
  if (merged.rain < 15) {
    if (merged.criteres.pluie === 'defavorable') {
      merged.criteres.pluie = 'favorable';
    }
  }

  // VALIDATION STRICTE DES SEUILS NUMÉRIQUES CONFIGURÉS
  if (activity) {
    const enforceLimit = (val, min, max, key) => {
      if (val === undefined || val === null) return;
      
      // Si dépassé, défavorable obligatoire
      if (min !== null && val < min) {
        merged.criteres[key] = 'defavorable';
        return;
      }
      if (max !== null && val > max) {
        merged.criteres[key] = 'defavorable';
        return;
      }

      // Si dans les limites spécifiées, forcer à favorable (l'IA ne peut pas l'outrepasser)
      if (min !== null || max !== null) {
        merged.criteres[key] = 'favorable';
      }
    };

    enforceLimit(merged.temp, activity.tempMin, activity.tempMax, 'temperature');
    enforceLimit(merged.wind, activity.windMin, activity.windMax, 'vent');
    enforceLimit(merged.gust, activity.gustMin, activity.gustMax, 'rafales');
    enforceLimit(merged.precip, activity.precipMin, activity.precipMax, 'precipitations');
    enforceLimit(merged.uv, activity.uvMin, activity.uvMax, 'uv');
  }

  // Si le cumul de précipitations est de 0mm, les critères de pluie et de précipitations doivent être favorables
  if (merged.precip === 0) {
    merged.criteres.pluie = 'favorable';
    merged.criteres.precipitations = 'favorable';
  }

  // Déterminer si un critère strict de l'utilisateur a été violé
  let hasStrictViolation = false;
  if (activity) {
    const isViolated = (val, min, max) => {
      if (val === undefined || val === null) return false;
      if (min !== null && val < min) return true;
      if (max !== null && val > max) return true;
      return false;
    };
    if (
      isViolated(merged.temp, activity.tempMin, activity.tempMax) ||
      isViolated(merged.wind, activity.windMin, activity.windMax) ||
      isViolated(merged.gust, activity.gustMin, activity.gustMax) ||
      isViolated(merged.precip, activity.precipMin, activity.precipMax) ||
      isViolated(merged.uv, activity.uvMin, activity.uvMax)
    ) {
      hasStrictViolation = true;
    }
  }

  if (hasStrictViolation) {
    merged.favorable = false;
  } else {
    // Si aucune violation stricte de seuils configurés n'est présente
    if (originallyFavorable) {
      // Si l'IA elle-même a considéré globalement le créneau comme favorable, on respecte ce verdict
      merged.favorable = true;
    } else {
      // Si l'IA l'a mis défavorable d'origine, on regarde s'il y a un critère défavorable restant
      const hasDefavorableCritere = Object.values(merged.criteres).some(v => v === 'defavorable');
      if (hasDefavorableCritere) {
        merged.favorable = false;
      } else {
        merged.favorable = true;
      }
    }
  }

  // Nettoyage du conseil si l'IA s'est trompée sur la pluie alors qu'elle ne devrait pas (precip à 0 ou probabilité < 15%)
  if ((merged.rain < 15 || merged.precip === 0) && merged.conseil) {
    const LowerConseil = merged.conseil.toLowerCase();
    if (LowerConseil.includes('pluie') || LowerConseil.includes('précipitation') || LowerConseil.includes('averse') || LowerConseil.includes('intempérie') || LowerConseil.includes('mauvais temps')) {
      if (merged.favorable) {
         merged.conseil = "Conditions correctes, pas de pluie prévue.";
      }
    }
  }

  // Si l'évaluation a été corrigée de défavorable à favorable suite aux seuils respectés, on met un message positif générique
  if (merged.favorable && !originallyFavorable) {
    merged.conseil = "Conditions favorables pour votre activité.";
  }

  // Si l'évaluation a été corrigée de favorable à défavorable suite à une violation de seuil strict,
  // on remplace le message contradictoire de l'IA par une explication claire.
  if (!merged.favorable && (originallyFavorable || !useAi)) {
    const violations = [];
    if (activity) {
      const isViolated = (val, min, max) => {
        if (val === undefined || val === null) return false;
        if (min !== null && val < min) return true;
        if (max !== null && val > max) return true;
        return false;
      };
      if (isViolated(merged.temp, activity.tempMin, activity.tempMax)) violations.push("température inappropriée");
      if (isViolated(merged.wind, activity.windMin, activity.windMax)) violations.push("vent trop fort");
      if (isViolated(merged.gust, activity.gustMin, activity.gustMax)) violations.push("rafales de vent trop fortes");
      if (isViolated(merged.precip, activity.precipMin, activity.precipMax)) violations.push("précipitations trop importantes");
      if (isViolated(merged.uv, activity.uvMin, activity.uvMax)) violations.push("indice UV trop élevé");
    }

    if (violations.length > 0) {
      let listStr = "";
      if (violations.length === 1) {
        listStr = violations[0];
      } else if (violations.length === 2) {
        listStr = `${violations[0]} et ${violations[1]}`;
      } else {
        listStr = `${violations.slice(0, -1).join(', ')} et ${violations[violations.length - 1]}`;
      }
      merged.conseil = listStr.charAt(0).toUpperCase() + listStr.slice(1) + ".";
    } else {
      merged.conseil = "Non-respect de vos limites météo configurées.";
    }
  }

  return merged;
}

// Helper : agrège les données horaires Open-Meteo en données par demi-journée
function buildStructuredWeather(hourly, utcOffsetSeconds, activity = null) {
  const nowUtcMs = Date.now();
  const nowLocalMs = nowUtcMs + utcOffsetSeconds * 1000;
  const nowLocalStr = new Date(nowLocalMs).toISOString().slice(0, 16);

  const slot1Name = activity?.slot1Name || 'Matin';
  const slot1Start = activity?.slot1Start !== undefined ? activity.slot1Start : 8;
  const slot1End = activity?.slot1End !== undefined ? activity.slot1End : 12;
  const slot2Name = activity?.slot2Name || 'Après-midi';
  const slot2Start = activity?.slot2Start !== undefined ? activity.slot2Start : 14;
  const slot2End = activity?.slot2End !== undefined ? activity.slot2End : 19;

  const daysMap = {};
  hourly.time.forEach((t, i) => {
    if (t < nowLocalStr) return;
    const date = t.split('T')[0];
    const hour = parseInt(t.split('T')[1].split(':')[0], 10);

    if (!daysMap[date]) {
      daysMap[date] = {
        date,
        matin: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [], uvs: [] },
        apres_midi: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [], uvs: [] },
        full_day: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [], uvs: [] }
      };
    }

    daysMap[date].full_day.temps.push(hourly.temperature_2m[i]);
    daysMap[date].full_day.rains.push(hourly.precipitation_probability[i]);
    daysMap[date].full_day.precips.push(hourly.precipitation[i]);
    daysMap[date].full_day.winds.push(hourly.wind_speed_10m[i]);
    daysMap[date].full_day.gusts.push(hourly.wind_gusts_10m[i]);
    daysMap[date].full_day.dirs.push(hourly.wind_direction_10m[i]);
    daysMap[date].full_day.hours.push(hour);
    daysMap[date].full_day.uvs.push(hourly.uv_index[i]);

    if (hour >= slot1Start && hour <= slot1End) {
      daysMap[date].matin.temps.push(hourly.temperature_2m[i]);
      daysMap[date].matin.rains.push(hourly.precipitation_probability[i]);
      daysMap[date].matin.precips.push(hourly.precipitation[i]);
      daysMap[date].matin.winds.push(hourly.wind_speed_10m[i]);
      daysMap[date].matin.gusts.push(hourly.wind_gusts_10m[i]);
      daysMap[date].matin.dirs.push(hourly.wind_direction_10m[i]);
      daysMap[date].matin.hours.push(hour);
      daysMap[date].matin.uvs.push(hourly.uv_index[i]);
    } else if (hour >= slot2Start && hour <= slot2End) {
      daysMap[date].apres_midi.temps.push(hourly.temperature_2m[i]);
      daysMap[date].apres_midi.rains.push(hourly.precipitation_probability[i]);
      daysMap[date].apres_midi.precips.push(hourly.precipitation[i]);
      daysMap[date].apres_midi.winds.push(hourly.wind_speed_10m[i]);
      daysMap[date].apres_midi.gusts.push(hourly.wind_gusts_10m[i]);
      daysMap[date].apres_midi.dirs.push(hourly.wind_direction_10m[i]);
      daysMap[date].apres_midi.hours.push(hour);
      daysMap[date].apres_midi.uvs.push(hourly.uv_index[i]);
    }
  });

  const aggregate = (period, label) => {
    if (!period || period.temps.length === 0) return null;
    const hourlyData = period.hours.map((h, i) => ({
      hour: h,
      temp: Math.round(period.temps[i]),
      rain: period.rains[i],
      precip: Number(period.precips[i].toFixed(1)),
      wind: Math.round(period.winds[i]),
      gust: Math.round(period.gusts[i]),
      dir: period.dirs[i],
      uv: Number((period.uvs[i] || 0).toFixed(1))
    }));
    return {
      label,
      temp: Math.round(Math.max(...period.temps)),
      minTemp: Math.round(Math.min(...period.temps)),
      rain: Math.max(...period.rains),
      precip: Number(period.precips.reduce((sum, current) => sum + current, 0).toFixed(1)),
      wind: Math.round(Math.max(...period.winds)),
      gust: Math.round(Math.max(...period.gusts)),
      dir: period.dirs[Math.floor(period.dirs.length / 2)],
      uv: Number(Math.max(...(period.uvs.length > 0 ? period.uvs : [0])).toFixed(1)),
      hourly: hourlyData
    };
  };

  return Object.values(daysMap)
    .map(d => ({
      date: d.date,
      matin: aggregate(d.matin, slot1Name),
      apres_midi: aggregate(d.apres_midi, slot2Name),
      full_day: aggregate(d.full_day, 'Journée')
    }))
    .filter(d => d.matin !== null || d.apres_midi !== null)
    .slice(0, 7);
}

// Helper : adapte les données horaires met.no (GeoJSON timeseries) au même format que buildStructuredWeather()
function buildStructuredWeatherMetNo(timeseries, utcOffsetSeconds, activity = null) {
  const nowUtcMs = Date.now();
  const nowLocalMs = nowUtcMs + utcOffsetSeconds * 1000;
  const nowLocalStr = new Date(nowLocalMs).toISOString().slice(0, 16);

  const slot1Name = activity?.slot1Name || 'Matin';
  const slot1Start = activity?.slot1Start !== undefined ? activity.slot1Start : 8;
  const slot1End = activity?.slot1End !== undefined ? activity.slot1End : 12;
  const slot2Name = activity?.slot2Name || 'Après-midi';
  const slot2Start = activity?.slot2Start !== undefined ? activity.slot2Start : 14;
  const slot2End = activity?.slot2End !== undefined ? activity.slot2End : 19;

  const daysMap = {};
  for (const entry of timeseries) {
    // Convertir l'heure UTC en heure locale
    const utcMs = new Date(entry.time).getTime();
    const localMs = utcMs + utcOffsetSeconds * 1000;
    const localIso = new Date(localMs).toISOString();
    const localStr = localIso.slice(0, 16); // YYYY-MM-DDTHH:MM

    if (localStr < nowLocalStr) continue;

    const date = localStr.split('T')[0];
    const hour = parseInt(localStr.split('T')[1].split(':')[0], 10);

    const instant = entry.data?.instant?.details || {};
    const next1h = entry.data?.next_1_hours?.details || {};

    // Conversions : m/s → km/h (×3.6)
    const windKmh = instant.wind_speed != null ? instant.wind_speed * 3.6 : 0;
    const gustKmh = instant.wind_speed_of_gust != null ? instant.wind_speed_of_gust * 3.6 : windKmh;
    const temp = instant.air_temperature ?? 0;
    const dir = instant.wind_from_direction ?? 0;
    const uv = instant.ultraviolet_index_clear_sky ?? 0;
    const precip = next1h.precipitation_amount ?? 0;
    // probability_of_precipitation est souvent absent — on l'estime si besoin
    let rain = next1h.probability_of_precipitation ?? null;
    if (rain === null) {
      rain = precip === 0 ? 0 : (precip < 0.3 ? 20 : precip < 1 ? 50 : 80);
    }

    if (!daysMap[date]) {
      daysMap[date] = {
        date,
        matin: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [], uvs: [] },
        apres_midi: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [], uvs: [] },
        full_day: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [], uvs: [] }
      };
    }

    daysMap[date].full_day.temps.push(temp);
    daysMap[date].full_day.rains.push(rain);
    daysMap[date].full_day.precips.push(precip);
    daysMap[date].full_day.winds.push(windKmh);
    daysMap[date].full_day.gusts.push(gustKmh);
    daysMap[date].full_day.dirs.push(dir);
    daysMap[date].full_day.hours.push(hour);
    daysMap[date].full_day.uvs.push(uv);

    if (hour >= slot1Start && hour <= slot1End) {
      daysMap[date].matin.temps.push(temp);
      daysMap[date].matin.rains.push(rain);
      daysMap[date].matin.precips.push(precip);
      daysMap[date].matin.winds.push(windKmh);
      daysMap[date].matin.gusts.push(gustKmh);
      daysMap[date].matin.dirs.push(dir);
      daysMap[date].matin.hours.push(hour);
      daysMap[date].matin.uvs.push(uv);
    } else if (hour >= slot2Start && hour <= slot2End) {
      daysMap[date].apres_midi.temps.push(temp);
      daysMap[date].apres_midi.rains.push(rain);
      daysMap[date].apres_midi.precips.push(precip);
      daysMap[date].apres_midi.winds.push(windKmh);
      daysMap[date].apres_midi.gusts.push(gustKmh);
      daysMap[date].apres_midi.dirs.push(dir);
      daysMap[date].apres_midi.hours.push(hour);
      daysMap[date].apres_midi.uvs.push(uv);
    }
  }

  const aggregate = (period, label) => {
    if (!period || period.temps.length === 0) return null;
    const hourlyData = period.hours.map((h, i) => ({
      hour: h,
      temp: Math.round(period.temps[i]),
      rain: period.rains[i],
      precip: Number(period.precips[i].toFixed(1)),
      wind: Math.round(period.winds[i]),
      gust: Math.round(period.gusts[i]),
      dir: period.dirs[i],
      uv: Number((period.uvs[i] || 0).toFixed(1))
    }));
    return {
      label,
      temp: Math.round(Math.max(...period.temps)),
      minTemp: Math.round(Math.min(...period.temps)),
      rain: Math.max(...period.rains),
      precip: Number(period.precips.reduce((sum, current) => sum + current, 0).toFixed(1)),
      wind: Math.round(Math.max(...period.winds)),
      gust: Math.round(Math.max(...period.gusts)),
      dir: period.dirs[Math.floor(period.dirs.length / 2)],
      uv: Number(Math.max(...(period.uvs.length > 0 ? period.uvs : [0])).toFixed(1)),
      hourly: hourlyData
    };
  };

  return Object.values(daysMap)
    .map(d => ({
      date: d.date,
      matin: aggregate(d.matin, slot1Name),
      apres_midi: aggregate(d.apres_midi, slot2Name),
      full_day: aggregate(d.full_day, 'Journée')
    }))
    .filter(d => d.matin !== null || d.apres_midi !== null)
    .slice(0, 7);
}

// --- ROUTE MÉTÉO BRUTE (étape 1 : retourne la météo agrégée sans analyse IA) ---
app.post('/api/weather', verifyToken, async (req, res) => {
  const { lat, lon, activityId } = req.body;
  if (!lat || !lon) return res.status(400).json({ error: "lat et lon sont obligatoires" });

  try {
    let activity = null;
    if (activityId && activityId !== 'none') {
      try {
        const user = await User.findById(req.user.id).select('activities');
        if (user) {
          activity = user.activities.id(activityId);
        }
      } catch (err) {
        console.error("Erreur récupération activité pour structuring:", err);
      }
    }

    // Lire le fournisseur météo configuré par l'admin
    let weatherProvider = 'open-meteo';
    try {
      const providerSetting = await SystemSetting.findOne({ key: 'weather_provider' });
      if (providerSetting?.value) weatherProvider = providerSetting.value;
    } catch (err) {
      console.error("Erreur lecture weather_provider:", err);
    }

    let structuredWeather;
    let currentConditions = null;

    const fetchFromMetNo = async () => {
      // 1. Récupérer l'offset UTC via Open-Meteo (requête minimale) avec fallback robuste
      let utcOffsetSeconds = Math.round(Number(lon) / 15) * 3600;
      try {
        const tzUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=1&timezone=auto`;
        const tzRes = await axios.get(tzUrl);
        if (tzRes.data && tzRes.data.utc_offset_seconds !== undefined) {
          utcOffsetSeconds = tzRes.data.utc_offset_seconds;
        }
      } catch (tzErr) {
        console.warn("Impossible de récupérer l'offset UTC depuis Open-Meteo pour met.no, estimation basée sur la longitude :", tzErr.message);
      }

      // 2. Récupérer les données météo depuis met.no (complete pour avoir l'indice UV et les rafales)
      const formattedLat = Number(lat).toFixed(4);
      const formattedLon = Number(lon).toFixed(4);
      const metNoUrl = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${formattedLat}&lon=${formattedLon}`;
      const metNoRes = await axios.get(metNoUrl, {
        headers: {
          'User-Agent': 'meteo-velo/1.0 github.com/jhenninot/meteo-velo'
        }
      });
      const timeseries = metNoRes.data?.properties?.timeseries;
      if (!timeseries || !Array.isArray(timeseries)) {
        throw new Error("Données met.no invalides");
      }

      if (timeseries.length > 0) {
        const currentEntry = timeseries[0];
        const instant = currentEntry.data?.instant?.details || {};
        const next1h = currentEntry.data?.next_1_hours?.details || {};
        const temp = instant.air_temperature;
        const rh = instant.relative_humidity;
        const windSpeed = instant.wind_speed;
        const windKmh = windSpeed !== undefined ? Math.round(windSpeed * 3.6) : 0;
        const gustKmh = instant.wind_speed_of_gust !== undefined ? Math.round(instant.wind_speed_of_gust * 3.6) : windKmh;
        const windDir = instant.wind_from_direction !== undefined ? instant.wind_from_direction : 0;
        const precip = next1h.precipitation_amount !== undefined ? Number(next1h.precipitation_amount.toFixed(1)) : 0;

        let apparentTemp = temp;
        if (temp !== undefined && rh !== undefined && windSpeed !== undefined) {
          const v = windSpeed;
          const e = (rh / 100) * 6.105 * Math.exp((17.27 * temp) / (237.7 + temp));
          const at = temp + 0.33 * e - 0.7 * v - 4.0;
          apparentTemp = Math.round(at);
        }

        currentConditions = {
          temp: temp !== undefined ? Math.round(temp) : null,
          apparentTemp: apparentTemp !== undefined ? Math.round(apparentTemp) : null,
          precip,
          wind: windKmh,
          windDir,
          gust: gustKmh,
          rain: precip > 0 ? 100 : 0
        };
      }

      return buildStructuredWeatherMetNo(timeseries, utcOffsetSeconds, activity);
    };

    const fetchFromOpenMeteo = async () => {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m&timezone=auto`;
      const weatherRes = await axios.get(weatherUrl);
      const hourly = weatherRes.data.hourly;
      const utcOffsetSeconds = weatherRes.data.utc_offset_seconds ?? 0;

      if (weatherRes.data.current) {
        const cur = weatherRes.data.current;
        currentConditions = {
          temp: Math.round(cur.temperature_2m),
          apparentTemp: Math.round(cur.apparent_temperature),
          precip: cur.precipitation !== undefined ? Number(cur.precipitation.toFixed(1)) : 0,
          wind: cur.wind_speed_10m !== undefined ? Math.round(cur.wind_speed_10m) : 0,
          windDir: cur.wind_direction_10m !== undefined ? cur.wind_direction_10m : 0,
          gust: cur.wind_gusts_10m !== undefined ? Math.round(cur.wind_gusts_10m) : 0,
          rain: cur.precipitation > 0 ? 100 : 0
        };
      }

      return buildStructuredWeather(hourly, utcOffsetSeconds, activity);
    };

    let actualProviderUsed = weatherProvider;

    if (weatherProvider === 'met.no') {
      try {
        structuredWeather = await fetchFromMetNo();
        actualProviderUsed = 'met.no';
      } catch (err) {
        console.warn("Erreur de récupération depuis met.no, bascule automatique sur Open-Meteo :", err.message);
        structuredWeather = await fetchFromOpenMeteo();
        actualProviderUsed = 'open-meteo';
      }
    } else {
      try {
        structuredWeather = await fetchFromOpenMeteo();
        actualProviderUsed = 'open-meteo';
      } catch (err) {
        console.warn("Erreur de récupération depuis Open-Meteo, bascule automatique sur met.no :", err.message);
        structuredWeather = await fetchFromMetNo();
        actualProviderUsed = 'met.no';
      }
    }

    res.json({ weather: structuredWeather, current: currentConditions, provider: actualProviderUsed });
  } catch (error) {
    console.error("Erreur /api/weather:", error);
    res.status(500).json({ error: "Impossible de récupérer la météo" });
  }
});

// --- ROUTE ANALYSE IA (étape 2 : reçoit la météo brute + activityId, retourne l'analyse enrichie) ---
app.post('/api/analyze', verifyToken, async (req, res) => {
  const { city, activityId, structuredWeather, useAi } = req.body;
  let activityLabel = '';
  let userRules = '';
  let activity = null;

  try {
    if (!activityId) return res.status(400).json({ error: "L'activité est obligatoire" });
    if (!structuredWeather || !Array.isArray(structuredWeather)) return res.status(400).json({ error: "Les données météo sont obligatoires" });

    if (activityId === 'none') {
      activityLabel = 'plein air';
      userRules = '';
    } else {
      const user = await User.findById(req.user.id).select('activities');
      if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
      activity = user.activities.id(activityId);
      if (!activity) return res.status(404).json({ error: "Activité introuvable" });
      activityLabel = activity.label;
      userRules = (activity.constraints || '').trim();
    }

    if (useAi === false) {
      const finalData = structuredWeather.map(day => {
        return {
          date: day.date,
          matin: day.matin ? enrichPeriod(day.matin, {}, activity, false) : null,
          apres_midi: day.apres_midi ? enrichPeriod(day.apres_midi, {}, activity, false) : null,
          full_day: day.full_day
        };
      });
      return res.json({
        forecast: finalData,
        useAi: false
      });
    }

    let activeModel = 'gemini-3.1-flash-lite';
    let fallbackModel = 'gemini-3.5-flash';
    try {
      const settings = await SystemSetting.find({ key: { $in: ['gemini_model', 'gemini_fallback_model'] } });
      settings.forEach(s => {
        if (s.key === 'gemini_model' && s.value) activeModel = s.value;
        if (s.key === 'gemini_fallback_model' && s.value) fallbackModel = s.value;
      });
    } catch (err) {
      console.error("Erreur de lecture des modèles Gemini configurés :", err);
    }

    // Nettoyer structuredWeather pour n'envoyer que matin et apres_midi (et sans hourly pour réduire les tokens)
    const weatherForAi = structuredWeather.map(day => {
      const cleanPeriod = (period) => {
        if (!period) return null;
        const { hourly, ...rest } = period;
        return rest;
      };
      return {
        date: day.date,
        matin: cleanPeriod(day.matin),
        apres_midi: cleanPeriod(day.apres_midi)
      };
    });

    const slot1Name = activity?.slot1Name || 'Matin';
    const slot1Start = activity?.slot1Start !== undefined ? activity.slot1Start : 8;
    const slot1End = activity?.slot1End !== undefined ? activity.slot1End : 12;
    const slot2Name = activity?.slot2Name || 'Après-midi';
    const slot2Start = activity?.slot2Start !== undefined ? activity.slot2Start : 14;
    const slot2End = activity?.slot2End !== undefined ? activity.slot2End : 19;

    let prompt = `Tu es un algorithme de filtrage intransigeant pour l'activité suivante : ${activityLabel}. Voici la météo agrégée (Matin / Après-midi) pour ${city} : ${JSON.stringify(weatherForAi)}`;
    prompt += `\nNote : La période "matin" correspond au créneau "${slot1Name}" (de ${slot1Start}h à ${slot1End}h). La période "apres_midi" correspond au créneau "${slot2Name}" (de ${slot2Start}h à ${slot2End}h). Dans tes commentaires/conseils, réfère-toi à ces créneaux en utilisant leurs noms personnalisés ("${slot1Name}" et "${slot2Name}") plutôt que "matin" et "après-midi" si possible, et base ton jugement strictement sur les heures spécifiées. Ne mentionne pas de valeurs numériques spécifiques dans le conseil pour les limites strictes de vent/température/précipitations/uv.\n`;

    if (activity) {
      const numericRules = [];
      if (activity.tempMin !== null || activity.tempMax !== null) {
        numericRules.push(`- Température : min ${activity.tempMin !== null ? activity.tempMin + '°C' : 'non défini'} / max ${activity.tempMax !== null ? activity.tempMax + '°C' : 'non défini'}`);
      }
      if (activity.windMin !== null || activity.windMax !== null) {
        numericRules.push(`- Vent : min ${activity.windMin !== null ? activity.windMin + ' km/h' : 'non défini'} / max ${activity.windMax !== null ? activity.windMax + ' km/h' : 'non défini'}`);
      }
      if (activity.gustMin !== null || activity.gustMax !== null) {
        numericRules.push(`- Rafales de vent : min ${activity.gustMin !== null ? activity.gustMin + ' km/h' : 'non défini'} / max ${activity.gustMax !== null ? activity.gustMax + ' km/h' : 'non défini'}`);
      }
      if (activity.precipMin !== null || activity.precipMax !== null) {
        numericRules.push(`- Cumul de précipitations : min ${activity.precipMin !== null ? activity.precipMin + ' mm' : 'non défini'} / max ${activity.precipMax !== null ? activity.precipMax + ' mm' : 'non défini'}`);
      }
      if (activity.uvMin !== null || activity.uvMax !== null) {
        numericRules.push(`- Indice UV : min ${activity.uvMin !== null ? activity.uvMin : 'non défini'} / max ${activity.uvMax !== null ? activity.uvMax : 'non défini'}`);
      }

      if (numericRules.length > 0) {
        prompt += `
LIMITES MÉTÉO NUMÉRIQUES DE L'ACTIVITÉ (CRITÈRES STRICTES) :
${numericRules.join('\n')}
Tu DOIS impérativement mettre "favorable": false pour la demi-journée et positionner le critère correspondant sur "defavorable" si les conditions dépassent ou sont en dessous de ces limites strictes. Inversement, si les conditions respectent ces limites strictes, tu DOIS marquer le critère correspondant comme "favorable". Tu ne dois pas déclarer un critère ou la demi-journée défavorable pour une valeur qui respecte les limites définies par l'utilisateur.`;
      }
    }

    if (userRules !== "") {
      prompt += `
CONTRAINTES DE L'ACTIVITé :
"""${userRules}"""
Tu DOIS mettre "favorable": false si une contrainte est enfreinte.`;
    }

    prompt += `
            RÈGLES D'ANALYSE PRÉCISES :
            - PRÉCIPITATIONS / PLUIE : Si le cumul de précipitations (precip) est de 0mm, ces deux critères (pluie et precipitations) DOIVENT obligatoirement être marqués comme "favorable" et ne doivent pas rendre l'analyse de la demi-journée défavorable. Dans ton "conseil", ne mentionne pas de risque de pluie ou d'intempéries liées à la pluie, et ne déconseille surtout pas la sortie pour ce motif si le cumul de précipitations est de 0mm (même si la probabilité de pluie/rain est non nulle).
            - SEUIL DE TOLÉRANCE : Considère que moins de 0.5mm sur une demi-journée est négligeable.
            - VENT : Sois intransigeant sur les rafales (gust) par rapport aux consignes de l'utilisateur.
            - INDICE UV : Analyse si l'indice UV (uv) nécessite des conseils spécifiques (ex: crème solaire / protection si UV >= 6).
            - TON : Reste factuel et encourageant si les conditions sont à la limite.
            
            Pour CHAQUE JOUR et CHAQUE demi-journée (matin / apres_midi), détermine "favorable" true ou false en respectant STRICTEMENT les consignes.
            Tu DOIS aussi remplir "criteres" (voir ci-dessous) : pour chaque critère, indique "favorable" si ce facteur ne milite pas contre la sortie vélo/sport, "defavorable" s'il contribue au refus ou au verdict défavorable.
            Correspondance avec les chiffres fournis : temperature = temp (°C max), pluie = rain (% max), precipitations = precip (mm cumul), vent = wind (km/h max), rafales = gust (km/h max), uv = uv (indice max).
            Si la demi-journée est favorable, tous les critères doivent être "favorable" sauf si un critère reste objectivement limite (dans ce cas mets "favorable": false et le ou les critères concernés en "defavorable").
            Si la demi-journée est défavorable, au moins un critère doit être "defavorable" (tous ceux qui expliquent le verdict).
            `;

    prompt += `
Réponds EXCLUSIVEMENT par un tableau JSON (sans markdown), un objet par jour, dans l'ordre des dates. Structure exacte pour chaque jour :
{"date":"YYYY-MM-DD","matin":{"favorable":true,"conseil":"...","criteres":{"temperature":"favorable","pluie":"favorable","precipitations":"favorable","vent":"favorable","rafales":"favorable","uv":"favorable"}},"apres_midi":{"favorable":true,"conseil":"...","criteres":{"temperature":"favorable","pluie":"favorable","precipitations":"favorable","vent":"favorable","rafales":"favorable","uv":"favorable"}}}
Les valeurs dans criteres sont uniquement les chaînes "favorable" ou "defavorable" (pas d'autres valeurs).
`;

    const callGemini = async (modelName) => {
      const m = genAI.getGenerativeModel({ model: modelName });
      const result = await m.generateContent(prompt);
      const responseText = result.response.text();
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("JSON IA invalide");
      return JSON.parse(jsonMatch[0]);
    };

    let aiData;
    let fallback = false;

    try {
      aiData = await callGemini(activeModel);
    } catch (aiErr) {
      console.error(`Erreur modèle ${activeModel} :`, aiErr.message);
      console.warn(`Bascule vers ${fallbackModel}...`);
      aiData = await callGemini(fallbackModel);
      fallback = true;
    }

    const finalData = structuredWeather.map(day => {
      const ai = aiData.find(a => a.date === day.date) || { matin: {}, apres_midi: {} };
      return {
        date: day.date,
        matin: day.matin ? enrichPeriod(day.matin, ai.matin || {}, activity) : null,
        apres_midi: day.apres_midi ? enrichPeriod(day.apres_midi, ai.apres_midi || {}, activity) : null,
        full_day: day.full_day
      };
    });

    res.json({
      forecast: finalData,
      fallback,
      fallbackMessage: fallback
        ? `Le modèle ${activeModel} est temporairement indisponible. L'analyse a été réalisée avec ${fallbackModel}.`
        : null
    });

  } catch (error) {
    console.error("Erreur /api/analyze:", error);
    res.status(500).json({ error: "Erreur analyse IA" });
  }
});

// --- ROUTE LEGACY /api/forecast (conservée pour compatibilité cache) ---
app.post('/api/forecast', verifyToken, async (req, res) => {
  const { lat, lon, city, activityId, useAi } = req.body;
  let activityLabel = '';
  let userRules = '';
  let activity = null;

  try {
    if (!activityId) return res.status(400).json({ error: "L'activité est obligatoire" });

    if (activityId === 'none') {
      activityLabel = 'plein air';
      userRules = '';
    } else {
      const user = await User.findById(req.user.id).select('activities');
      if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
      activity = user.activities.id(activityId);
      if (!activity) return res.status(404).json({ error: "Activité introuvable" });
      activityLabel = activity.label;
      userRules = (activity.constraints || '').trim();
    }

    // Lire le fournisseur météo configuré par l'admin
    let weatherProvider = 'open-meteo';
    try {
      const providerSetting = await SystemSetting.findOne({ key: 'weather_provider' });
      if (providerSetting?.value) weatherProvider = providerSetting.value;
    } catch (err) {
      console.error("Erreur lecture weather_provider:", err);
    }

    let structuredWeather;

    const fetchFromMetNo = async () => {
      // 1. Récupérer l'offset UTC via Open-Meteo (requête minimale) avec fallback robuste
      let utcOffsetSeconds = Math.round(Number(lon) / 15) * 3600;
      try {
        const tzUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m&forecast_days=1&timezone=auto`;
        const tzRes = await axios.get(tzUrl);
        if (tzRes.data && tzRes.data.utc_offset_seconds !== undefined) {
          utcOffsetSeconds = tzRes.data.utc_offset_seconds;
        }
      } catch (tzErr) {
        console.warn("Impossible de récupérer l'offset UTC depuis Open-Meteo pour met.no, estimation basée sur la longitude :", tzErr.message);
      }

      // 2. Récupérer les données météo depuis met.no (complete pour avoir l'indice UV et les rafales)
      const formattedLat = Number(lat).toFixed(4);
      const formattedLon = Number(lon).toFixed(4);
      const metNoUrl = `https://api.met.no/weatherapi/locationforecast/2.0/complete?lat=${formattedLat}&lon=${formattedLon}`;
      const metNoRes = await axios.get(metNoUrl, {
        headers: {
          'User-Agent': 'meteo-velo/1.0 github.com/jhenninot/meteo-velo'
        }
      });
      const timeseries = metNoRes.data?.properties?.timeseries;
      if (!timeseries || !Array.isArray(timeseries)) {
        throw new Error("Données met.no invalides");
      }
      return buildStructuredWeatherMetNo(timeseries, utcOffsetSeconds, activity);
    };

    const fetchFromOpenMeteo = async () => {
      const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index&timezone=auto`;
      const weatherRes = await axios.get(weatherUrl);
      const hourly = weatherRes.data.hourly;
      const utcOffsetSeconds = weatherRes.data.utc_offset_seconds ?? 0;
      return buildStructuredWeather(hourly, utcOffsetSeconds, activity);
    };

    let actualProviderUsed = weatherProvider;

    if (weatherProvider === 'met.no') {
      try {
        structuredWeather = await fetchFromMetNo();
        actualProviderUsed = 'met.no';
      } catch (err) {
        console.warn("Erreur de récupération depuis met.no, bascule automatique sur Open-Meteo :", err.message);
        structuredWeather = await fetchFromOpenMeteo();
        actualProviderUsed = 'open-meteo';
      }
    } else {
      try {
        structuredWeather = await fetchFromOpenMeteo();
        actualProviderUsed = 'open-meteo';
      } catch (err) {
        console.warn("Erreur de récupération depuis Open-Meteo, bascule automatique sur met.no :", err.message);
        structuredWeather = await fetchFromMetNo();
        actualProviderUsed = 'met.no';
      }
    }

    if (useAi === false) {
      const finalData = structuredWeather.map(day => {
        return {
          date: day.date,
          matin: day.matin ? enrichPeriod(day.matin, {}, activity, false) : null,
          apres_midi: day.apres_midi ? enrichPeriod(day.apres_midi, {}, activity, false) : null,
          full_day: day.full_day
        };
      });
      return res.json({
        forecast: finalData,
        useAi: false,
        provider: actualProviderUsed
      });
    }

    let activeModel = 'gemini-3.1-flash-lite';
    let fallbackModel = 'gemini-3.5-flash';
    try {
      const settings = await SystemSetting.find({ key: { $in: ['gemini_model', 'gemini_fallback_model'] } });
      settings.forEach(s => {
        if (s.key === 'gemini_model' && s.value) activeModel = s.value;
        if (s.key === 'gemini_fallback_model' && s.value) fallbackModel = s.value;
      });
    } catch (err) {
      console.error("Erreur de lecture des modèles Gemini configurés :", err);
    }

    // Nettoyer structuredWeather pour n'envoyer que matin et apres_midi (et sans hourly pour réduire les tokens)
    const weatherForAi = structuredWeather.map(day => {
      const cleanPeriod = (period) => {
        if (!period) return null;
        const { hourly, ...rest } = period;
        return rest;
      };
      return {
        date: day.date,
        matin: cleanPeriod(day.matin),
        apres_midi: cleanPeriod(day.apres_midi)
      };
    });

    const slot1Name = activity?.slot1Name || 'Matin';
    const slot1Start = activity?.slot1Start !== undefined ? activity.slot1Start : 8;
    const slot1End = activity?.slot1End !== undefined ? activity.slot1End : 12;
    const slot2Name = activity?.slot2Name || 'Après-midi';
    const slot2Start = activity?.slot2Start !== undefined ? activity.slot2Start : 14;
    const slot2End = activity?.slot2End !== undefined ? activity.slot2End : 19;

    let prompt = `Tu es un algorithme de filtrage intransigeant pour l'activité suivante : ${activityLabel}. Voici la météo agrégée (Matin / Après-midi) pour ${city} : ${JSON.stringify(weatherForAi)}`;
    prompt += `\nNote : La période "matin" correspond au créneau "${slot1Name}" (de ${slot1Start}h à ${slot1End}h). La période "apres_midi" correspond au créneau "${slot2Name}" (de ${slot2Start}h à ${slot2End}h). Dans tes commentaires/conseils, réfère-toi à ces créneaux en utilisant leurs noms personnalisés ("${slot1Name}" et "${slot2Name}") plutôt que "matin" et "après-midi" si possible, et base ton jugement strictement sur les heures spécifiées. Ne mentionne pas de valeurs numériques spécifiques dans le conseil pour les limites strictes de vent/température/précipitations/uv.\n`;

    if (activity) {
      const numericRules = [];
      if (activity.tempMin !== null || activity.tempMax !== null) {
        numericRules.push(`- Température : min ${activity.tempMin !== null ? activity.tempMin + '°C' : 'non défini'} / max ${activity.tempMax !== null ? activity.tempMax + '°C' : 'non défini'}`);
      }
      if (activity.windMin !== null || activity.windMax !== null) {
        numericRules.push(`- Vent : min ${activity.windMin !== null ? activity.windMin + ' km/h' : 'non défini'} / max ${activity.windMax !== null ? activity.windMax + ' km/h' : 'non défini'}`);
      }
      if (activity.gustMin !== null || activity.gustMax !== null) {
        numericRules.push(`- Rafales de vent : min ${activity.gustMin !== null ? activity.gustMin + ' km/h' : 'non défini'} / max ${activity.gustMax !== null ? activity.gustMax + ' km/h' : 'non défini'}`);
      }
      if (activity.precipMin !== null || activity.precipMax !== null) {
        numericRules.push(`- Cumul de précipitations : min ${activity.precipMin !== null ? activity.precipMin + ' mm' : 'non défini'} / max ${activity.precipMax !== null ? activity.precipMax + ' mm' : 'non défini'}`);
      }
      if (activity.uvMin !== null || activity.uvMax !== null) {
        numericRules.push(`- Indice UV : min ${activity.uvMin !== null ? activity.uvMin : 'non défini'} / max ${activity.uvMax !== null ? activity.uvMax : 'non défini'}`);
      }

      if (numericRules.length > 0) {
        prompt += `
LIMITES MÉTÉO NUMÉRIQUES DE L'ACTIVITÉ (CRITÈRES STRICTES) :
${numericRules.join('\n')}
Tu DOIS impérativement mettre "favorable": false pour la demi-journée et positionner le critère correspondant sur "defavorable" si les conditions dépassent ou sont en dessous de ces limites strictes. Inversement, si les conditions respectent ces limites strictes, tu DOIS marquer le critère correspondant comme "favorable". Tu ne dois pas déclarer un critère ou la demi-journée défavorable pour une valeur qui respecte les limites définies par l'utilisateur.`;
      }
    }

    if (userRules !== "") {
      prompt += `
CONTRAINTES DE L'ACTIVITé :
"""${userRules}"""
Tu DOIS mettre "favorable": false si une contrainte est enfreinte.`;
    }

    prompt += `
            RÈGLES D'ANALYSE PRÉCISES :
            - PRÉCIPITATIONS / PLUIE : Si le cumul de précipitations (precip) est de 0mm, ces deux critères (pluie et precipitations) DOIVENT obligatoirement être marqués comme "favorable" et ne doivent pas rendre l'analyse de la demi-journée défavorable. Dans ton "conseil", ne mentionne pas de risque de pluie ou d'intempéries liées à la pluie, et ne déconseille surtout pas la sortie pour ce motif si le cumul de précipitations est de 0mm (même si la probabilité de pluie/rain est non nulle).
            - SEUIL DE TOLÉRANCE : Considère que moins de 0.5mm sur une demi-journée est négligeable.
            - VENT : Sois intransigeant sur les rafales (gust) par rapport aux consignes de l'utilisateur.
            - INDICE UV : Analyse si l'indice UV (uv) nécessite des conseils spécifiques (ex: crème solaire / protection si UV >= 6).
            - TON : Reste factuel et encourageant si les conditions sont à la limite.
            
            Pour CHAQUE JOUR et CHAQUE demi-journée (matin / apres_midi), détermine "favorable" true ou false en respectant STRICTEMENT les consignes.
            Tu DOIS aussi remplir "criteres" (voir ci-dessous) : pour chaque critère, indique "favorable" si ce facteur ne milite pas contre la sortie vélo/sport, "defavorable" s'il contribue au refus ou au verdict défavorable.
            Correspondance avec les chiffres fournis : temperature = temp (°C max), pluie = rain (% max), precipitations = precip (mm cumul), vent = wind (km/h max), rafales = gust (km/h max), uv = uv (indice max).
            Si la demi-journée est favorable, tous les critères doivent être "favorable" sauf si un critère reste objectivement limite (dans ce cas mets "favorable": false et le ou les critères concernés en "defavorable").
            Si la demi-journée est défavorable, au moins un critère doit être "defavorable" (tous ceux qui expliquent le verdict).
            `;

    prompt += `
Réponds EXCLUSIVEMENT par un tableau JSON (sans markdown), un objet par jour, dans l'ordre des dates. Structure exacte pour chaque jour :
{"date":"YYYY-MM-DD","matin":{"favorable":true,"conseil":"...","criteres":{"temperature":"favorable","pluie":"favorable","precipitations":"favorable","vent":"favorable","rafales":"favorable","uv":"favorable"}},"apres_midi":{"favorable":true,"conseil":"...","criteres":{"temperature":"favorable","pluie":"favorable","precipitations":"favorable","vent":"favorable","rafales":"favorable","uv":"favorable"}}}
Les valeurs dans criteres sont uniquement les chaînes "favorable" ou "defavorable" (pas d'autres valeurs).
`;

    const callGemini = async (modelName) => {
      const m = genAI.getGenerativeModel({ model: modelName });
      const result = await m.generateContent(prompt);
      const responseText = result.response.text();
      const jsonMatch = responseText.match(/\[[\s\S]*\]/);
      if (!jsonMatch) throw new Error("JSON IA invalide");
      return JSON.parse(jsonMatch[0]);
    };

    let aiData;
    let fallback = false;

    try {
      aiData = await callGemini(activeModel);
    } catch (aiErr) {
      console.error(`Erreur modèle ${activeModel} :`, aiErr.message);
      console.warn(`Bascule vers ${fallbackModel}...`);
      aiData = await callGemini(fallbackModel);
      fallback = true;
    }

    const finalData = structuredWeather.map(day => {
      const ai = aiData.find(a => a.date === day.date) || { matin: {}, apres_midi: {} };
      return {
        date: day.date,
        matin: day.matin ? enrichPeriod(day.matin, ai.matin || {}, activity) : null,
        apres_midi: day.apres_midi ? enrichPeriod(day.apres_midi, ai.apres_midi || {}, activity) : null,
        full_day: day.full_day
      };
    });

    res.json({
      forecast: finalData,
      fallback,
      fallbackMessage: fallback
        ? `Le modèle ${activeModel} est temporairement indisponible. L'analyse a été réalisée avec ${fallbackModel}.`
        : null,
      provider: actualProviderUsed
    });

  } catch (error) {
    console.error("Erreur API:", error);
    res.status(500).json({ error: "Erreur analyse" });
  }
});

// Route Admin : Créer un utilisateur
app.post('/api/admin/create-user', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Accès refusé (Admin requis)" });

  const { username, password, role } = req.body;
  if (!validatePasswordStrength(password)) return res.status(400).json({ error: PASSWORD_RULES_MESSAGE });
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({ 
      username, 
      password: hashedPassword, 
      role,
      activities: [{
        label: "Course à pied",
        icon: "mdi-run",
        stravaSportType: "Run",
        tempMin: 10,
        tempMax: 28,
        precipMax: 0.1,
        constraints: ""
      }],
      preferences: {
        useAiAnalysis: false
      }
    });
    await newUser.save();
    res.json({ message: "Utilisateur créé avec succès" });
  } catch (err) {
    res.status(400).json({ error: "L'utilisateur existe déjà" });
  }
});

// Préférences utilisateur (lecture)
app.get('/api/user/preferences', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('preferences');
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json(user.preferences || {});
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la lecture des préférences" });
  }
});

// Route Utilisateur : Sauvegarder préférences (fusion avec l'existant)
app.post('/api/user/preferences', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    const prev = user.preferences?.toObject?.() ?? user.preferences ?? {};
    user.preferences = { ...prev, ...req.body };
    await user.save();
    res.json({ message: "Préférences sauvegardées" });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la sauvegarde" });
  }
});

app.patch('/api/user/password', verifyToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!validatePasswordStrength(newPassword)) return res.status(400).json({ error: PASSWORD_RULES_MESSAGE });

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });

    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) return res.status(401).json({ error: "Mot de passe actuel incorrect" });

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();
    res.json({ message: "Mot de passe mis à jour" });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la mise à jour du mot de passe" });
  }
});

app.get('/api/user/activities', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('activities');
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    res.json(user.activities || []);
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la lecture des activités" });
  }
});

app.post('/api/user/activities', verifyToken, async (req, res) => {
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const icon = normalizeMdiIcon(req.body.icon);
  const constraints = typeof req.body.constraints === 'string' ? req.body.constraints.trim() : '';
  const stravaSportType = typeof req.body.stravaSportType === 'string' ? req.body.stravaSportType.trim() : '';

  const parseNum = (val) => {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    return isNaN(num) ? null : num;
  };

  const windMin = parseNum(req.body.windMin);
  const windMax = parseNum(req.body.windMax);
  const gustMin = parseNum(req.body.gustMin);
  const gustMax = parseNum(req.body.gustMax);
  const tempMin = parseNum(req.body.tempMin);
  const tempMax = parseNum(req.body.tempMax);
  const precipMin = parseNum(req.body.precipMin);
  const precipMax = parseNum(req.body.precipMax);
  const uvMin = parseNum(req.body.uvMin);
  const uvMax = parseNum(req.body.uvMax);

  const slot1Name = typeof req.body.slot1Name === 'string' && req.body.slot1Name.trim() !== '' ? req.body.slot1Name.trim().substring(0, 30) : 'Matin';
  const slot1Start = req.body.slot1Start !== undefined && req.body.slot1Start !== null && req.body.slot1Start !== '' ? Math.max(0, Math.min(23, Number(req.body.slot1Start))) : 8;
  const slot1End = req.body.slot1End !== undefined && req.body.slot1End !== null && req.body.slot1End !== '' ? Math.max(0, Math.min(23, Number(req.body.slot1End))) : 12;

  const slot2Name = typeof req.body.slot2Name === 'string' && req.body.slot2Name.trim() !== '' ? req.body.slot2Name.trim().substring(0, 30) : 'Après-midi';
  const slot2Start = req.body.slot2Start !== undefined && req.body.slot2Start !== null && req.body.slot2Start !== '' ? Math.max(0, Math.min(23, Number(req.body.slot2Start))) : 14;
  const slot2End = req.body.slot2End !== undefined && req.body.slot2End !== null && req.body.slot2End !== '' ? Math.max(0, Math.min(23, Number(req.body.slot2End))) : 19;

  if (!label) return res.status(400).json({ error: "Le libellé est obligatoire" });
  if (label.length > 80) return res.status(400).json({ error: "Le libellé doit contenir 80 caractères maximum" });
  if (constraints.length > 4000) return res.status(400).json({ error: "Les contraintes doivent contenir 4000 caractères maximum" });

  if (windMin !== null && windMax !== null && windMin > windMax) return res.status(400).json({ error: "Le vent minimum ne peut pas être supérieur au vent maximum" });
  if (gustMin !== null && gustMax !== null && gustMin > gustMax) return res.status(400).json({ error: "Les rafales minimum ne peuvent pas être supérieures aux rafales maximum" });
  if (tempMin !== null && tempMax !== null && tempMin > tempMax) return res.status(400).json({ error: "La température minimum ne peut pas être supérieure à la température maximum" });
  if (precipMin !== null && precipMax !== null && precipMin > precipMax) return res.status(400).json({ error: "Les précipitations minimum ne peuvent pas être supérieures aux précipitations maximum" });
  if (uvMin !== null && uvMax !== null && uvMin > uvMax) return res.status(400).json({ error: "L'indice UV minimum ne peut pas être supérieur à l'indice UV maximum" });

  if (slot1Start > slot1End) return res.status(400).json({ error: "L'heure de début du premier créneau doit être inférieure ou égale à l'heure de fin." });
  if (slot2Start > slot2End) return res.status(400).json({ error: "L'heure de début du second créneau doit être inférieure ou égale à l'heure de fin." });

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    user.activities.push({
      label, icon, constraints, stravaSportType,
      windMin, windMax, gustMin, gustMax, tempMin, tempMax, precipMin, precipMax, uvMin, uvMax,
      slot1Name, slot1Start, slot1End, slot2Name, slot2Start, slot2End
    });
    await user.save();
    res.status(201).json(user.activities[user.activities.length - 1]);
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la création de l'activité" });
  }
});

app.put('/api/user/activities/:activityId', verifyToken, async (req, res) => {
  const label = typeof req.body.label === 'string' ? req.body.label.trim() : '';
  const icon = normalizeMdiIcon(req.body.icon);
  const constraints = typeof req.body.constraints === 'string' ? req.body.constraints.trim() : '';
  const stravaSportType = typeof req.body.stravaSportType === 'string' ? req.body.stravaSportType.trim() : '';

  const parseNum = (val) => {
    if (val === undefined || val === null || val === '') return null;
    const num = Number(val);
    return isNaN(num) ? null : num;
  };

  const windMin = parseNum(req.body.windMin);
  const windMax = parseNum(req.body.windMax);
  const gustMin = parseNum(req.body.gustMin);
  const gustMax = parseNum(req.body.gustMax);
  const tempMin = parseNum(req.body.tempMin);
  const tempMax = parseNum(req.body.tempMax);
  const precipMin = parseNum(req.body.precipMin);
  const precipMax = parseNum(req.body.precipMax);
  const uvMin = parseNum(req.body.uvMin);
  const uvMax = parseNum(req.body.uvMax);

  const slot1Name = typeof req.body.slot1Name === 'string' && req.body.slot1Name.trim() !== '' ? req.body.slot1Name.trim().substring(0, 30) : 'Matin';
  const slot1Start = req.body.slot1Start !== undefined && req.body.slot1Start !== null && req.body.slot1Start !== '' ? Math.max(0, Math.min(23, Number(req.body.slot1Start))) : 8;
  const slot1End = req.body.slot1End !== undefined && req.body.slot1End !== null && req.body.slot1End !== '' ? Math.max(0, Math.min(23, Number(req.body.slot1End))) : 12;

  const slot2Name = typeof req.body.slot2Name === 'string' && req.body.slot2Name.trim() !== '' ? req.body.slot2Name.trim().substring(0, 30) : 'Après-midi';
  const slot2Start = req.body.slot2Start !== undefined && req.body.slot2Start !== null && req.body.slot2Start !== '' ? Math.max(0, Math.min(23, Number(req.body.slot2Start))) : 14;
  const slot2End = req.body.slot2End !== undefined && req.body.slot2End !== null && req.body.slot2End !== '' ? Math.max(0, Math.min(23, Number(req.body.slot2End))) : 19;

  if (!label) return res.status(400).json({ error: "Le libellé est obligatoire" });
  if (label.length > 80) return res.status(400).json({ error: "Le libellé doit contenir 80 caractères maximum" });
  if (constraints.length > 4000) return res.status(400).json({ error: "Les contraintes doivent contenir 4000 caractères maximum" });

  if (windMin !== null && windMax !== null && windMin > windMax) return res.status(400).json({ error: "Le vent minimum ne peut pas être supérieur au vent maximum" });
  if (gustMin !== null && gustMax !== null && gustMin > gustMax) return res.status(400).json({ error: "Les rafales minimum ne peuvent pas être supérieures aux rafales maximum" });
  if (tempMin !== null && tempMax !== null && tempMin > tempMax) return res.status(400).json({ error: "La température minimum ne peut pas être supérieure à la température maximum" });
  if (precipMin !== null && precipMax !== null && precipMin > precipMax) return res.status(400).json({ error: "Les précipitations minimum ne peuvent pas être supérieures aux précipitations maximum" });
  if (uvMin !== null && uvMax !== null && uvMin > uvMax) return res.status(400).json({ error: "L'indice UV minimum ne peut pas être supérieur à l'indice UV maximum" });

  if (slot1Start > slot1End) return res.status(400).json({ error: "L'heure de début du premier créneau doit être inférieure ou égale à l'heure de fin." });
  if (slot2Start > slot2End) return res.status(400).json({ error: "L'heure de début du second créneau doit être inférieure ou égale à l'heure de fin." });

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    const activity = user.activities.id(req.params.activityId);
    if (!activity) return res.status(404).json({ error: "Activité introuvable" });
    activity.label = label;
    activity.icon = icon;
    activity.constraints = constraints;
    activity.stravaSportType = stravaSportType;
    
    activity.windMin = windMin;
    activity.windMax = windMax;
    activity.gustMin = gustMin;
    activity.gustMax = gustMax;
    activity.tempMin = tempMin;
    activity.tempMax = tempMax;
    activity.precipMin = precipMin;
    activity.precipMax = precipMax;
    activity.uvMin = uvMin;
    activity.uvMax = uvMax;

    activity.slot1Name = slot1Name;
    activity.slot1Start = slot1Start;
    activity.slot1End = slot1End;
    activity.slot2Name = slot2Name;
    activity.slot2Start = slot2Start;
    activity.slot2End = slot2End;

    await user.save();
    res.json(activity);
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la modification de l'activité" });
  }
});

app.delete('/api/user/activities/:activityId', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    const activity = user.activities.id(req.params.activityId);
    if (!activity) return res.status(404).json({ error: "Activité introuvable" });
    activity.deleteOne();
    await user.save();
    res.json({ message: "Activité supprimée" });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la suppression de l'activité" });
  }
});

// Lister tous les utilisateurs
app.get('/api/admin/users', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Interdit" });
  try {
    const users = await User.find({}, '-password').lean();
    const processedUsers = users.map(user => ({
      ...user,
      isDeletable: user.username && user.username.toLowerCase() !== 'jhenninot' && String(user._id) !== String(req.user.id)
    }));
    res.json(processedUsers);
  } catch (err) {
    res.status(500).json({ error: "Impossible de récupérer la liste des utilisateurs" });
  }
});

// Modifier le mot de passe d'un utilisateur
app.patch('/api/admin/users/:id/password', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Interdit" });
  const { newPassword } = req.body;
  if (!validatePasswordStrength(newPassword)) return res.status(400).json({ error: PASSWORD_RULES_MESSAGE });
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  await User.findByIdAndUpdate(req.params.id, { password: hashedPassword });
  res.json({ message: "Mot de passe mis à jour" });
});

// Supprimer un utilisateur
app.delete('/api/admin/users/:id', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Interdit" });
  // On empêche de se supprimer soi-même
  if (req.params.id === req.user.id) return res.status(400).json({ error: "Impossible de supprimer votre propre compte" });
  
  try {
    const userToDelete = await User.findById(req.params.id);
    if (!userToDelete) {
      return res.status(404).json({ error: "Utilisateur introuvable" });
    }
    if (userToDelete.username && userToDelete.username.toLowerCase() === 'jhenninot') {
      return res.status(400).json({ error: "Impossible de supprimer l'utilisateur administrateur principal jhenninot" });
    }
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: "Utilisateur supprimé" });
  } catch (err) {
    res.status(500).json({ error: "Erreur lors de la suppression de l'utilisateur" });
  }
});

// Obtenir la liste des modèles Gemini disponibles (Admin uniquement)
app.get('/api/admin/models', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Accès refusé (Admin requis)" });
  
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Clé API Gemini non configurée sur le serveur." });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
    const response = await axios.get(url);
    if (!response.data || !Array.isArray(response.data.models)) {
      throw new Error("Réponse de l'API Google invalide");
    }
    const models = response.data.models
      .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
      .map(m => {
        const id = m.name.replace('models/', '');
        return {
          id: id,
          displayName: m.displayName || id,
          description: m.description || ''
        };
      });
    res.json(models);
  } catch (err) {
    console.error("Erreur récupération modèles Gemini:", err.response?.data || err.message);
    res.status(500).json({ error: "Impossible de récupérer la liste des modèles Gemini." });
  }
});

// Obtenir les paramètres d'administration (Admin uniquement)
app.get('/api/admin/settings', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Accès refusé (Admin requis)" });
  try {
    const settings = await SystemSetting.find({ key: { $in: ['gemini_model', 'gemini_fallback_model', 'cache_max_age', 'weather_provider'] } });
    const result = {
      gemini_model: 'gemini-3.1-flash-lite',
      gemini_fallback_model: 'gemini-3.5-flash',
      cache_max_age: '60',
      weather_provider: 'open-meteo'
    };
    settings.forEach(s => {
      if (s.key === 'gemini_model') result.gemini_model = s.value;
      if (s.key === 'gemini_fallback_model') result.gemini_fallback_model = s.value;
      if (s.key === 'cache_max_age') result.cache_max_age = s.value;
      if (s.key === 'weather_provider') result.weather_provider = s.value;
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Impossible de récupérer les paramètres" });
  }
});

// Modifier les paramètres d'administration (Admin uniquement)
app.post('/api/admin/settings', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Accès refusé (Admin requis)" });
  const { gemini_model, gemini_fallback_model, cache_max_age, weather_provider } = req.body;
  try {
    if (gemini_model) {
      if (typeof gemini_model !== 'string' || gemini_model.trim().length === 0) {
        return res.status(400).json({ error: "Modèle Gemini principal invalide." });
      }
      await SystemSetting.findOneAndUpdate(
        { key: 'gemini_model' },
        { value: gemini_model.trim() },
        { upsert: true }
      );
    }

    if (gemini_fallback_model) {
      if (typeof gemini_fallback_model !== 'string' || gemini_fallback_model.trim().length === 0) {
        return res.status(400).json({ error: "Modèle Gemini de secours (fallback) invalide." });
      }
      await SystemSetting.findOneAndUpdate(
        { key: 'gemini_fallback_model' },
        { value: gemini_fallback_model.trim() },
        { upsert: true }
      );
    }
    
    if (cache_max_age !== undefined) {
      const minutes = parseInt(cache_max_age, 10);
      if (isNaN(minutes) || minutes < 1) {
        return res.status(400).json({ error: "Durée du cache invalide (minimum 1 minute)." });
      }
      await SystemSetting.findOneAndUpdate(
        { key: 'cache_max_age' },
        { value: String(minutes) },
        { upsert: true }
      );
    }

    if (weather_provider !== undefined) {
      const validProviders = ['open-meteo', 'met.no'];
      if (!validProviders.includes(weather_provider)) {
        return res.status(400).json({ error: "Fournisseur météo invalide. Valeurs acceptées : open-meteo, met.no" });
      }
      await SystemSetting.findOneAndUpdate(
        { key: 'weather_provider' },
        { value: weather_provider },
        { upsert: true }
      );
    }
    
    res.json({ message: "Paramètres enregistrés avec succès" });
  } catch (err) {
    res.status(500).json({ error: "Impossible d'enregistrer les paramètres" });
  }
});

// Obtenir les paramètres publics/système (Tout utilisateur connecté)
app.get('/api/settings', verifyToken, async (req, res) => {
  try {
    const settings = await SystemSetting.find({ key: { $in: ['gemini_model', 'cache_max_age'] } });
    const result = {
      gemini_model: 'gemini-3.1-flash-lite',
      cache_max_age: 60
    };
    settings.forEach(s => {
      if (s.key === 'gemini_model') result.gemini_model = s.value;
      if (s.key === 'cache_max_age') result.cache_max_age = parseInt(s.value, 10) || 60;
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Impossible de récupérer les paramètres système" });
  }
});

// --- ROUTES STRAVA ---

// 1. Générer l'URL d'autorisation Strava
app.get('/api/strava/authorize', verifyToken, (req, res) => {
  const state = Buffer.from(req.user.id).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.STRAVA_CALLBACK_URL,
    approval_prompt: 'auto',
    scope: 'activity:read_all,read_all',
    state
  });
  res.json({ url: `https://www.strava.com/oauth/authorize?${params}` });
});

// 2. Callback OAuth de Strava
app.get('/api/strava/callback', async (req, res) => {
  const { code, state, error } = req.query;
  const frontend = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (error || !code) return res.redirect(`${frontend}/?strava=error`);

  try {
    const userId = Buffer.from(state, 'base64url').toString('utf-8');
    const tokenRes = await axios.post('https://www.strava.com/oauth/token', {
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: 'authorization_code'
    });
    const { access_token, refresh_token, expires_at, athlete } = tokenRes.data;
    await User.findByIdAndUpdate(userId, {
      strava: {
        athleteId: athlete.id,
        accessToken: access_token,
        refreshToken: refresh_token,
        expiresAt: expires_at,
        athleteName: `${athlete.firstname} ${athlete.lastname}`,
        athleteProfile: athlete.profile_medium
      }
    });
    res.redirect(`${frontend}/?strava=success`);
  } catch (err) {
    console.error('Strava callback error:', err.message);
    res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/?strava=error`);
  }
});

// 3. Statut de connexion Strava
app.get('/api/strava/status', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('strava');
    res.json({
      connected: !!(user?.strava?.accessToken),
      athleteName: user?.strava?.athleteName || null,
      athleteProfile: user?.strava?.athleteProfile || null
    });
  } catch (err) {
    res.status(500).json({ error: 'Erreur statut Strava' });
  }
});

// 4. Récupérer les activités vélo des 30 derniers jours
const BIKE_TYPES = ['Ride', 'VirtualRide', 'GravelRide', 'EBikeRide', 'MountainBikeRide'];

app.get('/api/strava/activities', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user?.strava?.accessToken) return res.status(404).json({ error: 'Compte Strava non lié' });

    const accessToken = await ensureStravaToken(user);

    // Support dynamic timeframe / custom calendar range
    let after, before;
    if (req.query.startDate) {
      after = Math.floor(new Date(req.query.startDate).getTime() / 1000);
      if (req.query.endDate) {
        before = Math.floor(new Date(req.query.endDate).getTime() / 1000) + 86400;
      }
    } else {
      const days = parseInt(req.query.days) || 30;
      after = Math.floor(Date.now() / 1000) - days * 24 * 3600;
    }

    const stravaParams = { per_page: 200 };
    if (after) stravaParams.after = after;
    if (before) stravaParams.before = before;

    const response = await axios.get('https://www.strava.com/api/v3/athlete/activities', {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: stravaParams
    });


    const activities = response.data
      .map(a => ({
        id: a.id,
        name: a.name,
        type: a.sport_type || a.type,
        sport_type: a.sport_type || a.type,
        start_date: a.start_date,
        distance: a.distance,
        moving_time: a.moving_time,
        elapsed_time: a.elapsed_time,
        total_elevation_gain: a.total_elevation_gain,
        average_speed: a.average_speed,
        max_speed: a.max_speed,
        average_watts: a.average_watts,
        map: { summary_polyline: a.map?.summary_polyline }
      }));

    res.json(activities);
  } catch (err) {
    console.error('Strava activities error:', err.message);
    res.status(500).json({ error: 'Erreur récupération activités Strava' });
  }
});

// 5. Récupérer les parcours (routes) Strava de l'athlète
app.get('/api/strava/routes', verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user?.strava?.accessToken) return res.status(404).json({ error: 'Compte Strava non lié' });

    const accessToken = await ensureStravaToken(user);
    const athleteId = user.strava.athleteId;

    const response = await axios.get(`https://www.strava.com/api/v3/athletes/${athleteId}/routes`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: { per_page: 100 }
    });

    const routes = response.data.map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      distance: r.distance,
      elevation_gain: r.elevation_gain,
      type: r.type,
      sport_type: r.sport_type,
      created_at: r.created_at,
      updated_at: r.updated_at,
      estimated_moving_time: r.estimated_moving_time,
      map: { summary_polyline: r.map?.summary_polyline }
    }));

    res.json(routes);
  } catch (err) {
    console.error('Strava routes error:', err.message);
    res.status(500).json({ error: 'Erreur récupération parcours Strava' });
  }
});

// 6. Délier le compte Strava
app.delete('/api/strava/disconnect', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { $unset: { strava: '' } });
    res.json({ message: 'Compte Strava délié' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la déconnexion Strava' });
  }
});

// --- ROUTES POUR LES PARCOURS IMPORTÉS (GPX) ---

// 1. Récupérer toutes les routes importées
app.get('/api/routes', verifyToken, async (req, res) => {
  try {
    const routes = await Route.find({ userId: req.user.id }).sort({ created_at: -1 });
    res.json(routes);
  } catch (err) {
    console.error('Error fetching imported routes:', err.message);
    res.status(500).json({ error: 'Erreur lors de la récupération des parcours importés' });
  }
});

// 2. Créer une nouvelle route importée
app.post('/api/routes', verifyToken, async (req, res) => {
  const { name, description, distance, elevation_gain, estimated_moving_time, sport_type, map } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Le nom du parcours est obligatoire' });
  }
  try {
    const newRoute = new Route({
      userId: req.user.id,
      name,
      description: description || '',
      distance: distance || 0,
      elevation_gain: elevation_gain || 0,
      estimated_moving_time: estimated_moving_time || 0,
      sport_type: sport_type || '',
      map: {
        summary_polyline: map?.summary_polyline || ''
      },
      source: 'imported'
    });
    await newRoute.save();
    res.status(201).json(newRoute);
  } catch (err) {
    console.error('Error creating imported route:', err.message);
    res.status(500).json({ error: 'Erreur lors de la création du parcours' });
  }
});

// 3. Supprimer une route importée
app.delete('/api/routes/:id', verifyToken, async (req, res) => {
  try {
    const route = await Route.findOneAndDelete({ _id: req.params.id, userId: req.user.id });
    if (!route) {
      return res.status(404).json({ error: 'Parcours introuvable ou non autorisé' });
    }
    res.json({ message: 'Parcours supprimé avec succès' });
  } catch (err) {
    console.error('Error deleting route:', err.message);
    res.status(500).json({ error: 'Erreur lors de la suppression du parcours' });
  }
});

// 4. Modifier une route importée
app.put('/api/routes/:id', verifyToken, async (req, res) => {
  const { name, description, sport_type, estimated_moving_time } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Le nom du parcours est obligatoire' });
  }
  try {
    const route = await Route.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id },
      { name, description: description || '', sport_type: sport_type || '', estimated_moving_time: estimated_moving_time || 0 },
      { new: true }
    );
    if (!route) {
      return res.status(404).json({ error: 'Parcours introuvable ou non autorisé' });
    }
    res.json(route);
  } catch (err) {
    console.error('Error updating route:', err.message);
    res.status(500).json({ error: 'Erreur lors de la modification du parcours' });
  }
});

app.listen(PORT, () => console.log(`Serveur prêt sur http://localhost:${PORT}`));

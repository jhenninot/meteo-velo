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
    stravaFilters: { type: [String], default: [] }
  },
  activities: [{
    label: { type: String, required: true, trim: true, maxlength: 80 },
    icon: { type: String, default: 'mdi-bike', trim: true, maxlength: 60 },
    constraints: { type: String, default: '', trim: true, maxlength: 4000 },
    stravaSportType: { type: String, default: '', trim: true }
  }],
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

function enrichPeriod(aggregated, aiSlice) {
  const merged = { ...aggregated, ...aiSlice };
  let fav = merged.favorable === true;
  merged.criteres = normalizeCriteres(aiSlice, fav);

  // POST-PROCESSING : Forcer la probabilité de pluie à favorable si < 15%
  if (merged.rain < 15) {
    if (merged.criteres.pluie === 'defavorable') {
      merged.criteres.pluie = 'favorable';
      // Si la pluie était le seul facteur défavorable, on rend la période favorable
      const hasOtherDefavorable = Object.values(merged.criteres).some(v => v === 'defavorable');
      if (!hasOtherDefavorable && !fav) {
        merged.favorable = true;
      }
    }
    // Nettoyage du conseil si l'IA parle de pluie alors qu'elle ne devrait pas
    if (merged.conseil && merged.conseil.toLowerCase().includes('pluie')) {
      if (merged.favorable) {
         merged.conseil = "Conditions correctes, pas de risque significatif de pluie.";
      }
    }
  }

  return merged;
}

app.post('/api/forecast', verifyToken, async (req, res) => {
  const { lat, lon, city, activityId } = req.body;
  let activityLabel = '';
  let userRules = '';

  try {
    if (!activityId) return res.status(400).json({ error: "L'activité est obligatoire" });
    
    if (activityId === 'none') {
      activityLabel = 'plein air';
      userRules = '';
    } else {
      const user = await User.findById(req.user.id).select('activities');
      if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
      const activity = user.activities.id(activityId);
      if (!activity) return res.status(404).json({ error: "Activité introuvable" });
      activityLabel = activity.label;
      userRules = (activity.constraints || '').trim();
    }
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m,uv_index&timezone=auto`;
    const weatherRes = await axios.get(weatherUrl);
    const hourly = weatherRes.data.hourly;
    // utc_offset_seconds est fourni par Open-Meteo avec timezone=auto
    const utcOffsetSeconds = weatherRes.data.utc_offset_seconds ?? 0;

    // Heure locale actuelle à la destination (en minutes UTC depuis epoch)
    const nowUtcMs = Date.now();
    // On fabrique un timestamp local fictif pour comparer avec les strings ISO sans TZ
    const nowLocalMs = nowUtcMs + utcOffsetSeconds * 1000;
    const nowLocalStr = new Date(nowLocalMs).toISOString().slice(0, 16); // "YYYY-MM-DDTHH:mm"

    const daysMap = {};
    hourly.time.forEach((t, i) => {
      // Open-Meteo retourne les temps en heure locale de la destination
      // sans suffixe de fuseau (ex: "2026-05-18T14:00").
      // On compare directement les strings pour éviter toute reinterprétation UTC.
      if (t < nowLocalStr) return;

      const date = t.split('T')[0];
      // Extraction de l'heure directement depuis la chaîne (pas via new Date)
      const hour = parseInt(t.split('T')[1].split(':')[0], 10);

      if (!daysMap[date]) {
        daysMap[date] = {
          date,
          matin: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [], uvs: [] },
          apres_midi: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [], uvs: [] }
        };
      }

      if (hour >= 8 && hour <= 12) {
        daysMap[date].matin.temps.push(hourly.temperature_2m[i]);
        daysMap[date].matin.rains.push(hourly.precipitation_probability[i]);
        daysMap[date].matin.precips.push(hourly.precipitation[i]);
        daysMap[date].matin.winds.push(hourly.wind_speed_10m[i]);
        daysMap[date].matin.gusts.push(hourly.wind_gusts_10m[i]);
        daysMap[date].matin.dirs.push(hourly.wind_direction_10m[i]);
        daysMap[date].matin.hours.push(hour);
        daysMap[date].matin.uvs.push(hourly.uv_index[i]);
      } else if (hour >= 13 && hour <= 18) {
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

    const aggregate = (period) => {
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
        temp: Math.round(Math.max(...period.temps)),
        rain: Math.max(...period.rains),
        precip: Number(period.precips.reduce((sum, current) => sum + current, 0).toFixed(1)),
        wind: Math.round(Math.max(...period.winds)),
        gust: Math.round(Math.max(...period.gusts)),
        dir: period.dirs[Math.floor(period.dirs.length / 2)],
        uv: Number(Math.max(...(period.uvs.length > 0 ? period.uvs : [0])).toFixed(1)),
        hourly: hourlyData
      };
    };

    const structuredWeather = Object.values(daysMap)
      .map(d => ({ date: d.date, matin: aggregate(d.matin), apres_midi: aggregate(d.apres_midi) }))
      .filter(d => d.matin !== null || d.apres_midi !== null)
      .slice(0, 7);

    let activeModel = 'gemini-3.1-flash-lite';
    try {
      const setting = await SystemSetting.findOne({ key: 'gemini_model' });
      if (setting && (setting.value === 'gemini-3.1-flash-lite' || setting.value === 'gemini-3.5-flash')) {
        activeModel = setting.value;
      }
    } catch (err) {
      console.error("Erreur de lecture du modèle Gemini configuré :", err);
    }

    let prompt = `Tu es un algorithme de filtrage intransigeant pour l'activité suivante : ${activityLabel}. Voici la météo agrégée (Matin / Après-midi) pour ${city} : ${JSON.stringify(structuredWeather)}`;

    if (userRules !== "") {
      prompt += `
CONTRAINTES DE L'ACTIVITé :
"""${userRules}"""
Tu DOIS mettre "favorable": false si une contrainte est enfreinte.`;
    }

    prompt += `
            RÈGLES D'ANALYSE PRÉCISES :
            - PRÉCIPITATIONS : Si le cumul (precip) est de 0mm, ne parle pas de "pluie continue" ou de "déluge", même si la probabilité est haute. Parle plutôt de "ciel menaçant" ou "risque de bruine".
            - PLUIE : Si la probabilité de pluie (rain) est inférieure à 15 %, ce critère DOIT obligatoirement être "favorable" et ne DOIT PAS rendre à lui seul l'analyse de la demi-journée défavorable. Dans ton "conseil", NE MENTIONNE JAMAIS un risque de pluie et NE DÉCONSEILLE SURTOUT PAS la sortie pour ce motif si la probabilité est < 15% ou le cumul est de 0mm.
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
    const fallbackModel = activeModel === 'gemini-3.5-flash' ? 'gemini-3.1-flash-lite' : 'gemini-3.5-flash';

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
        matin: day.matin ? enrichPeriod(day.matin, ai.matin || {}) : null,
        apres_midi: day.apres_midi ? enrichPeriod(day.apres_midi, ai.apres_midi || {}) : null
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
    const newUser = new User({ username, password: hashedPassword, role });
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

  if (!label) return res.status(400).json({ error: "Le libellé est obligatoire" });
  if (label.length > 80) return res.status(400).json({ error: "Le libellé doit contenir 80 caractères maximum" });
  if (constraints.length > 4000) return res.status(400).json({ error: "Les contraintes doivent contenir 4000 caractères maximum" });

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    user.activities.push({ label, icon, constraints, stravaSportType });
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

  if (!label) return res.status(400).json({ error: "Le libellé est obligatoire" });
  if (label.length > 80) return res.status(400).json({ error: "Le libellé doit contenir 80 caractères maximum" });
  if (constraints.length > 4000) return res.status(400).json({ error: "Les contraintes doivent contenir 4000 caractères maximum" });

  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ error: "Utilisateur introuvable" });
    const activity = user.activities.id(req.params.activityId);
    if (!activity) return res.status(404).json({ error: "Activité introuvable" });
    activity.label = label;
    activity.icon = icon;
    activity.constraints = constraints;
    activity.stravaSportType = stravaSportType;
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
  const users = await User.find({}, '-password'); // On récupère tout SAUF les mots de passe
  res.json(users);
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
  await User.findByIdAndDelete(req.params.id);
  res.json({ message: "Utilisateur supprimé" });
});

// Obtenir le modèle Gemini sélectionné (Admin uniquement)
// Obtenir les paramètres d'administration (Admin uniquement)
app.get('/api/admin/settings', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Accès refusé (Admin requis)" });
  try {
    const settings = await SystemSetting.find({ key: { $in: ['gemini_model', 'cache_max_age'] } });
    const result = {
      gemini_model: 'gemini-3.1-flash-lite',
      cache_max_age: '60'
    };
    settings.forEach(s => {
      if (s.key === 'gemini_model') result.gemini_model = s.value;
      if (s.key === 'cache_max_age') result.cache_max_age = s.value;
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: "Impossible de récupérer les paramètres" });
  }
});

// Modifier les paramètres d'administration (Admin uniquement)
app.post('/api/admin/settings', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Accès refusé (Admin requis)" });
  const { gemini_model, cache_max_age } = req.body;
  try {
    if (gemini_model) {
      if (gemini_model !== 'gemini-3.1-flash-lite' && gemini_model !== 'gemini-3.5-flash') {
        return res.status(400).json({ error: "Modèle Gemini invalide." });
      }
      await SystemSetting.findOneAndUpdate(
        { key: 'gemini_model' },
        { value: gemini_model },
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

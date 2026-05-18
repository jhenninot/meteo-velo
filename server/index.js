import express from 'express';
import cors from 'cors';
import axios from 'axios';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mongoose from 'mongoose'; // <-- AJOUTÉ
import bcrypt from 'bcryptjs';    // <-- AJOUTÉ
import jwt from 'jsonwebtoken';   // <-- AJOUTÉ
// j
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const JWT_SECRET = process.env.JWT_SECRET || 'ta_cle_secrete_hyper_longue';

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
    theme: { type: String, enum: ['light', 'dark'], default: 'light' },
    stravaFilters: { type: [String], default: [] }
  },
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

const CRITERE_KEYS = ['temperature', 'pluie', 'precipitations', 'vent', 'rafales'];

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
  const fav = merged.favorable === true;
  merged.criteres = normalizeCriteres(aiSlice, fav);
  return merged;
}

app.post('/api/forecast', verifyToken, async (req, res) => {
  const { lat, lon, city, consignes, customInstructions } = req.body;
  const userRules = (consignes ?? customInstructions ?? '').trim();
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m&timezone=auto`;
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
          matin: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [] },
          apres_midi: { temps: [], rains: [], precips: [], winds: [], gusts: [], dirs: [], hours: [] }
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
      } else if (hour >= 13 && hour <= 18) {
        daysMap[date].apres_midi.temps.push(hourly.temperature_2m[i]);
        daysMap[date].apres_midi.rains.push(hourly.precipitation_probability[i]);
        daysMap[date].apres_midi.precips.push(hourly.precipitation[i]);
        daysMap[date].apres_midi.winds.push(hourly.wind_speed_10m[i]);
        daysMap[date].apres_midi.gusts.push(hourly.wind_gusts_10m[i]);
        daysMap[date].apres_midi.dirs.push(hourly.wind_direction_10m[i]);
        daysMap[date].apres_midi.hours.push(hour);
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
        dir: period.dirs[i]
      }));

      return {
        temp: Math.round(Math.max(...period.temps)),
        rain: Math.max(...period.rains),
        precip: Number(period.precips.reduce((sum, current) => sum + current, 0).toFixed(1)),
        wind: Math.round(Math.max(...period.winds)),
        gust: Math.round(Math.max(...period.gusts)),
        dir: period.dirs[Math.floor(period.dirs.length / 2)],
        hourly: hourlyData
      };
    };

    const structuredWeather = Object.values(daysMap)
      .map(d => ({ date: d.date, matin: aggregate(d.matin), apres_midi: aggregate(d.apres_midi) }))
      .filter(d => d.matin !== null || d.apres_midi !== null)
      .slice(0, 7);

    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    let prompt = `Tu es un algorithme de filtrage intransigeant pour un cycliste gravel ou route. Voici la météo agrégée (Matin / Après-midi) pour ${city} : ${JSON.stringify(structuredWeather)}`;

    if (userRules !== "") {
      prompt += `\nRÈGLES ÉLIMINATOIRES :\n"""${userRules}"""\nTu DOIS mettre "favorable": false si une règle est enfreinte.`;
    }

    prompt += `
            RÈGLES D'ANALYSE PRÉCISES :
            - PRÉCIPITATIONS : Si le cumul (precip) est de 0mm, ne parle pas de "pluie continue" ou de "déluge", même si la probabilité est haute. Parle plutôt de "ciel menaçant" ou "risque de bruine".
            - SEUIL DE TOLÉRANCE : Considère que moins de 0.5mm sur une demi-journée est négligeable pour un cycliste équipé.
            - VENT : Sois intransigeant sur les rafales (gust) par rapport aux consignes de l'utilisateur.
            - TON : Reste factuel et encourageant si les conditions sont à la limite.
            
            Pour CHAQUE JOUR et CHAQUE demi-journée (matin / apres_midi), détermine "favorable" true ou false en respectant STRICTEMENT les consignes.
            Tu DOIS aussi remplir "criteres" (voir ci-dessous) : pour chaque critère, indique "favorable" si ce facteur ne milite pas contre la sortie vélo, "defavorable" s'il contribue au refus ou au verdict défavorable.
            Correspondance avec les chiffres fournis : temperature = temp (°C max), pluie = rain (% max), precipitations = precip (mm cumul), vent = wind (km/h max), rafales = gust (km/h max).
            Si la demi-journée est favorable, tous les critères doivent être "favorable" sauf si un critère reste objectivement limite (dans ce cas mets "favorable": false et le ou les critères concernés en "defavorable").
            Si la demi-journée est défavorable, au moins un critère doit être "defavorable" (tous ceux qui expliquent le verdict).
            `;

    prompt += `
Réponds EXCLUSIVEMENT par un tableau JSON (sans markdown), un objet par jour, dans l'ordre des dates. Structure exacte pour chaque jour :
{"date":"YYYY-MM-DD","matin":{"favorable":true,"conseil":"...","criteres":{"temperature":"favorable","pluie":"favorable","precipitations":"favorable","vent":"favorable","rafales":"favorable"}},"apres_midi":{"favorable":true,"conseil":"...","criteres":{"temperature":"favorable","pluie":"favorable","precipitations":"favorable","vent":"favorable","rafales":"favorable"}}}
Les valeurs dans criteres sont uniquement les chaînes "favorable" ou "defavorable" (pas d'autres valeurs).
`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();
    const jsonMatch = responseText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("JSON IA invalide");

    const aiData = JSON.parse(jsonMatch[0]);

    const finalData = structuredWeather.map(day => {
      const ai = aiData.find(a => a.date === day.date) || { matin: {}, apres_midi: {} };
      return {
        date: day.date,
        matin: day.matin ? enrichPeriod(day.matin, ai.matin || {}) : null,
        apres_midi: day.apres_midi ? enrichPeriod(day.apres_midi, ai.apres_midi || {}) : null
      };
    });

    res.json(finalData);

  } catch (error) {
    console.error("Erreur API:", error);
    res.status(500).json({ error: "Erreur analyse" });
  }
});

// Route Admin : Créer un utilisateur
app.post('/api/admin/create-user', verifyToken, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: "Accès refusé (Admin requis)" });

  const { username, password, role } = req.body;
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

// --- ROUTES STRAVA ---

// 1. Générer l'URL d'autorisation Strava
app.get('/api/strava/authorize', verifyToken, (req, res) => {
  const state = Buffer.from(req.user.id).toString('base64url');
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID,
    response_type: 'code',
    redirect_uri: process.env.STRAVA_CALLBACK_URL,
    approval_prompt: 'auto',
    scope: 'activity:read_all',
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

// 5. Délier le compte Strava
app.delete('/api/strava/disconnect', verifyToken, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.user.id, { $unset: { strava: '' } });
    res.json({ message: 'Compte Strava délié' });
  } catch (err) {
    res.status(500).json({ error: 'Erreur lors de la déconnexion Strava' });
  }
});

app.listen(PORT, () => console.log(`Serveur prêt sur http://localhost:${PORT}`));
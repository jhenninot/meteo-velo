import express from 'express';
import cors from 'cors';
import axios from 'axios';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';
import mongoose from 'mongoose'; // <-- AJOUTÉ
import bcrypt from 'bcryptjs';    // <-- AJOUTÉ
import jwt from 'jsonwebtoken';   // <-- AJOUTÉ

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
    consignes: String
  }
});
const User = mongoose.model('User', userSchema);

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

app.post('/api/forecast', verifyToken, async (req, res) => {
    const { lat, lon, city, customInstructions } = req.body;
    try {
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m&timezone=auto`;
        const weatherRes = await axios.get(weatherUrl);
        const hourly = weatherRes.data.hourly;

        const daysMap = {};
        hourly.time.forEach((t, i) => {
            const dateObj = new Date(t);
            const date = t.split('T')[0];
            const hour = dateObj.getHours();

            if (!daysMap[date]) {
                daysMap[date] = { 
                    date, 
                    matin: { temps:[], rains:[], precips:[], winds:[], gusts:[], dirs:[] }, 
                    apres_midi: { temps:[], rains:[], precips:[], winds:[], gusts:[], dirs:[] } 
                };
            }

            if (hour >= 8 && hour <= 12) {
                daysMap[date].matin.temps.push(hourly.temperature_2m[i]);
                daysMap[date].matin.rains.push(hourly.precipitation_probability[i]);
                daysMap[date].matin.precips.push(hourly.precipitation[i]);
                daysMap[date].matin.winds.push(hourly.wind_speed_10m[i]);
                daysMap[date].matin.gusts.push(hourly.wind_gusts_10m[i]);
                daysMap[date].matin.dirs.push(hourly.wind_direction_10m[i]);
            } else if (hour >= 13 && hour <= 18) {
                daysMap[date].apres_midi.temps.push(hourly.temperature_2m[i]);
                daysMap[date].apres_midi.rains.push(hourly.precipitation_probability[i]);
                daysMap[date].apres_midi.precips.push(hourly.precipitation[i]);
                daysMap[date].apres_midi.winds.push(hourly.wind_speed_10m[i]);
                daysMap[date].apres_midi.gusts.push(hourly.wind_gusts_10m[i]);
                daysMap[date].apres_midi.dirs.push(hourly.wind_direction_10m[i]);
            }
        });

        const aggregate = (period) => {
            if (!period || period.temps.length === 0) return null;
            return {
                temp: Math.round(Math.max(...period.temps)),
                rain: Math.max(...period.rains),
                precip: Number(period.precips.reduce((sum, current) => sum + current, 0).toFixed(1)),
                wind: Math.round(Math.max(...period.winds)),
                gust: Math.round(Math.max(...period.gusts)),
                dir: period.dirs[Math.floor(period.dirs.length / 2)] 
            };
        };

        const structuredWeather = Object.values(daysMap)
            .map(d => ({ date: d.date, matin: aggregate(d.matin), apres_midi: aggregate(d.apres_midi) }))
            .filter(d => d.matin !== null && d.apres_midi !== null)
            .slice(0, 5);

        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        
        let prompt = `Tu es un algorithme de filtrage intransigeant pour un cycliste gravel ou route. Voici la météo agrégée (Matin / Après-midi) pour ${city} : ${JSON.stringify(structuredWeather)}`;

        if (customInstructions && customInstructions.trim() !== "") {
            prompt += `\nRÈGLES ÉLIMINATOIRES :\n"""${customInstructions}"""\nTu DOIS mettre "favorable": false si une règle est enfreinte.`;
        }

        prompt += `
            RÈGLES D'ANALYSE PRÉCISES :
            - PRÉCIPITATIONS : Si le cumul (precip) est de 0mm, ne parle pas de "pluie continue" ou de "déluge", même si la probabilité est haute. Parle plutôt de "ciel menaçant" ou "risque de bruine".
            - SEUIL DE TOLÉRANCE : Considère que moins de 0.5mm sur une demi-journée est négligeable pour un cycliste équipé.
            - VENT : Sois intransigeant sur les rafales (gust) par rapport aux consignes de l'utilisateur.
            - TON : Reste factuel et encourageant si les conditions sont à la limite.
            
            Pour CHAQUE JOUR, détermine si le matin et l'après-midi sont favorables (true ou false) en respectant STRICTEMENT les consignes utilisateur.
            `;

        prompt += `\nRéponds EXCLUSIVEMENT en JSON : [{"date":"...", "matin":{"favorable":true/false, "conseil":"..."}, "apres_midi":{...}}]`;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error("JSON IA invalide");
        
        const aiData = JSON.parse(jsonMatch[0]);

        const finalData = structuredWeather.map(day => {
            const ai = aiData.find(a => a.date === day.date) || { matin: {}, apres_midi: {} };
            return {
                date: day.date,
                matin: { ...day.matin, ...ai.matin },
                apres_midi: { ...day.apres_midi, ...ai.apres_midi }
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

// Route Utilisateur : Sauvegarder préférences
app.post('/api/user/preferences', verifyToken, async (req, res) => {
    try {
        await User.findByIdAndUpdate(req.user.id, { preferences: req.body });
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

app.listen(PORT, () => console.log(`Serveur prêt sur http://localhost:${PORT}`));
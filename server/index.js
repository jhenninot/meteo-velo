import express from 'express';
import cors from 'cors';
import axios from 'axios';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    try {
        const response = await axios.get(`https://photon.komoot.io/api/?q=${q}&limit=5`);
        res.json(response.data.features);
    } catch (error) {
        console.error("Erreur Photon:", error.message);
        res.status(500).json({ error: "Erreur recherche de lieu" });
    }
});

app.post('/api/forecast', async (req, res) => {
    const { lat, lon, city, customInstructions } = req.body;

    try {
        // 1. Passage à 'hourly' pour cibler le matin et l'après-midi
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,wind_speed_10m,wind_gusts_10m,wind_direction_10m&timezone=auto`;
        const weatherRes = await axios.get(weatherUrl);
        const hourly = weatherRes.data.hourly;

        // 2. Agrégation des données horaires par demi-journée
        const daysMap = {};
        hourly.time.forEach((t, i) => {
            const dateObj = new Date(t);
            const date = t.split('T')[0]; // Format YYYY-MM-DD
            const hour = dateObj.getHours();

            if (!daysMap[date]) {
                daysMap[date] = { date, matin: { temps:[], rains:[], winds:[], gusts:[], dirs:[] }, apres_midi: { temps:[], rains:[], winds:[], gusts:[], dirs:[] } };
            }

            // Matin : 8h à 12h
            if (hour >= 8 && hour <= 12) {
                daysMap[date].matin.temps.push(hourly.temperature_2m[i]);
                daysMap[date].matin.rains.push(hourly.precipitation_probability[i]);
                daysMap[date].matin.winds.push(hourly.wind_speed_10m[i]);
                daysMap[date].matin.gusts.push(hourly.wind_gusts_10m[i]);
                daysMap[date].matin.dirs.push(hourly.wind_direction_10m[i]);
            } 
            // Après-midi : 13h à 18h
            else if (hour >= 13 && hour <= 18) {
                daysMap[date].apres_midi.temps.push(hourly.temperature_2m[i]);
                daysMap[date].apres_midi.rains.push(hourly.precipitation_probability[i]);
                daysMap[date].apres_midi.winds.push(hourly.wind_speed_10m[i]);
                daysMap[date].apres_midi.gusts.push(hourly.wind_gusts_10m[i]);
                daysMap[date].apres_midi.dirs.push(hourly.wind_direction_10m[i]);
            }
        });

        // Fonction pour extraire les valeurs max d'une période
        const aggregate = (period) => {
            if (!period || period.temps.length === 0) return null;
            return {
                temp: Math.round(Math.max(...period.temps)),
                rain: Math.max(...period.rains),
                wind: Math.round(Math.max(...period.winds)),
                gust: Math.round(Math.max(...period.gusts)),
                dir: period.dirs[Math.floor(period.dirs.length / 2)] // Direction moyenne de la période
            };
        };

        // On ne garde que les jours ayant des données pour le matin ET l'après-midi
        const structuredWeather = Object.values(daysMap)
            .map(d => ({ date: d.date, matin: aggregate(d.matin), apres_midi: aggregate(d.apres_midi) }))
            .filter(d => d.matin !== null && d.apres_midi !== null)
            .slice(0, 5);

        // 3. Appel à Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        
        let prompt = `
            Tu es un assistant expert pour cyclistes. Voici la météo agrégée (Matin / Après-midi) pour ${city} :
            ${JSON.stringify(structuredWeather)}
            
            Analyse ces données. Prends en compte les rafales en plaine pour le gravel.
        `;

        if (customInstructions && customInstructions.trim() !== "") {
            prompt += `\nCONSIGNES SPÉCIFIQUES DE L'UTILISATEUR :\n"${customInstructions}"\n`;
        }

        prompt += `
            Pour CHAQUE JOUR, détermine si le matin et l'après-midi sont favorables à une sortie vélo (true/false) et donne un conseil très court.
            Réponds EXCLUSIVEMENT au format JSON suivant : 
            [
              {
                "date": "YYYY-MM-DD",
                "matin": { "favorable": true, "conseil": "..." },
                "apres_midi": { "favorable": false, "conseil": "..." }
              }
            ]
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);

        if (!jsonMatch) throw new Error("JSON invalide");
        
        const aiData = JSON.parse(jsonMatch[0]);

        // 4. Fusion des données météo et des avis IA
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

app.listen(PORT, () => console.log(`Serveur prêt sur http://localhost:${PORT}`));
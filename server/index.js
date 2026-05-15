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
        // 1. Ajout de 'precipitation' dans l'URL d'Open-Meteo
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m,wind_direction_10m&timezone=auto`;
        const weatherRes = await axios.get(weatherUrl);
        const hourly = weatherRes.data.hourly;

        // 2. Agrégation des données horaires par demi-journée
        const daysMap = {};
        hourly.time.forEach((t, i) => {
            const dateObj = new Date(t);
            const date = t.split('T')[0]; // Format YYYY-MM-DD
            const hour = dateObj.getHours();

            if (!daysMap[date]) {
                // Ajout de 'precips' pour stocker les mm d'eau
                daysMap[date] = { 
                    date, 
                    matin: { temps:[], rains:[], precips:[], winds:[], gusts:[], dirs:[] }, 
                    apres_midi: { temps:[], rains:[], precips:[], winds:[], gusts:[], dirs:[] } 
                };
            }

            // Matin : 8h à 12h
            if (hour >= 8 && hour <= 12) {
                daysMap[date].matin.temps.push(hourly.temperature_2m[i]);
                daysMap[date].matin.rains.push(hourly.precipitation_probability[i]);
                daysMap[date].matin.precips.push(hourly.precipitation[i]); // Les mm
                daysMap[date].matin.winds.push(hourly.wind_speed_10m[i]);
                daysMap[date].matin.gusts.push(hourly.wind_gusts_10m[i]);
                daysMap[date].matin.dirs.push(hourly.wind_direction_10m[i]);
            } 
            // Après-midi : 13h à 18h
            else if (hour >= 13 && hour <= 18) {
                daysMap[date].apres_midi.temps.push(hourly.temperature_2m[i]);
                daysMap[date].apres_midi.rains.push(hourly.precipitation_probability[i]);
                daysMap[date].apres_midi.precips.push(hourly.precipitation[i]); // Les mm
                daysMap[date].apres_midi.winds.push(hourly.wind_speed_10m[i]);
                daysMap[date].apres_midi.gusts.push(hourly.wind_gusts_10m[i]);
                daysMap[date].apres_midi.dirs.push(hourly.wind_direction_10m[i]);
            }
        });

        // Fonction pour extraire et calculer les valeurs d'une période
        const aggregate = (period) => {
            if (!period || period.temps.length === 0) return null;
            return {
                temp: Math.round(Math.max(...period.temps)),
                rain: Math.max(...period.rains),
                // Cumul des précipitations (somme) arrondi à 1 décimale
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

        // 3. Appel à Gemini
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        
        let prompt = `
            Tu es un algorithme de filtrage intransigeant pour un cycliste gravel. Voici la météo agrégée (Matin / Après-midi) pour ${city} :
            ${JSON.stringify(structuredWeather)}
        `;

        if (customInstructions && customInstructions.trim() !== "") {
            prompt += `
            RÈGLES ÉLIMINATOIRES DE L'UTILISATEUR :
            """${customInstructions}"""
            
            INSTRUCTION CRITIQUE : Tu DOIS appliquer ces règles de manière stricte. 
            - Si l'utilisateur donne une limite de vent ou de rafales (gust), et qu'elle est dépassée, tu DOIS mettre "favorable": false.
            - Si l'utilisateur demande une durée minimum et que la météo ne le permet pas, tu DOIS mettre "favorable": false.
            - Justifie le refus dans le "conseil" (ex: "Rafales à 32 km/h, trop de vent").
            `;
        } else {
            prompt += `
            Analyse ces données et détermine si c'est favorable de manière générale pour du vélo. Prends garde aux fortes rafales et à la pluie.
            `;
        }

        prompt += `
            Pour CHAQUE JOUR, détermine si le matin et l'après-midi sont favorables (true ou false) en respectant STRICTEMENT les instructions ci-dessus.
            Donne un conseil très court.
            Réponds EXCLUSIVEMENT au format JSON exact suivant, sans aucun texte ou balise markdown autour : 
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
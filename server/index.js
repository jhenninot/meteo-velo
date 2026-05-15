import express from 'express';
import cors from 'cors';
import axios from 'axios';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Initialisation de Google Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Endpoint 1 : Recherche de ville (Autocomplétion via Photon Komoot)
app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    try {
        const response = await axios.get(`https://photon.komoot.io/api/?q=${q}&limit=5`);
        res.json(response.data.features);
    } catch (error) {
        console.error("Erreur lors de la recherche Photon:", error.message);
        res.status(500).json({ error: "Erreur lors de la recherche de lieu" });
    }
});

// Endpoint 2 : Météo (Open-Meteo) + Conseil IA (Gemini)
app.post('/api/forecast', async (req, res) => {
    const { lat, lon, city } = req.body;

    try {
        // 1. Récupération météo avec les rafales de vent (wind_gusts_10m_max)
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max&timezone=auto`;
        const weatherRes = await axios.get(weatherUrl);
        const dailyData = weatherRes.data.daily;

        // 2. Appel à Gemini avec la version 3.1 Lite validée
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        
        const prompt = `
            Tu es un assistant expert pour cyclistes (route et gravel). 
            Voici les prévisions météo pour ${city} sur les prochains jours :
            ${JSON.stringify(dailyData)}
            
            Analyse les données (température, probabilité de pluie, vitesse du vent ET rafales).
            Prends en compte que l'utilisateur fait souvent du gravel, les rafales en plaine sont donc un critère important de sécurité et de confort.
            Pour chaque jour, donne un conseil court (max 2 phrases) sur le meilleur moment pour rouler.
            Sois encourageant mais prudent sur la sécurité (vent fort ou pluie).
            Réponds au format JSON uniquement : 
            [{"date": "YYYY-MM-DD", "conseil": "..."}]
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // 3. Nettoyage et sécurisation du JSON renvoyé par Gemini
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);

        if (!jsonMatch) {
            throw new Error("Gemini n'a pas renvoyé un JSON valide : " + responseText);
        }

        const cleanJson = jsonMatch[0];
        
        // 4. Renvoi des données météo brutes + l'analyse IA au front-end
        res.json({
            weather: dailyData,
            aiAdvice: JSON.parse(cleanJson)
        });

    } catch (error) {
        console.error("Erreur API Météo ou Gemini:", error);
        res.status(500).json({ error: "Erreur lors de l'analyse météo" });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur prêt sur http://localhost:${PORT}`);
    console.log(`Mode "watch" actif si lancé via npm run dev`);
});
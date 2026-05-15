import express from 'express';
import cors from 'cors';
import axios from 'axios';
import 'dotenv/config';
import { GoogleGenerativeAI } from '@google/generative-ai';

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3001;

// Configuration de Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Endpoint 1 : Recherche de ville (Autocomplétion)
app.get('/api/search', async (req, res) => {
    const { q } = req.query;
    try {
        const response = await axios.get(`https://photon.komoot.io/api/?q=${q}&limit=5`);
        res.json(response.data.features);
    } catch (error) {
        res.status(500).json({ error: "Erreur lors de la recherche de lieu" });
    }
});

// Endpoint 2 : Météo + Conseil IA
app.post('/api/forecast', async (req, res) => {
    const { lat, lon, city } = req.body;

    try {
        // 1. Récupération météo (Open-Meteo)
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto`;
        const weatherRes = await axios.get(weatherUrl);
        const dailyData = weatherRes.data.daily;

        // 2. Appel à Gemini pour l'analyse cycliste
        const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });
        
        const prompt = `
            Tu es un assistant expert pour cyclistes (route et gravel). 
            Voici les prévisions météo pour ${city} sur les prochains jours :
            ${JSON.stringify(dailyData)}
            
            Analyse les données (température, probabilité de pluie, vitesse du vent).
            Pour chaque jour, donne un conseil court (max 2 phrases) sur le meilleur moment pour rouler.
            Sois encourageant mais prudent sur la sécurité (vent fort ou pluie).
            Réponds au format JSON uniquement : 
            [{"date": "YYYY-MM-DD", "conseil": "..."}]
        `;

        const result = await model.generateContent(prompt);
        const responseText = result.response.text();
        
        // Nettoyage de la réponse JSON de Gemini (parfois il ajoute des backticks ```json)
        const cleanJson = responseText.replace(/```json|```/g, "").trim();

        res.json({
            weather: dailyData,
            aiAdvice: JSON.parse(cleanJson)
        });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: "Erreur lors de l'analyse météo" });
    }
});

app.listen(PORT, () => {
    console.log(`Serveur prêt sur http://localhost:${PORT}`);
});
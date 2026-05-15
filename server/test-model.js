import axios from 'axios';
import 'dotenv/config';

async function listerModeles() {
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        console.error("Erreur : La clé API est introuvable dans le fichier .env");
        return;
    }

    try {
        console.log("Interrogation de Google AI...");
        const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;
        const reponse = await axios.get(url);
        
        console.log("\n✅ Modèles disponibles pour générer du texte avec ta clé :\n");
        
        reponse.data.models.forEach(modele => {
            if (modele.supportedGenerationMethods.includes('generateContent')) {
                // On retire le préfixe "models/" pour ne garder que le nom utilisable
                console.log(`- ${modele.name.replace('models/', '')}`);
            }
        });
        
    } catch (erreur) {
        console.error("Erreur lors de la récupération :", erreur.response?.data || erreur.message);
    }
}

listerModeles();
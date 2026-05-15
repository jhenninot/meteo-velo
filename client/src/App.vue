<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

// --- ÉTATS ---
const city = ref('')
const query = ref('')
const suggestions = ref([])
const consignes = ref(localStorage.getItem('user_consignes') || '')
const forecastData = ref(null)
const loading = ref(false)
const error = ref(null)

// --- CONFIGURATION ---
// Remplace bien par l'IP de ton container LXC
const API_BASE_URL = 'http://192.168.0.41:3001'

// --- LOGIQUE AU CHARGEMENT ---
onMounted(() => {
  const savedCity = localStorage.getItem('selected_city')
  if (savedCity) {
    city.value = savedCity
    query.value = savedCity
    fetchForecast() // Rafraîchit automatiquement au démarrage
  }
})

// --- FONCTIONS ---

// Recherche de ville (Auto-complétion)
const searchCities = async () => {
  if (query.value.length < 3) {
    suggestions.value = []
    return
  }
  try {
    const response = await axios.get(`${API_BASE_URL}/api/search?q=${query.value}`)
    suggestions.value = response.data
  } catch (err) {
    console.error("Erreur recherche ville:", err)
  }
}

// Sélection d'une ville dans la liste
const selectCity = (selected) => {
  city.value = selected.name
  query.value = selected.name
  suggestions.value = []
  fetchForecast()
}

// Récupération des prévisions et analyse IA
const fetchForecast = async () => {
  if (!city.value) return
  
  loading.value = true
  error.value = null
  
  // Sauvegarde locale des préférences
  localStorage.setItem('selected_city', city.value)
  localStorage.setItem('user_consignes', consignes.value)

  try {
    const response = await axios.post(`${API_BASE_URL}/api/forecast`, {
      city: city.value,
      consignes: consignes.value
    })
    forecastData.value = response.data
  } catch (err) {
    console.error("Erreur API:", err)
    error.value = "Impossible de récupérer les prévisions. Vérifiez l'IP du serveur ou la clé API."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="app-container">
    <header>
      <h1><span class="icon">🚲</span> Vélo Météo IA</h1>
    </header>

    <main>
      <section class="config-section">
        <div class="input-group">
          <label>Mes consignes (IA) :</label>
          <textarea 
            v-model="consignes" 
            placeholder="Ex: Je déteste la pluie. Je veux rouler au moins 2h l'après-midi..."
            @blur="localStorage.setItem('user_consignes', consignes)"
          ></textarea>
        </div>

        <div class="search-container">
          <div class="search-input-wrapper">
            <input 
              v-model="query" 
              @input="searchCities" 
              placeholder="Chercher une ville (ex: Lille...)"
              @keyup.enter="fetchForecast"
            />
            
            <button 
              @click="fetchForecast" 
              :disabled="loading || !city" 
              class="refresh-btn"
              title="Rafraîchir les données"
            >
              {{ loading ? '⌛' : '🔄' }}
            </button>
          </div>

          <ul v-if="suggestions.length > 0" class="suggestions-list">
            <li v-for="s in suggestions" :key="s.id" @click="selectCity(s)">
              {{ s.name }} ({{ s.region }})
            </li>
          </ul>
        </div>
      </section>

      <div v-if="loading" class="status-msg">Analyse météo en cours par l'IA...</div>
      <div v-if="error" class="error-msg">{{ error }}</div>

      <section v-if="forecastData && !loading" class="results-section">
        <h2>Prévisions pour {{ city }}</h2>
        
        <div class="forecast-grid">
          <div v-for="(day, index) in forecastData" :key="index" class="day-card" :class="day.avis.toLowerCase()">
            <h3>{{ day.date }}</h3>
            <div class="temp">{{ day.temp_max }}°C</div>
            <p class="condition">{{ day.condition }}</p>
            <div class="ia-advice">
              <strong>Avis IA : {{ day.avis }}</strong>
              <p>{{ day.commentaire }}</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  max-width: 800px;
  margin: 0 auto;
  padding: 20px;
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  color: #333;
}

header {
  text-align: center;
  margin-bottom: 30px;
}

.config-section {
  background: #f9f9f9;
  padding: 20px;
  border-radius: 12px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
  margin-bottom: 30px;
}

.input-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: bold;
}

textarea {
  width: 100%;
  height: 80px;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #ddd;
  margin-bottom: 20px;
  box-sizing: border-box;
}

.search-input-wrapper {
  display: flex;
  gap: 10px;
}

input {
  flex: 1;
  padding: 12px;
  border-radius: 8px;
  border: 1px solid #ddd;
}

.refresh-btn {
  padding: 0 20px;
  border-radius: 8px;
  border: none;
  background: #4a90e2;
  color: white;
  cursor: pointer;
  font-size: 1.2rem;
  transition: background 0.3s;
}

.refresh-btn:hover:not(:disabled) {
  background: #357abd;
}

.refresh-btn:disabled {
  background: #ccc;
}

.suggestions-list {
  list-style: none;
  padding: 0;
  border: 1px solid #ddd;
  border-top: none;
  background: white;
  position: absolute;
  width: 100%;
  max-width: 760px;
  z-index: 10;
}

.suggestions-list li {
  padding: 10px;
  cursor: pointer;
}

.suggestions-list li:hover {
  background: #f0f0f0;
}

.forecast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
}

.day-card {
  padding: 20px;
  border-radius: 12px;
  border-left: 8px solid #ddd;
  background: white;
  box-shadow: 0 4px 12px rgba(0,0,0,0.05);
}

.day-card.favorable { border-left-color: #4caf50; background: #f1f8e9; }
.day-card.moyen { border-left-color: #ffc107; background: #fffde7; }
.day-card.défavorable { border-left-color: #f44336; background: #ffebee; }

.temp { font-size: 2rem; font-weight: bold; }
.ia-advice { margin-top: 15px; font-size: 0.9rem; border-top: 1px solid rgba(0,0,0,0.1); padding-top: 10px; }

.status-msg { text-align: center; font-style: italic; color: #666; }
.error-msg { color: #d32f2f; background: #ffcdd2; padding: 10px; border-radius: 8px; text-align: center; }
</style>
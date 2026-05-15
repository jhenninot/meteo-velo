<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'

// --- ÉTATS ---
const city = ref('')
const lat = ref(localStorage.getItem('selected_lat') || null)
const lon = ref(localStorage.getItem('selected_lon') || null)
const query = ref('')
const suggestions = ref([])
const consignes = ref(localStorage.getItem('user_consignes') || '')
const forecastData = ref(null)
const loading = ref(false)
const error = ref(null)

// --- CONFIGURATION ---
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'; 

// --- LOGIQUE AU CHARGEMENT ---
onMounted(() => {
  const savedCity = localStorage.getItem('selected_city')
  if (savedCity && lat.value && lon.value) {
    city.value = savedCity
    query.value = savedCity
    fetchForecast()
  }
})

// --- FONCTIONS ---

// Sauvegarder les consignes quand on quitte le champ texte
const saveConsignes = () => {
  localStorage.setItem('user_consignes', consignes.value)
}

// Formater la date (ex: "2026-05-15" -> "Vendredi 15 mai")
const formatDate = (dateString) => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  const date = new Date(year, month - 1, day);
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  const formatted = new Intl.DateTimeFormat('fr-FR', options).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// Calculer la rotation de l'icône de vent
const getWindStyle = (degrees) => {
  return {
    transform: `rotate(${degrees}deg)`,
    display: 'inline-block'
  };
}

// Déterminer l'icône météo principale en fonction des données
const getWeatherIcon = (periodData) => {
  if (!periodData) return 'mdi-help-circle-outline';
  
  if (periodData.precip >= 2) return 'mdi-weather-pouring';
  if (periodData.precip > 0 || periodData.rain >= 50) return 'mdi-weather-rainy';
  if (periodData.wind > 35) return 'mdi-weather-windy';
  if (periodData.rain > 20) return 'mdi-weather-partly-cloudy';
  
  return 'mdi-weather-sunny';
}

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

const selectCity = (selectedFeature) => {
  const cityName = selectedFeature.properties.name
  const coords = selectedFeature.geometry.coordinates 
  
  city.value = cityName
  query.value = cityName
  lon.value = coords[0] 
  lat.value = coords[1] 
  
  suggestions.value = [] 
  fetchForecast()
}

const fetchForecast = async () => {
  if (!city.value || !lat.value || !lon.value) {
    error.value = "Veuillez sélectionner une ville dans la liste pour avoir ses coordonnées."
    return
  }
  
  loading.value = true
  error.value = null
  suggestions.value = [] 
  
  localStorage.setItem('selected_city', city.value)
  localStorage.setItem('selected_lat', lat.value)
  localStorage.setItem('selected_lon', lon.value)
  localStorage.setItem('user_consignes', consignes.value)

  try {
    const response = await axios.post(`${API_BASE_URL}/api/forecast`, {
      city: city.value,
      lat: lat.value,       
      lon: lon.value,       
      consignes: consignes.value
    })
    forecastData.value = response.data
  } catch (err) {
    console.error("Erreur API:", err)
    error.value = "Impossible de récupérer les prévisions."
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="app-container">
    <header>
      <h1><span class="mdi mdi-bicycle"></span> Vélo Météo IA</h1>
    </header>

    <main>
      <section class="config-section">
        <div class="input-group">
          <label>Mes consignes (IA) :</label>
          <textarea 
            v-model="consignes" 
            placeholder="Ex: Je déteste la pluie. Je veux rouler au moins 2h l'après-midi..."
            @blur="saveConsignes"
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
              <span v-if="!loading" class="mdi mdi-refresh"></span>
              <span v-else class="mdi mdi-loading mdi-spin"></span>
            </button>
          </div>

          <ul v-if="suggestions && suggestions.length > 0" class="suggestions-list">
            <li v-for="(s, index) in suggestions" :key="index" @click="selectCity(s)">
              <strong>{{ s.properties.name }}</strong>
              <span class="region-text" v-if="s.properties.state || s.properties.country">
                - {{ s.properties.state || s.properties.country }}
              </span>
            </li>
          </ul>
        </div>
      </section>

      <div v-if="loading" class="status-msg">
        <span class="mdi mdi-brain"></span> Analyse météo en cours par l'IA...
      </div>
      <div v-if="error" class="error-msg">
        <span class="mdi mdi-alert-circle"></span> {{ error }}
      </div>

      <section v-if="forecastData && !loading" class="results-section">
        <h2>Prévisions pour {{ city }}</h2>
        
        <div class="forecast-grid">
          <div v-for="(day, index) in forecastData" :key="index" class="day-card">
            <h3><span class="mdi mdi-calendar"></span> {{ formatDate(day.date) }}</h3>
            
            <div class="day-split">
              <div class="half-day" :class="day.matin.favorable ? 'favorable' : 'defavorable'">
                <h4><span class="mdi weather-main-icon" :class="getWeatherIcon(day.matin)"></span> Matin</h4>
                <div class="metrics">
                  <span><span class="mdi mdi-thermometer"></span> {{ day.matin.temp }}°C</span>
                  
                  <span><span class="mdi mdi-water-percent"></span> {{ day.matin.rain }}%</span>
                  <span><span class="mdi mdi-weather-pouring"></span> {{ day.matin.precip || 0 }} mm</span>
                  
                  <span>
                    <span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.matin.dir)"></span>
                    {{ day.matin.wind }} km/h (Raf. {{ day.matin.gust }})
                  </span>
                </div>
                <div class="ia-advice">
                  <strong>Avis IA :</strong> {{ day.matin.conseil }}
                </div>
              </div>

              <div class="half-day" :class="day.apres_midi.favorable ? 'favorable' : 'defavorable'">
                <h4><span class="mdi weather-main-icon" :class="getWeatherIcon(day.apres_midi)"></span> Après-midi</h4>
                <div class="metrics">
                  <span><span class="mdi mdi-thermometer"></span> {{ day.apres_midi.temp }}°C</span>
                  
                  <span><span class="mdi mdi-water-percent"></span> {{ day.apres_midi.rain }}%</span>
                  <span><span class="mdi mdi-weather-pouring"></span> {{ day.apres_midi.precip || 0 }} mm</span>
                  
                  <span>
                    <span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.apres_midi.dir)"></span>
                    {{ day.apres_midi.wind }} km/h (Raf. {{ day.apres_midi.gust }})
                  </span>
                </div>
                <div class="ia-advice">
                  <strong>Avis IA :</strong> {{ day.apres_midi.conseil }}
                </div>
              </div>
            </div>

          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<style>
@import url('https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css');
</style>

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

header h1 {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}

.mdi-bicycle {
  color: #e67e22; 
  font-size: 1.2em;
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
  font-family: inherit;
}

.search-container {
  position: relative; 
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
  font-size: 1rem;
}

.refresh-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 60px;
  border-radius: 8px;
  border: none;
  background: #cecece;
  color: #333;
  cursor: pointer;
  font-size: 1.5rem;
  transition: background 0.3s;
}

.refresh-btn:hover:not(:disabled) {
  background: #a8a8a8;
}

.refresh-btn:disabled {
  background: #e0e0e0;
  cursor: not-allowed;
}

.suggestions-list {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: white;
  border: 1px solid #ccc;
  border-top: none;
  border-radius: 0 0 8px 8px;
  z-index: 1000;
  list-style: none;
  padding: 0;
  margin: 0;
  text-align: left;
  box-shadow: 0 4px 6px rgba(0,0,0,0.1);
  max-height: 250px;
  overflow-y: auto;
}

.suggestions-list li {
  padding: 12px 15px;
  cursor: pointer;
  border-bottom: 1px solid #eee;
  color: #333;
}

.suggestions-list li:hover {
  background-color: #f5f5f5;
}

.region-text {
  color: #777;
  font-size: 0.9em;
  margin-left: 5px;
}

.forecast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 20px;
}

.day-card {
  background: white;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  padding: 15px;
  border: 1px solid #eee;
}

.day-card h3 {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 0;
  margin-bottom: 15px;
  color: #333;
  border-bottom: 2px solid #eee;
  padding-bottom: 10px;
}

.day-split {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.half-day {
  padding: 12px;
  border-radius: 8px;
  border-left: 6px solid #ddd;
  background: #f9f9f9;
}

.half-day h4 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 10px 0;
  font-size: 1.1rem;
  color: #333;
}

/* Style de l'icône météo principale */
.weather-main-icon {
  font-size: 1.3em;
  color: #555;
}

/* On colore le soleil en orange s'il est là */
.mdi-weather-sunny {
  color: #f39c12;
}

/* On colore la pluie en bleu s'il pleut */
.mdi-weather-pouring, .mdi-weather-rainy {
  color: #3498db;
}

.metrics {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 0.9rem;
  font-weight: 500;
}

.metrics > span {
  display: flex;
  align-items: center;
  gap: 4px;
}

.wind-icon {
  color: #3498db;
  font-size: 1.1em;
}

.ia-advice {
  font-size: 0.9rem;
  color: #444;
  background: rgba(255, 255, 255, 0.5);
  padding: 8px;
  border-radius: 6px;
}

.half-day.favorable {
  border-left-color: #4caf50;
  background: #f1f8e9;
}

.half-day.defavorable {
  border-left-color: #f44336;
  background: #ffebee;
}

.status-msg { text-align: center; font-style: italic; color: #666; margin-top: 20px; display: flex; align-items: center; justify-content: center; gap: 8px; }
.error-msg { color: #d32f2f; background: #ffcdd2; padding: 10px; border-radius: 8px; text-align: center; margin-top: 20px; display: flex; align-items: center; justify-content: center; gap: 8px; }
</style>
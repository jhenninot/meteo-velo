<script setup>
import { ref, watch, onMounted } from 'vue'
import axios from 'axios'
// Ajout de l'icône Navigation pour la direction du vent
import { Bike, CloudRain, Wind, Thermometer, Search, Settings, Navigation } from 'lucide-vue-next'

const query = ref('')
const suggestions = ref([])
const forecast = ref(null)
const loading = ref(false)
const selectedLocation = ref('') 

const customPrompt = ref('')

onMounted(() => {
  const savedPrompt = localStorage.getItem('veloUserPrompt')
  if (savedPrompt) {
    customPrompt.value = savedPrompt
  }
})

watch(customPrompt, (newVal) => {
  localStorage.setItem('veloUserPrompt', newVal)
})

watch(query, async (newQuery) => {
  if (!newQuery || newQuery.length < 3) {
    suggestions.value = []
    return
  }
  try {
    const response = await axios.get(`http://localhost:3001/api/search?q=${newQuery}`)
    suggestions.value = response.data || []
  } catch (e) {
    console.error("Erreur recherche", e)
    suggestions.value = []
  }
})

const selectCity = async (city) => {
  query.value = city.properties.label || city.properties.name
  selectedLocation.value = city.properties.label || city.properties.name 
  suggestions.value = []
  loading.value = true
  
  try {
    const [lon, lat] = city.geometry.coordinates
    const response = await axios.post('http://localhost:3001/api/forecast', {
      lat, lon, 
      city: city.properties.name,
      customInstructions: customPrompt.value
    })
    forecast.value = response.data
  } catch (e) {
    alert("Erreur lors de la récupération des conseils")
  } finally {
    loading.value = false
  }
}

const formatDay = (dateString) => {
  const dateStr = new Date(dateString).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' })
  return dateStr.charAt(0).toUpperCase() + dateStr.slice(1)
}
</script>

<template>
  <div class="app-container">
    <header>
      <h1><Bike :size="32" /> Vélo Météo IA</h1>
      <p v-if="!selectedLocation">Optimisez vos sorties gravel et route</p>
      <h2 v-else class="selected-city">📍 Prévisions pour : {{ selectedLocation }}</h2>
    </header>

    <main>
      <div class="preferences-box">
        <label><Settings :size="16" /> Consignes pour l'IA (mémorisées)</label>
        <textarea 
          v-model="customPrompt" 
          placeholder="Ex: Je déteste la pluie. Je veux rouler au moins 2h l'après-midi. Je suis débutant..."
        ></textarea>
      </div>

      <div class="search-box">
        <div class="input-wrapper">
          <Search class="icon" />
          <input v-model="query" placeholder="Ex: Marcq-en-Barœul, Lille..." />
        </div>
        <ul v-if="suggestions.length" class="suggestions">
          <li v-for="s in suggestions" :key="s.properties.osm_id" @click="selectCity(s)">
            {{ s.properties.name }} {{ s.properties.state ? `(${s.properties.state})` : '' }}
          </li>
        </ul>
      </div>

      <div v-if="loading" class="loader">Analyse de la météo par Gemini...</div>

      <div v-if="forecast" class="results">
        <div v-for="(advice, index) in forecast.aiAdvice" :key="index" class="card">
          <h3>{{ formatDay(advice.date) }}</h3>
          
          <div class="weather-brief">
            <span class="weather-item">
              <Thermometer :size="28" color="#e74c3c"/> 
              <strong>{{ forecast.weather.temperature_2m_max[index] }}°C</strong>
            </span>
            <span class="weather-item">
              <CloudRain :size="28" color="#3498db"/> 
              <strong>{{ forecast.weather.precipitation_probability_max[index] }}%</strong>
            </span>
            <span class="weather-item">
              <Wind :size="28" color="#7f8c8d"/> 
              <strong>{{ forecast.weather.wind_speed_10m_max[index] }} km/h</strong>
              
              <Navigation 
                v-if="forecast.weather.wind_direction_10m_dominant && forecast.weather.wind_direction_10m_dominant[index]"
                :size="20" 
                color="#7f8c8d"
                :style="{ transform: `rotate(${forecast.weather.wind_direction_10m_dominant[index]}deg)` }"
                class="wind-direction"
              />

              <span class="gusts" v-if="forecast.weather.wind_gusts_10m_max && forecast.weather.wind_gusts_10m_max[index]">
                (Rafales : {{ forecast.weather.wind_gusts_10m_max[index] }} km/h)
              </span>
            </span>
          </div>

          <p class="ai-advice">
            <strong>Conseil IA :</strong> {{ advice.conseil }}
          </p>
        </div>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-container { max-width: 600px; margin: 0 auto; padding: 20px; font-family: sans-serif; }
header { text-align: center; margin-bottom: 30px; }
h1 { display: flex; align-items: center; justify-content: center; gap: 10px; color: #2c3e50; }
.selected-city { color: #42b983; font-size: 1.3rem; margin-top: 5px; font-weight: 600; }

.preferences-box { margin-bottom: 15px; }
.preferences-box label { display: flex; align-items: center; gap: 8px; font-size: 0.9em; color: #555; margin-bottom: 8px; font-weight: 600; }
.preferences-box textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #ccc; border-radius: 8px; font-family: inherit; font-size: 14px; resize: vertical; min-height: 65px; outline: none; transition: border-color 0.2s; background-color: #fafafa; }
.preferences-box textarea:focus { border-color: #42b983; background-color: #fff; }

.search-box { position: relative; margin-bottom: 20px; }
.input-wrapper { display: flex; align-items: center; border: 2px solid #ddd; padding: 10px; border-radius: 8px; background: white;}
input { border: none; outline: none; width: 100%; margin-left: 10px; font-size: 16px; }
.suggestions { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; list-style: none; padding: 0; z-index: 10; border-radius: 0 0 8px 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
.suggestions li { padding: 12px; cursor: pointer; }
.suggestions li:hover { background: #f0f0f0; }

.card { background: #f9f9f9; border-left: 5px solid #42b983; padding: 15px; margin-bottom: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.weather-brief { display: flex; flex-wrap: wrap; gap: 20px; margin: 15px 0; color: #333; font-size: 1.1em; }
.weather-item { display: flex; align-items: center; gap: 8px; }

/* Nouveau style pour l'icône de direction */
.wind-direction { margin-left: 2px; margin-right: 2px; }

.gusts { font-size: 0.85em; color: #e67e22; font-weight: normal; margin-left: 4px; }
.ai-advice { font-style: italic; color: #2c3e50; border-top: 1px solid #eee; padding-top: 10px; }
.loader { text-align: center; color: #42b983; font-weight: bold; margin: 20px 0; }
</style>
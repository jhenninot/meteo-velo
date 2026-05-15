<script setup>
import { ref, watch } from 'vue'
import axios from 'axios'
import { Bike, CloudRain, Wind, Thermometer, Search } from 'lucide-vue-next'

const query = ref('')
const suggestions = ref([])
const forecast = ref(null)
const loading = ref(false)
const selectedLocation = ref('') 

// 1. Recherche de ville (Autocomplétion)
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

// 2. Sélection de la ville et appel météo + IA
const selectCity = async (city) => {
  query.value = city.properties.label || city.properties.name
  selectedLocation.value = city.properties.label || city.properties.name 
  suggestions.value = []
  loading.value = true
  
  try {
    const [lon, lat] = city.geometry.coordinates
    const response = await axios.post('http://localhost:3001/api/forecast', {
      lat, lon, city: city.properties.name
    })
    forecast.value = response.data
  } catch (e) {
    alert("Erreur lors de la récupération des conseils")
  } finally {
    loading.value = false
  }
}

// 3. Formatage de la date avec majuscule
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
.search-box { position: relative; margin-bottom: 20px; }
.input-wrapper { display: flex; align-items: center; border: 2px solid #ddd; padding: 10px; border-radius: 8px; }
input { border: none; outline: none; width: 100%; margin-left: 10px; font-size: 16px; }
.suggestions { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; list-style: none; padding: 0; z-index: 10; border-radius: 0 0 8px 8px; }
.suggestions li { padding: 10px; cursor: pointer; }
.suggestions li:hover { background: #f0f0f0; }
.card { background: #f9f9f9; border-left: 5px solid #42b983; padding: 15px; margin-bottom: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.weather-brief { display: flex; flex-wrap: wrap; gap: 20px; margin: 15px 0; color: #333; font-size: 1.1em; }
.weather-item { display: flex; align-items: center; gap: 8px; }
.gusts { font-size: 0.85em; color: #e67e22; font-weight: normal; margin-left: 4px; }
.ai-advice { font-style: italic; color: #2c3e50; border-top: 1px solid #eee; padding-top: 10px; }
.loader { text-align: center; color: #42b983; font-weight: bold; }
</style>
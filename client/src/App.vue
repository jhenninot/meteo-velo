<script setup>
import { ref, watch } from 'vue'
import axios from 'axios'
import { Bike, CloudRain, Wind, Thermometer, Search } from 'lucide-vue-next'

const query = ref('')
const suggestions = ref([])
const forecast = ref(null)
const loading = ref(false)

// 1. Recherche de ville (Autocomplétion)
watch(query, async (newQuery) => {
  if (newQuery.length < 3) {
    suggestions.value = []
    return
  }
  try {
    const response = await axios.get(`http://localhost:3001/api/search?q=${newQuery}`)
    suggestions.value = response.data
  } catch (e) {
    console.error("Erreur recherche", e)
  }
})

// 2. Sélection de la ville et appel météo + IA
const selectCity = async (city) => {
  query.value = city.properties.label
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
</script>

<template>
  <div class="app-container">
    <header>
      <h1><Bike :size="32" /> Vélo Météo IA</h1>
      <p>Optimisez vos sorties gravel et route</p>
    </header>

    <main>
      <div class="search-box">
        <div class="input-wrapper">
          <Search class="icon" />
          <input v-model="query" placeholder="Où voulez-vous rouler ?" />
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
          <h3>{{ new Date(advice.date).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric' }) }}</h3>
          
          <div class="weather-brief">
            <span><Thermometer :size="16"/> {{ forecast.weather.temperature_2m_max[index] }}°C</span>
            <span><CloudRain :size="16"/> {{ forecast.weather.precipitation_probability_max[index] }}%</span>
            <span><Wind :size="16"/> {{ forecast.weather.wind_speed_10m_max[index] }} km/h</span>
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

.search-box { position: relative; margin-bottom: 20px; }
.input-wrapper { display: flex; align-items: center; border: 2px solid #ddd; padding: 10px; border-radius: 8px; }
input { border: none; outline: none; width: 100%; margin-left: 10px; font-size: 16px; }

.suggestions { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; list-style: none; padding: 0; z-index: 10; border-radius: 0 0 8px 8px; }
.suggestions li { padding: 10px; cursor: pointer; }
.suggestions li:hover { background: #f0f0f0; }

.card { background: #f9f9f9; border-left: 5px solid #42b983; padding: 15px; margin-bottom: 15px; border-radius: 4px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.weather-brief { display: flex; gap: 15px; margin: 10px 0; color: #666; font-size: 0.9em; }
.ai-advice { font-style: italic; color: #2c3e50; border-top: 1px solid #eee; pt: 10px; }
.loader { text-align: center; color: #42b983; font-weight: bold; }
</style>
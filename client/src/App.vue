<script setup>
import { ref, watch, onMounted } from 'vue'
import axios from 'axios'
import { Bike, CloudRain, Wind, Thermometer, Search, Settings, Navigation, CheckCircle, XCircle, Sunrise, Sun } from 'lucide-vue-next'

const query = ref('')
const suggestions = ref([])
const forecast = ref(null) // Recevra directement le tableau fusionné
const loading = ref(false)
const selectedLocation = ref('') 
const customPrompt = ref('')

onMounted(() => {
  const savedPrompt = localStorage.getItem('veloUserPrompt')
  if (savedPrompt) customPrompt.value = savedPrompt
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
    const response = await axios.get(`http://192.168.0.41:3001/api/search?q=${newQuery}`)
    suggestions.value = response.data || []
  } catch (e) {
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
    const response = await axios.post('http://192.168.0.41:3001/api/forecast', {
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
        <textarea v-model="customPrompt" placeholder="Ex: Je déteste la pluie. Je veux rouler au moins 2h l'après-midi..."></textarea>
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
        <div v-for="(day, index) in forecast" :key="index" class="card">
          <h3 class="day-title">{{ formatDay(day.date) }}</h3>
          
          <div class="half-day">
            <h4 class="half-day-title">
              <span class="period"><Sunrise :size="20"/> Matin (8h - 12h)</span>
              <CheckCircle v-if="day.matin.favorable" color="#2ecc71" :size="24" />
              <XCircle v-else color="#e74c3c" :size="24" />
            </h4>
            <div class="weather-brief">
              <span class="weather-item"><Thermometer :size="24" color="#e74c3c"/> <strong>{{ day.matin.temp }}°C</strong></span>
              <span class="weather-item"><CloudRain :size="24" color="#3498db"/> <strong>{{ day.matin.rain }}%</strong></span>
              <span class="weather-item">
                <Wind :size="24" color="#7f8c8d"/> <strong>{{ day.matin.wind }} km/h</strong>
                <Navigation :size="18" color="#7f8c8d" :style="{ transform: `rotate(${day.matin.dir}deg)` }" class="wind-direction"/>
                <span class="gusts">(Rafales : {{ day.matin.gust }})</span>
              </span>
            </div>
            <p class="ai-advice"><strong>IA :</strong> {{ day.matin.conseil }}</p>
          </div>

          <div class="half-day">
            <h4 class="half-day-title">
              <span class="period"><Sun :size="20"/> Après-midi (13h - 18h)</span>
              <CheckCircle v-if="day.apres_midi.favorable" color="#2ecc71" :size="24" />
              <XCircle v-else color="#e74c3c" :size="24" />
            </h4>
            <div class="weather-brief">
              <span class="weather-item"><Thermometer :size="24" color="#e74c3c"/> <strong>{{ day.apres_midi.temp }}°C</strong></span>
              <span class="weather-item"><CloudRain :size="24" color="#3498db"/> <strong>{{ day.apres_midi.rain }}%</strong></span>
              <span class="weather-item">
                <Wind :size="24" color="#7f8c8d"/> <strong>{{ day.apres_midi.wind }} km/h</strong>
                <Navigation :size="18" color="#7f8c8d" :style="{ transform: `rotate(${day.apres_midi.dir}deg)` }" class="wind-direction"/>
                <span class="gusts">(Rafales : {{ day.apres_midi.gust }})</span>
              </span>
            </div>
            <p class="ai-advice"><strong>IA :</strong> {{ day.apres_midi.conseil }}</p>
          </div>

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
.preferences-box textarea { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #ccc; border-radius: 8px; font-family: inherit; font-size: 14px; resize: vertical; min-height: 65px; outline: none; background-color: #fafafa; }
.preferences-box textarea:focus { border-color: #42b983; background-color: #fff; }

.search-box { position: relative; margin-bottom: 20px; }
.input-wrapper { display: flex; align-items: center; border: 2px solid #ddd; padding: 10px; border-radius: 8px; background: white;}
input { border: none; outline: none; width: 100%; margin-left: 10px; font-size: 16px; }
.suggestions { position: absolute; top: 100%; left: 0; right: 0; background: white; border: 1px solid #ddd; list-style: none; padding: 0; z-index: 10; border-radius: 0 0 8px 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.05); }
.suggestions li { padding: 12px; cursor: pointer; }
.suggestions li:hover { background: #f0f0f0; }

.card { background: #fff; padding: 0; margin-bottom: 25px; border-radius: 8px; box-shadow: 0 4px 10px rgba(0,0,0,0.05); border: 1px solid #eee; overflow: hidden; }
.day-title { background: #42b983; color: white; margin: 0; padding: 12px 20px; font-size: 1.2rem; text-align: center; }

.half-day { padding: 15px 20px; border-bottom: 1px solid #f0f0f0; }
.half-day:last-child { border-bottom: none; }

.half-day-title { display: flex; align-items: center; justify-content: space-between; margin: 0 0 10px 0; color: #2c3e50; }
.period { display: flex; align-items: center; gap: 8px; font-size: 1.1rem; }

.weather-brief { display: flex; flex-wrap: wrap; gap: 15px; margin: 10px 0; color: #444; font-size: 1.05em; }
.weather-item { display: flex; align-items: center; gap: 6px; }
.wind-direction { margin: 0 2px; }
.gusts { font-size: 0.85em; color: #e67e22; margin-left: 2px; }

.ai-advice { font-style: italic; color: #555; background: #f9f9f9; padding: 10px; border-radius: 6px; margin: 10px 0 0 0; font-size: 0.95rem; }
.loader { text-align: center; color: #42b983; font-weight: bold; margin: 20px 0; }
</style>
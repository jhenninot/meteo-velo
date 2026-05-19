<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import axios from 'axios'
import { jwtDecode } from 'jwt-decode'
import WeatherChart from './components/WeatherChart.vue'
import StravaActivities from './components/StravaActivities.vue'
import AdminPanel from './components/AdminPanel.vue'

// --- ÉTATS D'AUTHENTIFICATION ---
const isLoggedIn = ref(false)
const userRole = ref('') // 'admin' ou 'user'
const currentUser = ref('')
const loginUser = ref('')
const loginPass = ref('')
const loginError = ref('')

// --- ÉTATS NAVIGATION ---
const showAdminPanel = ref(false)
const showStravaPage = ref(false)

// --- ÉTATS DE L'APPLICATION MÉTÉO ---
const city = ref('')
const lat = ref(localStorage.getItem('selected_lat') || null)
const lon = ref(localStorage.getItem('selected_lon') || null)
const query = ref('')
const suggestions = ref([])
const consignes = ref(localStorage.getItem('user_consignes') || '')
const forecastData = ref(null)
const loading = ref(false)
const error = ref(null)
const expandedPeriods = ref({})

const togglePeriod = (dayIndex, period) => {
  const key = `${dayIndex}-${period}`
  expandedPeriods.value[key] = !expandedPeriods.value[key]
}

const storedTheme = localStorage.getItem('user_theme')
const theme = ref(storedTheme === 'dark' || storedTheme === 'light' || storedTheme === 'auto' ? storedTheme : 'auto')

const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)')
const isSystemDark = ref(systemPrefersDark.matches)
if (typeof systemPrefersDark.addEventListener === 'function') {
  systemPrefersDark.addEventListener('change', (e) => {
    isSystemDark.value = e.matches
  })
}

const isDark = computed(() => {
  return theme.value === 'dark' || (theme.value === 'auto' && isSystemDark.value)
})

const resolvedTheme = computed(() => isDark.value ? 'dark' : 'light')

const themeIcon = computed(() => {
  if (theme.value === 'light') return 'mdi-white-balance-sunny'
  if (theme.value === 'dark') return 'mdi-weather-night'
  return 'mdi-brightness-auto'
})

watch(isDark, (val) => {
  document.documentElement.classList.toggle('meteo-theme-dark', val)
}, { immediate: true })

// --- CONFIGURATION ---
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001'

// --- GESTION DE LA CONNEXION ---
const setupAxiosToken = (token) => {
  axios.defaults.headers.common['Authorization'] = `Bearer ${token}`
  
  axios.interceptors.response.use(
    response => response,
    err => {
      if (err.response && (err.response.status === 401 || err.response.status === 403)) {
        handleLogout()
      }
      return Promise.reject(err)
    }
  )
}

const handleLogin = async () => {
  loginError.value = ''
  try {
    const response = await axios.post(`${API_BASE_URL}/api/login`, {
      username: loginUser.value,
      password: loginPass.value
    })
    
    const { token, role, username, preferences } = response.data
    localStorage.setItem('auth_token', token)
    setupAxiosToken(token)
    
    isLoggedIn.value = true
    userRole.value = role
    currentUser.value = username
    
    // --- MISE À JOUR DES PRÉFÉRENCES ---
    if (preferences) {
      // On met à jour les variables réactives
      city.value = preferences.city || ''
      consignes.value = preferences.consignes || ''
      lat.value = preferences.lat || null
      lon.value = preferences.lon || null
      theme.value = preferences.theme === 'dark' || preferences.theme === 'light' || preferences.theme === 'auto' ? preferences.theme : 'auto'

      // On met aussi à jour le localStorage pour que initializeApp() soit cohérent
      localStorage.setItem('selected_city', city.value)
      localStorage.setItem('selected_lat', lat.value)
      localStorage.setItem('selected_lon', lon.value)
      localStorage.setItem('user_consignes', consignes.value)
      localStorage.setItem('user_theme', theme.value)
    } else {
      // Si l'utilisateur n'a aucune préférence en BDD, on vide le local pour ne pas
      // polluer sa session avec les données du précédent utilisateur
      localStorage.removeItem('selected_city')
      localStorage.removeItem('selected_lat')
      localStorage.removeItem('selected_lon')
      localStorage.removeItem('user_consignes')
      localStorage.removeItem('user_theme')
      city.value = ''; consignes.value = ''; lat.value = null; lon.value = null;
      theme.value = 'auto'
    }

    initializeApp()
  } catch (err) {
    loginError.value = "Identifiant ou mot de passe incorrect."
  }
}

const handleLogout = () => {
  localStorage.removeItem('auth_token')
  localStorage.removeItem('user_theme')
  delete axios.defaults.headers.common['Authorization']
  isLoggedIn.value = false
  userRole.value = ''
  currentUser.value = ''
  forecastData.value = null
  showAdminPanel.value = false
  showStravaPage.value = false
  theme.value = 'auto'
}

const openAdmin = () => {
  showAdminPanel.value = true
}

const syncPreferences = async () => {
  if (!isLoggedIn.value) return
  try {
    await axios.post(`${API_BASE_URL}/api/user/preferences`, {
      city: city.value,
      lat: lat.value,
      lon: lon.value,
      consignes: consignes.value,
      theme: theme.value
    })
  } catch (err) {
    console.error("Erreur de synchronisation BDD", err)
  }
}

const loadUserPreferences = async () => {
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/user/preferences`)
    if (data.theme === 'dark' || data.theme === 'light' || data.theme === 'auto') {
      theme.value = data.theme
      localStorage.setItem('user_theme', theme.value)
    }
  } catch (err) {
    console.error('Erreur chargement préférences', err)
  }
}

const setTheme = (mode) => {
  if (mode === 'dark' || mode === 'light' || mode === 'auto') {
    theme.value = mode
    localStorage.setItem('user_theme', theme.value)
    syncPreferences()
  }
}

onMounted(async () => {
  const token = localStorage.getItem('auth_token')
  if (token) {
    try {
      setupAxiosToken(token)
      const decoded = jwtDecode(token)
      isLoggedIn.value = true
      currentUser.value = decoded.username
      userRole.value = decoded.role

      await loadUserPreferences()
      initializeApp()

      // Retour callback Strava → ouvrir la page Activités
      const urlParams = new URLSearchParams(window.location.search)
      if (urlParams.has('strava')) {
        showStravaPage.value = true
        showAdminPanel.value = false
      }
    } catch (err) {
      handleLogout()
    }
  }
})

const initializeApp = () => {
  const savedCity = localStorage.getItem('selected_city') || city.value
  if (savedCity && lat.value && lon.value) {
    city.value = savedCity
    query.value = savedCity
    fetchForecast()
  }
}

const saveConsignes = () => {
  localStorage.setItem('user_consignes', consignes.value);
  syncPreferences();
}

const formatDate = (dateString) => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  const date = new Date(year, month - 1, day);
  const options = { weekday: 'long', day: 'numeric', month: 'long' };
  const formatted = new Intl.DateTimeFormat('fr-FR', options).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

const getWindStyle = (degrees) => ({ transform: `rotate(${degrees}deg)`, display: 'inline-block' })

const critereLabels = {
  temperature: 'Température',
  pluie: 'Probabilité de pluie',
  precipitations: 'Précipitations',
  vent: 'Vent',
  rafales: 'Rafales'
}

const critereClass = (period, key) => {
  const v = period?.criteres?.[key]
  if (v === 'favorable') return 'metric-critere critere-fav'
  if (v === 'defavorable') return 'metric-critere critere-def'
  return 'metric-critere critere-neutre'
}

const critereWindClass = (period) => {
  const v = period?.criteres?.vent
  const r = period?.criteres?.rafales
  if (v === 'defavorable' || r === 'defavorable') return 'metric-critere critere-def'
  if (v === 'favorable' && r === 'favorable') return 'metric-critere critere-fav'
  if (v === 'favorable' || r === 'favorable') return 'metric-critere critere-fav'
  return 'metric-critere critere-neutre'
}

const defavorableCritereLabels = (period) => {
  const c = period?.criteres
  if (!c) return []
  return Object.entries(c)
    .filter(([, val]) => val === 'defavorable')
    .map(([k]) => critereLabels[k] || k)
}

const getWeatherIcon = (periodData) => {
  if (!periodData) return 'mdi-help-circle-outline';
  if (periodData.precip >= 2) return 'mdi-weather-pouring';
  if (periodData.precip > 0 || periodData.rain >= 50) return 'mdi-weather-rainy';
  if (periodData.wind > 35) return 'mdi-weather-windy';
  if (periodData.rain > 20) return 'mdi-weather-partly-cloudy';
  return 'mdi-weather-sunny';
}

const searchCities = async () => {
  if (query.value.length < 3) { suggestions.value = []; return; }
  try {
    const response = await axios.get(`${API_BASE_URL}/api/search?q=${query.value}`)
    suggestions.value = response.data 
  } catch (err) { console.error(err) }
}

const selectCity = (selectedFeature) => {
  city.value = selectedFeature.properties.name
  query.value = city.value
  lon.value = selectedFeature.geometry.coordinates[0] 
  lat.value = selectedFeature.geometry.coordinates[1] 
  suggestions.value = [] 
  fetchForecast()
  syncPreferences()
}

const fetchForecast = async () => {
  if (!city.value || !lat.value || !lon.value) return;
  loading.value = true
  error.value = null
  suggestions.value = [] 
  
  localStorage.setItem('selected_city', city.value)
  localStorage.setItem('selected_lat', lat.value)
  localStorage.setItem('selected_lon', lon.value)
  localStorage.setItem('user_consignes', consignes.value)

  try {
    const response = await axios.post(`${API_BASE_URL}/api/forecast`, {
      city: city.value, lat: lat.value, lon: lon.value, consignes: consignes.value
    })
    forecastData.value = response.data
  } catch (err) {
    if (err.response?.status !== 401) {
      error.value = "Impossible de récupérer les prévisions."
    }
  } finally {
    loading.value = false
    syncPreferences()
  }
}
</script>

<template>
  <div class="app-container" :class="{ 'theme-dark': isDark }">
    <header>
      <h1><img src="/logo_velo.png" alt="Logo" class="app-logo" /> Vélo Météo IA</h1>
      
      <div v-if="isLoggedIn" class="header-controls">
        <div class="theme-select-wrapper">
          <span class="mdi" :class="themeIcon"></span>
          <select :value="theme" @change="setTheme($event.target.value)" class="theme-select" aria-label="Sélectionner le thème">
            <option value="light">Jour</option>
            <option value="auto">Auto</option>
            <option value="dark">Nuit</option>
          </select>
        </div>
        <nav class="main-nav">
          <button @click="showAdminPanel = false; showStravaPage = false" :class="{ active: !showAdminPanel && !showStravaPage }">
            <span class="mdi mdi-weather-sunny"></span> Météo
          </button>
          <button @click="showAdminPanel = false; showStravaPage = true" :class="{ active: showStravaPage }">
            <span class="mdi mdi-bike"></span> Activités
          </button>
          <button v-if="userRole === 'admin'" @click="showAdminPanel = true; showStravaPage = false" :class="{ active: showAdminPanel }">
            <span class="mdi mdi-shield-account"></span> Admin
          </button>
        </nav>
        
        <button @click="handleLogout" class="logout-btn" title="Déconnexion">
          <span class="mdi mdi-logout"></span>
        </button>
      </div>
    </header>

    <main v-if="!isLoggedIn" class="login-screen">
      <div class="login-box">
        <h2><span class="mdi mdi-lock"></span> Accès Réservé</h2>
        <div v-if="loginError" class="login-error">{{ loginError }}</div>
        
        <form @submit.prevent="handleLogin">
          <div class="input-group">
            <label>Utilisateur :</label>
            <input v-model="loginUser" type="text" autocomplete="username" />
          </div>

          <div class="input-group">
            <label>Mot de passe :</label>
            <input v-model="loginPass" type="password" autocomplete="current-password" />
          </div>

          <button type="submit" class="login-btn">Se connecter</button>
        </form>
      </div>
    </main>

    <AdminPanel v-else-if="showAdminPanel" :api-base-url="API_BASE_URL" :is-dark="isDark" />
    <main v-else-if="showStravaPage">
      <StravaActivities :theme="resolvedTheme" :api-base-url="API_BASE_URL" />
    </main>
    <main v-else>
      <section class="config-section">
        <div class="input-group">
          <label><span class="mdi mdi-robot"></span> Mes consignes (IA) :</label>
          <textarea v-model="consignes" placeholder="Ex: Pas de vent > 20km/h..." @blur="saveConsignes"></textarea>
        </div>

        <div class="search-container">
          <div class="search-input-wrapper">
            <input v-model="query" @input="searchCities" placeholder="Ville..." @keyup.enter="fetchForecast"/>
            <button @click="fetchForecast" :disabled="loading || !city" class="refresh-btn">
              <span v-if="!loading" class="mdi mdi-refresh"></span>
              <span v-else class="mdi mdi-loading mdi-spin"></span>
            </button>
          </div>
          <ul v-if="suggestions.length > 0" class="suggestions-list">
            <li v-for="(s, index) in suggestions" :key="index" @click="selectCity(s)">
              <strong>{{ s.properties.name }}</strong>
              <span class="region-text" v-if="s.properties.state">- {{ s.properties.state }}</span>
            </li>
          </ul>
        </div>
      </section>

      <div v-if="loading" class="status-msg"><span class="mdi mdi-brain"></span> Analyse IA en cours...</div>
      <div v-if="error" class="error-msg"><span class="mdi mdi-alert-circle"></span> {{ error }}</div>

      <section v-if="forecastData && !loading" class="results-section">
        <div class="forecast-grid">
          <div v-for="(day, index) in forecastData" :key="index" class="day-card">
            <h3><span class="mdi mdi-calendar"></span> {{ formatDate(day.date) }}</h3>
            <div class="day-split">
              <div v-if="day.matin" class="half-day" :class="[day.matin.favorable ? 'favorable' : 'defavorable', { 'is-expanded': expandedPeriods[`${index}-matin`] }]" @click="togglePeriod(index, 'matin')">
                <span
                  class="bike-day-indicator"
                  :class="day.matin.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'"
                  :title="day.matin.favorable ? 'Conditions favorables au vélo' : 'Conditions défavorables au vélo'"
                  role="img"
                  :aria-label="day.matin.favorable ? 'Vélo : conditions favorables' : 'Vélo : conditions défavorables'"
                >
                  <span class="mdi mdi-bike bike-day-indicator__icon" aria-hidden="true"></span>
                </span>
                <h4 class="half-day-heading">
                  <span class="mdi weather-main-icon" :class="getWeatherIcon(day.matin)"></span>
                  <span class="half-day-heading-label">Matin</span>
                </h4>
                <div class="metrics">
                  <span :class="critereClass(day.matin, 'temperature')"><span class="mdi mdi-thermometer"></span> {{ day.matin.temp }}°C</span>
                  <span :class="critereClass(day.matin, 'pluie')"><span class="mdi mdi-water-percent"></span> {{ day.matin.rain }}%</span>
                  <span :class="critereClass(day.matin, 'precipitations')"><span class="mdi mdi-weather-pouring"></span> {{ day.matin.precip }}mm</span>
                  <span :class="critereWindClass(day.matin)"><span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.matin.dir)"></span> {{ day.matin.wind }}km/h ({{ day.matin.gust }})</span>
                </div>
                <div v-if="defavorableCritereLabels(day.matin).length" class="facteurs-def">
                  Facteurs défavorables : {{ defavorableCritereLabels(day.matin).join(' · ') }}
                </div>
                <div class="ia-advice">{{ day.matin.conseil }}</div>
                
                <div v-if="expandedPeriods[`${index}-matin`] && day.matin.hourly">
                  <WeatherChart :hourlyData="day.matin.hourly" :theme="resolvedTheme" />
                </div>
              </div>
              <div v-if="day.apres_midi" class="half-day" :class="[day.apres_midi.favorable ? 'favorable' : 'defavorable', { 'is-expanded': expandedPeriods[`${index}-apres_midi`] }]" @click="togglePeriod(index, 'apres_midi')">
                <span
                  class="bike-day-indicator"
                  :class="day.apres_midi.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'"
                  :title="day.apres_midi.favorable ? 'Conditions favorables au vélo' : 'Conditions défavorables au vélo'"
                  role="img"
                  :aria-label="day.apres_midi.favorable ? 'Vélo : conditions favorables' : 'Vélo : conditions défavorables'"
                >
                  <span class="mdi mdi-bike bike-day-indicator__icon" aria-hidden="true"></span>
                </span>
                <h4 class="half-day-heading">
                  <span class="mdi weather-main-icon" :class="getWeatherIcon(day.apres_midi)"></span>
                  <span class="half-day-heading-label">Après-midi</span>
                </h4>
                <div class="metrics">
                  <span :class="critereClass(day.apres_midi, 'temperature')"><span class="mdi mdi-thermometer"></span> {{ day.apres_midi.temp }}°C</span>
                  <span :class="critereClass(day.apres_midi, 'pluie')"><span class="mdi mdi-water-percent"></span> {{ day.apres_midi.rain }}%</span>
                  <span :class="critereClass(day.apres_midi, 'precipitations')"><span class="mdi mdi-weather-pouring"></span> {{ day.apres_midi.precip }}mm</span>
                  <span :class="critereWindClass(day.apres_midi)"><span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.apres_midi.dir)"></span> {{ day.apres_midi.wind }}km/h ({{ day.apres_midi.gust }})</span>
                </div>
                <div v-if="defavorableCritereLabels(day.apres_midi).length" class="facteurs-def">
                  Facteurs défavorables : {{ defavorableCritereLabels(day.apres_midi).join(' · ') }}
                </div>
                <div class="ia-advice">{{ day.apres_midi.conseil }}</div>
                
                <div v-if="expandedPeriods[`${index}-apres_midi`] && day.apres_midi.hourly">
                  <WeatherChart :hourlyData="day.apres_midi.hourly" :theme="resolvedTheme" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>



<style scoped>
/* STRUCTURE GENERALE */
.app-container { max-width: 1200px; margin: 0 auto; padding: 20px; color: var(--text-primary); }
@media (max-width: 600px) {
  .app-container { padding: 4px; }
}
header { display: flex; flex-direction: column; align-items: stretch; gap: 12px; margin-bottom: 30px; border-bottom: 2px solid var(--border-color); padding-bottom: 15px; }
header h1 { margin: 0; display: flex; align-items: center; gap: 15px; font-size: 1.5rem; align-self: flex-start; }
.app-logo { height: 40px; width: auto; vertical-align: middle; }

/* NAVIGATION & BOUTONS */
.header-controls { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 15px; }
.main-nav { display: flex; background: var(--nav-bg); padding: 4px; border-radius: var(--radius-md); gap: 2px; }
.main-nav button { border: none; padding: 6px 12px; cursor: pointer; border-radius: var(--radius-sm); background: transparent; font-weight: bold; color: var(--text-secondary); display: flex; align-items: center; gap: 5px; font-size: 0.88rem; }
.main-nav button.active { background: var(--nav-active-bg); color: var(--nav-active-color); box-shadow: var(--shadow-sm); }
.theme-select-wrapper { display: inline-flex; align-items: center; gap: 6px; background: var(--nav-bg); padding: 5px 10px; border-radius: var(--radius-md); color: var(--text-secondary); font-weight: 600; font-size: 0.88rem; box-sizing: border-box; }
.theme-select-wrapper .mdi { font-size: 1.1rem; color: var(--text-secondary); display: flex; align-items: center; }
.theme-select { border: none !important; background: transparent !important; box-shadow: none !important; padding: 0 !important; font-weight: 600; color: var(--text-secondary) !important; cursor: pointer; outline: none !important; font-family: inherit; font-size: 0.88rem; width: auto; }
.theme-select option { background: var(--bg-surface); color: var(--text-primary); }
.logout-btn { background: var(--color-danger); color: white; border: none; padding: 8px; border-radius: var(--radius-sm); cursor: pointer; display: flex; align-items: center; }

/* ÉCRAN LOGIN */
.login-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; margin-top: 40px; gap: 20px; }
.login-box { background: var(--bg-surface-2); padding: 30px; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); width: 100%; max-width: 400px; box-sizing: border-box; }
.login-error { background: #ffebee; color: #d32f2f; padding: 10px; border-radius: var(--radius-sm); margin-bottom: 15px; text-align: center; }
.login-btn { width: 100%; background: var(--color-primary); color: white; border: none; padding: 12px; border-radius: var(--radius-md); font-size: 1.1rem; cursor: pointer; margin-top: 10px; }

/* MÉTÉO GRID */
.forecast-grid { display: grid; gap: 15px; grid-template-columns: 1fr; }
@media (max-width: 600px) {
  .forecast-grid { gap: 10px; }
  .day-card { padding: 8px; border-radius: var(--radius-md); }
}
@media (min-width: 768px) {
  .forecast-grid { grid-template-columns: repeat(2, 1fr); gap: 20px; }
}
@media (min-width: 1024px) {
  .forecast-grid { grid-template-columns: repeat(3, 1fr); }
}
.day-card { background: var(--bg-surface); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); padding: 15px; border: 1px solid var(--border-color); }
.day-card h3 { text-align: center; border-bottom: 2px solid var(--border-color); padding-bottom: 8px; margin-top: 0; color: var(--text-primary); }
.day-split { display: flex; flex-direction: column; gap: 10px; }
.half-day { position: relative; padding: 12px; border-radius: var(--radius-md); border-left: 6px solid var(--border-color); background: transparent; cursor: pointer; transition: filter 0.2s, box-shadow 0.2s; box-shadow: var(--shadow-sm); }
.half-day:hover { filter: brightness(0.96); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.half-day.favorable { border-left-color: var(--color-primary); background: transparent; }
.half-day.defavorable { border-left-color: var(--color-danger); background: transparent; }
.half-day h4 { margin: 0 0 10px; font-size: 1rem; }
.half-day-heading { display: flex; align-items: center; gap: 12px; flex-wrap: nowrap; margin-right: 3.5rem; }
.half-day-heading-label { font-weight: 600; }

.hourly-details { margin-top: 15px; border-top: 1px solid rgba(0,0,0,0.1); padding-top: 10px; font-size: 0.85rem; }
.hourly-row { display: grid; grid-template-columns: 1fr 1fr 1.2fr 1.2fr 1.5fr; padding: 4px 0; border-bottom: 1px solid rgba(0,0,0,0.05); align-items: center; }
.hourly-row:last-child { border-bottom: none; }
.hourly-header { font-weight: bold; color: #666; border-bottom: 1px solid rgba(0,0,0,0.15); margin-bottom: 4px; }
.hour-label { font-weight: 600; }

.hour-rain-qty { display: flex; align-items: center; gap: 8px; }
.rain-bar-container { flex: 1; height: 6px; background: rgba(0,0,0,0.05); border-radius: 4px; overflow: hidden; display: flex; }
.rain-bar { height: 100%; background: #2196f3; border-radius: 4px; transition: width 0.3s; }
.rain-val { width: 35px; text-align: right; font-size: 0.8rem; color: #555; }

.bike-day-indicator {
  --bike-d: 2rem;
  position: absolute;
  top: 15px;
  right: 15px;
  z-index: 1;
  width: var(--bike-d);
  height: var(--bike-d);
  box-sizing: border-box;
  border-radius: 50%;
  border: 2.5px solid currentColor;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  background: rgba(255, 255, 255, 0.55);
}
.bike-day-indicator__icon {
  font-size: 1rem;
  line-height: 1;
  position: relative;
  z-index: 0;
}
.bike-day-favorable { color: #4caf50; background: transparent; border-color: transparent; }
.bike-day-favorable .bike-day-indicator__icon { color: inherit; font-size: 1.5rem; }
.bike-day-defavorable { color: #f44336; }
.bike-day-defavorable .bike-day-indicator__icon { color: inherit; }
.bike-day-defavorable::before {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 1;
  /* Longueur = diamètre extérieur : les extrémités touchent le cercle du badge */
  width: var(--bike-d, 3.15rem);
  height: 0.16rem;
  margin-left: calc(var(--bike-d, 3.15rem) / -2);
  margin-top: -0.08rem;
  background: currentColor;
  border-radius: 0.08rem;
  pointer-events: none;
  transform-origin: center center;
}
.bike-day-defavorable::before {
  transform: rotate(45deg);
}

/* METRICS & ICONS */
.metrics { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0; font-size: 0.85rem; font-weight: 600; margin-right: 3.5rem; }
.metrics span { display: flex; align-items: center; gap: 3px; }
.weather-main-icon { font-size: 2.75rem; line-height: 1; flex-shrink: 0; }
.half-day.favorable h4 .weather-main-icon { color: var(--color-primary); }
.half-day.defavorable h4 .weather-main-icon { color: var(--color-danger); }
.metrics .metric-critere.critere-fav .mdi { color: var(--color-primary-dark); }
.metrics .metric-critere.critere-def .mdi { color: var(--color-danger-dark); }
.metrics .metric-critere.critere-neutre .mdi { color: #757575; }
.facteurs-def { font-size: 0.8rem; font-weight: 600; color: #b71c1c; margin: 6px 0 4px; }
.ia-advice { font-size: 0.9rem; font-style: italic; color: var(--text-secondary); background: rgba(255,255,255,0.5); padding: 6px; border-radius: 4px; }

/* SUGGESTIONS & STATUS */
.search-container { position: relative; margin-bottom: 3rem; }
.search-input-wrapper { display: flex; gap: 8px; }
.refresh-btn { flex-shrink: 0; background: var(--color-primary); color: white; border: none; border-radius: var(--radius-md); padding: 10px 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.suggestions-list { position: absolute; width: 100%; background: var(--bg-surface); border: 1px solid var(--border-input); z-index: 10; list-style: none; padding: 0; margin: 0; border-radius: var(--radius-md); }
.suggestions-list li { padding: 10px; cursor: pointer; border-bottom: 1px solid var(--border-color); color: var(--text-primary); }
.status-msg, .error-msg { text-align: center; margin-top: 20px; padding: 10px; border-radius: var(--radius-md); }
.error-msg { background: #ffcdd2; color: #b71c1c; }

/* Mode nuit — les variables CSS gèrent l'essentiel automatiquement
   Seules les surcharges non couvertes par les variables restent ici */
.app-container.theme-dark .half-day:hover { filter: brightness(1.15); }
.app-container.theme-dark .half-day.favorable { border-left-color: #66bb6a; }
.app-container.theme-dark .half-day.defavorable { border-left-color: #e57373; }
.app-container.theme-dark .bike-day-indicator { background: rgba(0, 0, 0, 0.35); }
.app-container.theme-dark .bike-day-indicator.bike-day-favorable { background: transparent; border-color: transparent; }
.app-container.theme-dark .bike-day-favorable { color: var(--color-primary-light); }
.app-container.theme-dark .bike-day-defavorable { color: var(--color-danger-light); }
.app-container.theme-dark .half-day.favorable h4 .weather-main-icon { color: var(--color-primary-light); }
.app-container.theme-dark .half-day.defavorable h4 .weather-main-icon { color: var(--color-danger-light); }
.app-container.theme-dark .metrics .metric-critere.critere-fav .mdi { color: #a5d6a7; }
.app-container.theme-dark .metrics .metric-critere.critere-def .mdi { color: var(--color-danger-light); }
.app-container.theme-dark .metrics .metric-critere.critere-neutre .mdi { color: #9aa0a6; }
.app-container.theme-dark .facteurs-def { color: #ffab91; }
.app-container.theme-dark .ia-advice { color: #c5cad3; background: rgba(0,0,0,0.2); }
.app-container.theme-dark .login-error { background: #4a2328; color: #ffcdd2; }
.app-container.theme-dark .error-msg { background: #4a2328; color: #ffcdd2; }
.app-container.theme-dark .status-msg { color: var(--text-secondary); }
</style>
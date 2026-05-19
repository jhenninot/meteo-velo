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
const showAccountPanel = ref(false)
const passwordForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' })
const passwordMsg = ref({ text: '', type: '' })
const passwordLoading = ref(false)
const showLoginPassword = ref(false)
const visiblePasswordFields = ref({})

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
  showAccountPanel.value = false
  theme.value = 'auto'
}

const openAdmin = () => {
  showAdminPanel.value = true
  showStravaPage.value = false
  showAccountPanel.value = false
}

const openWeather = () => {
  showAdminPanel.value = false
  showStravaPage.value = false
  showAccountPanel.value = false
}

const openStrava = () => {
  showAdminPanel.value = false
  showStravaPage.value = true
  showAccountPanel.value = false
}

const openAccount = () => {
  showAdminPanel.value = false
  showStravaPage.value = false
  showAccountPanel.value = true
}

const handlePasswordChange = async () => {
  passwordMsg.value = { text: '', type: '' }
  if (passwordForm.value.newPassword !== passwordForm.value.confirmPassword) {
    passwordMsg.value = { text: "La confirmation ne correspond pas au nouveau mot de passe.", type: 'error' }
    return
  }

  passwordLoading.value = true
  try {
    await axios.patch(`${API_BASE_URL}/api/user/password`, {
      currentPassword: passwordForm.value.currentPassword,
      newPassword: passwordForm.value.newPassword
    })
    passwordForm.value = { currentPassword: '', newPassword: '', confirmPassword: '' }
    passwordMsg.value = { text: "Mot de passe mis à jour.", type: 'success' }
  } catch (err) {
    passwordMsg.value = { text: err.response?.data?.error || "Impossible de modifier le mot de passe.", type: 'error' }
  } finally {
    passwordLoading.value = false
  }
}

const togglePasswordVisibility = (field) => {
  visiblePasswordFields.value[field] = !visiblePasswordFields.value[field]
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
      <div class="header-top">
        <h1><img src="/logo_velo.png" alt="Logo" class="app-logo" /> Vélo Météo IA</h1>
        <div v-if="isLoggedIn" class="header-actions">
          <div class="theme-select-wrapper">
            <span class="mdi" :class="themeIcon"></span>
            <select :value="theme" @change="setTheme($event.target.value)" class="theme-select" aria-label="Sélectionner le thème">
              <option value="light">Jour</option>
              <option value="auto">Auto</option>
              <option value="dark">Nuit</option>
            </select>
          </div>
          <button @click="openAccount" class="account-btn" :class="{ active: showAccountPanel }" title="Mon compte">
            <span class="mdi mdi-account-cog"></span>
            <span>Compte</span>
          </button>
          <button @click="handleLogout" class="logout-btn" title="Déconnexion">
            <span class="mdi mdi-logout"></span>
          </button>
        </div>
      </div>

      <div v-if="isLoggedIn" class="header-controls">
        <nav class="main-nav">
          <button @click="openWeather" :class="{ active: !showAdminPanel && !showStravaPage && !showAccountPanel }">
            <span class="mdi mdi-weather-sunny"></span> Météo
          </button>
          <button @click="openStrava" :class="{ active: showStravaPage }">
            <span class="mdi mdi-bike"></span> Activités
          </button>
          <button v-if="userRole === 'admin'" @click="openAdmin" :class="{ active: showAdminPanel }">
            <span class="mdi mdi-shield-account"></span> Admin
          </button>
        </nav>
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
            <div class="password-input-wrapper">
              <input v-model="loginPass" :type="showLoginPassword ? 'text' : 'password'" autocomplete="current-password" />
              <button type="button" class="password-toggle" @click="showLoginPassword = !showLoginPassword" :aria-label="showLoginPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'">
                <span class="mdi" :class="showLoginPassword ? 'mdi-eye-off' : 'mdi-eye'"></span>
              </button>
            </div>
          </div>

          <button type="submit" class="login-btn">Se connecter</button>
        </form>
      </div>
    </main>

    <AdminPanel v-else-if="showAdminPanel" :api-base-url="API_BASE_URL" :is-dark="isDark" />
    <main v-else-if="showAccountPanel" class="account-screen">
      <div class="account-box">
        <h2><span class="mdi mdi-account-cog"></span> Mon compte</h2>
        <p class="account-user">Connecté en tant que <strong>{{ currentUser }}</strong></p>
        <div v-if="passwordMsg.text" :class="['msg-banner', passwordMsg.type]">{{ passwordMsg.text }}</div>
        <form @submit.prevent="handlePasswordChange">
          <div class="input-group">
            <label>Mot de passe actuel :</label>
            <div class="password-input-wrapper">
              <input v-model="passwordForm.currentPassword" :type="visiblePasswordFields.currentPassword ? 'text' : 'password'" autocomplete="current-password" required />
              <button type="button" class="password-toggle" @click="togglePasswordVisibility('currentPassword')" :aria-label="visiblePasswordFields.currentPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'">
                <span class="mdi" :class="visiblePasswordFields.currentPassword ? 'mdi-eye-off' : 'mdi-eye'"></span>
              </button>
            </div>
          </div>
          <div class="input-group">
            <label>Nouveau mot de passe :</label>
            <div class="password-input-wrapper">
              <input v-model="passwordForm.newPassword" :type="visiblePasswordFields.newPassword ? 'text' : 'password'" autocomplete="new-password" required />
              <button type="button" class="password-toggle" @click="togglePasswordVisibility('newPassword')" :aria-label="visiblePasswordFields.newPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'">
                <span class="mdi" :class="visiblePasswordFields.newPassword ? 'mdi-eye-off' : 'mdi-eye'"></span>
              </button>
            </div>
          </div>
          <div class="input-group">
            <label>Confirmer le nouveau mot de passe :</label>
            <div class="password-input-wrapper">
              <input v-model="passwordForm.confirmPassword" :type="visiblePasswordFields.confirmPassword ? 'text' : 'password'" autocomplete="new-password" required />
              <button type="button" class="password-toggle" @click="togglePasswordVisibility('confirmPassword')" :aria-label="visiblePasswordFields.confirmPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'">
                <span class="mdi" :class="visiblePasswordFields.confirmPassword ? 'mdi-eye-off' : 'mdi-eye'"></span>
              </button>
            </div>
          </div>
          <p class="password-rules">Minimum 10 caractères, avec une majuscule, une minuscule, un chiffre et un caractère spécial.</p>
          <button type="submit" class="login-btn" :disabled="passwordLoading">
            {{ passwordLoading ? 'Modification...' : 'Modifier mon mot de passe' }}
          </button>
        </form>
      </div>
    </main>
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

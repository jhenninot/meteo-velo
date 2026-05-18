<script setup>
import { ref, onMounted, watch } from 'vue'
import axios from 'axios'
import { jwtDecode } from 'jwt-decode'
import WeatherChart from './components/WeatherChart.vue'

// --- ÉTATS D'AUTHENTIFICATION ---
const isLoggedIn = ref(false)
const userRole = ref('') // 'admin' ou 'user'
const currentUser = ref('')
const loginUser = ref('')
const loginPass = ref('')
const loginError = ref('')

// --- ÉTATS ADMIN ---
const showAdminPanel = ref(false)
const newUser = ref({ username: '', password: '', role: 'user' })
const adminMsg = ref({ text: '', type: '' })
const usersList = ref([])

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
const theme = ref(storedTheme === 'dark' ? 'dark' : 'light')

watch(theme, (t) => {
  document.documentElement.classList.toggle('meteo-theme-dark', t === 'dark')
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
      theme.value = preferences.theme === 'dark' ? 'dark' : 'light'

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
      theme.value = 'light'
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
  theme.value = 'light'
}

const createUser = async () => {
  adminMsg.value = { text: '', type: '' }
  try {
    const response = await axios.post(`${API_BASE_URL}/api/admin/create-user`, newUser.value)
    
    // 1. On affiche le message de succès
    adminMsg.value = { text: `Utilisateur ${newUser.value.username} créé avec succès !`, type: 'success' }
    
    // 2. On vide le formulaire pour le prochain utilisateur
    newUser.value = { username: '', password: '', role: 'user' }
    
    // 3. On rafraîchit la liste des utilisateurs
    await fetchUsers() 
    
  } catch (err) {
    const errorMsg = err.response?.data?.error || "Erreur lors de la création."
    adminMsg.value = { text: errorMsg, type: 'error' }
  }
}

const fetchUsers = async () => {
  try {
    const response = await axios.get(`${API_BASE_URL}/api/admin/users`)
    usersList.value = response.data
  } catch (err) { console.error("Erreur liste users") }
}

const deleteUser = async (id) => {
  if (!confirm("Supprimer cet utilisateur ?")) return
  try {
    await axios.delete(`${API_BASE_URL}/api/admin/users/${id}`)
    fetchUsers() // Rafraîchir la liste
  } catch (err) { alert(err.response.data.error) }
}

const changePassword = async (id) => {
  const newPass = prompt("Nouveau mot de passe :")
  if (!newPass) return
  try {
    await axios.patch(`${API_BASE_URL}/api/admin/users/${id}/password`, { newPassword: newPass })
    alert("Mot de passe modifié !")
  } catch (err) { console.error(err) }
}

// Appeler fetchUsers quand on bascule sur le panel admin
const openAdmin = () => {
  showAdminPanel.value = true
  fetchUsers()
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
    if (data.theme === 'dark' || data.theme === 'light') {
      theme.value = data.theme
      localStorage.setItem('user_theme', theme.value)
    }
  } catch (err) {
    console.error('Erreur chargement préférences', err)
  }
}

const setTheme = (mode) => {
  theme.value = mode === 'dark' ? 'dark' : 'light'
  localStorage.setItem('user_theme', theme.value)
  syncPreferences()
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
      
      // AJOUT : Si l'utilisateur est admin, on précharge la liste
      if (decoded.role === 'admin') {
        fetchUsers()
      }

      await loadUserPreferences()
      initializeApp()
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
  <div class="app-container" :class="{ 'theme-dark': theme === 'dark' }">
    <header>
      <h1><img src="/logo_velo.png" alt="Logo" class="app-logo" /> Vélo Météo IA</h1>
      
      <div v-if="isLoggedIn" class="header-controls">
        <div class="theme-switch" role="group" aria-label="Affichage jour ou nuit">
          <button type="button" class="theme-btn" :class="{ active: theme === 'light' }" title="Mode jour" @click="setTheme('light')">
            <span class="mdi mdi-white-balance-sunny"></span> Jour
          </button>
          <button type="button" class="theme-btn" :class="{ active: theme === 'dark' }" title="Mode nuit" @click="setTheme('dark')">
            <span class="mdi mdi-weather-night"></span> Nuit
          </button>
        </div>
        <nav v-if="userRole === 'admin'" class="admin-nav">
          <button @click="showAdminPanel = false" :class="{ active: !showAdminPanel }">Météo</button>
          <button @click="showAdminPanel = true" :class="{ active: showAdminPanel }">Admin</button>
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

    <main v-else-if="showAdminPanel" class="admin-screen">
      <div class="admin-container">
        
        <div class="admin-box">
          <h2><span class="mdi mdi-account-plus"></span> Nouvel Utilisateur</h2>
          
          <div v-if="adminMsg.text" :class="['msg-banner', adminMsg.type]">
            {{ adminMsg.text }}
          </div>

          <div class="input-group">
            <label>Identifiant :</label>
            <input v-model="newUser.username" type="text" placeholder="ex: julie" />
          </div>
          
          <div class="input-group">
            <label>Mot de passe :</label>
            <input v-model="newUser.password" type="password" />
          </div>

          <div class="input-group">
            <label>Rôle :</label>
            <select v-model="newUser.role">
              <option value="user">Utilisateur standard</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
          
          <button @click="createUser" class="login-btn">Créer</button>
        </div>

        <div class="admin-box list-box">
          <h2><span class="mdi mdi-account-group"></span> Utilisateurs existants</h2>
          <table class="user-table">
            <thead>
              <tr>
                <th>Nom</th>
                <th>Rôle</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="u in usersList" :key="u._id">
                <td>{{ u.username }}</td>
                <td><span :class="['badge', u.role]">{{ u.role }}</span></td>
                <td class="actions">
                  <button @click="changePassword(u._id)" title="Changer MDP">
                    <span class="mdi mdi-key-variant"></span>
                  </button>
                  <button @click="deleteUser(u._id)" class="del-btn" title="Supprimer">
                    <span class="mdi mdi-trash-can-outline"></span>
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

      </div>
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
                  <WeatherChart :hourlyData="day.matin.hourly" :theme="theme" />
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
                  <WeatherChart :hourlyData="day.apres_midi.hourly" :theme="theme" />
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
/* Chargement des icônes Material Design */
@import url('https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css');

html.meteo-theme-dark {
  color-scheme: dark;
}
html.meteo-theme-dark body {
  background-color: #1a1d23;
  color: #e8eaed;
}
html:not(.meteo-theme-dark) body {
  background-color: #eceff1;
  color: #333;
}
</style>

<style scoped>
/* STRUCTURE GENERALE */
.app-container { max-width: 800px; margin: 0 auto; padding: 20px; font-family: 'Segoe UI', sans-serif; color: #333; }
header { display: flex; flex-direction: column; align-items: stretch; gap: 12px; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 15px; }
header h1 { margin: 0; display: flex; align-items: center; gap: 15px; font-size: 1.5rem; align-self: flex-start; }
.app-logo { height: 40px; width: auto; vertical-align: middle; }

/* NAVIGATION & BOUTONS */
.header-controls { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 15px; }
.admin-nav { display: flex; background: #eee; padding: 4px; border-radius: 8px; }
.admin-nav button { border: none; padding: 6px 12px; cursor: pointer; border-radius: 6px; background: transparent; font-weight: bold; color: #666; }
.admin-nav button.active { background: white; color: #4caf50; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.theme-switch { display: flex; background: #eee; padding: 3px; border-radius: 8px; gap: 2px; }
.theme-btn { display: flex; align-items: center; gap: 4px; border: none; padding: 6px 10px; cursor: pointer; border-radius: 6px; background: transparent; font-weight: 600; font-size: 0.85rem; color: #666; white-space: nowrap; }
.theme-btn.active { background: white; color: #4caf50; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
.logout-btn { background: #f44336; color: white; border: none; padding: 8px; border-radius: 6px; cursor: pointer; display: flex; align-items: center; }

/* ECRANS LOGIN & ADMIN */
.login-screen, .admin-screen { display: flex; justify-content: center; margin-top: 40px; }
.login-box, .admin-box { background: #f9f9f9; padding: 30px; border-radius: 12px; box-shadow: 0 4px 15px rgba(0,0,0,0.1); width: 100%; max-width: 400px; }
.login-error { background: #ffebee; color: #d32f2f; padding: 10px; border-radius: 6px; margin-bottom: 15px; text-align: center; }
.msg-banner { padding: 10px; border-radius: 6px; margin-bottom: 15px; text-align: center; }
.msg-banner.success { background: #e8f5e9; color: #2e7d32; }
.msg-banner.error { background: #ffebee; color: #c62828; }
.login-btn { width: 100%; background: #4caf50; color: white; border: none; padding: 12px; border-radius: 8px; font-size: 1.1rem; cursor: pointer; margin-top: 10px; }

/* FORMULAIRES */
.input-group { margin-bottom: 15px; }
.input-group label { display: block; margin-bottom: 5px; font-weight: bold; }
input, textarea, select { width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 8px; font-size: 1rem; box-sizing: border-box; }
textarea { height: 80px; }

/* MÉTÉO GRID */
.forecast-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 20px; }
.day-card { background: white; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.08); padding: 15px; border: 1px solid #eee; }
.day-card h3 { text-align: center; border-bottom: 2px solid #eee; padding-bottom: 8px; margin-top: 0; }
.day-split { display: flex; flex-direction: column; gap: 10px; }
.half-day { position: relative; padding: 12px 3.75rem 12px 12px; border-radius: 8px; border-left: 6px solid #ddd; background: transparent; cursor: pointer; transition: filter 0.2s, box-shadow 0.2s; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
.half-day:hover { filter: brightness(0.96); box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
.half-day.favorable { border-left-color: #4caf50; background: transparent; }
.half-day.defavorable { border-left-color: #f44336; background: transparent; }
.half-day h4 { margin: 0 0 10px; font-size: 1rem; }
.half-day-heading { display: flex; align-items: center; gap: 12px; flex-wrap: nowrap; }
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
.metrics { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0; font-size: 0.85rem; font-weight: 600; }
.metrics span { display: flex; align-items: center; gap: 3px; }
.weather-main-icon { font-size: 2.75rem; line-height: 1; flex-shrink: 0; }
.half-day.favorable h4 .weather-main-icon { color: #4caf50; }
.half-day.defavorable h4 .weather-main-icon { color: #f44336; }
.metrics .metric-critere.critere-fav .mdi { color: #2e7d32; }
.metrics .metric-critere.critere-def .mdi { color: #c62828; }
.metrics .metric-critere.critere-neutre .mdi { color: #757575; }
.facteurs-def { font-size: 0.8rem; font-weight: 600; color: #b71c1c; margin: 6px 0 4px; }
.ia-advice { font-size: 0.9rem; font-style: italic; color: #555; background: rgba(255,255,255,0.5); padding: 6px; border-radius: 4px; }

/* SUGGESTIONS & STATUS */
.search-container { position: relative; margin-bottom: 3rem; }
.search-input-wrapper { display: flex; gap: 8px; }
.refresh-btn { flex-shrink: 0; background: #4caf50; color: white; border: none; border-radius: 8px; padding: 10px 14px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
.refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.suggestions-list { position: absolute; width: 100%; background: white; border: 1px solid #ddd; z-index: 10; list-style: none; padding: 0; margin: 0; border-radius: 8px; }
.suggestions-list li { padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; }
.status-msg, .error-msg { text-align: center; margin-top: 20px; padding: 10px; border-radius: 8px; }
.error-msg { background: #ffcdd2; color: #b71c1c; }

/* Mode nuit */
.app-container.theme-dark { color: #e8eaed; }
.app-container.theme-dark header { border-bottom-color: #3d4450; }
.app-container.theme-dark .theme-switch { background: #2d333c; }
.app-container.theme-dark .theme-btn { color: #b0b8c4; }
.app-container.theme-dark .theme-btn.active { background: #3d4450; color: #81c784; box-shadow: none; }
.app-container.theme-dark .admin-nav { background: #2d333c; }
.app-container.theme-dark .admin-nav button { color: #b0b8c4; }
.app-container.theme-dark .admin-nav button.active { background: #3d4450; color: #81c784; box-shadow: none; }
.app-container.theme-dark .login-box,
.app-container.theme-dark .admin-box { background: #252a32; border: 1px solid #3d4450; box-shadow: 0 4px 20px rgba(0,0,0,0.35); color: #e8eaed; }
.app-container.theme-dark .login-error { background: #4a2328; color: #ffcdd2; }
.app-container.theme-dark .msg-banner.success { background: #1e3a24; color: #a5d6a7; }
.app-container.theme-dark .msg-banner.error { background: #4a2328; color: #ffcdd2; }
.app-container.theme-dark input,
.app-container.theme-dark textarea,
.app-container.theme-dark select { background: #1e222a; border-color: #4a515c; color: #e8eaed; }
.app-container.theme-dark .day-card { background: #252a32; border-color: #3d4450; box-shadow: 0 4px 12px rgba(0,0,0,0.25); }
.app-container.theme-dark .day-card h3 { border-bottom-color: #3d4450; }
.app-container.theme-dark .half-day { background: transparent; border-left-color: #4a515c; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
.app-container.theme-dark .half-day:hover { filter: brightness(1.15); box-shadow: 0 4px 12px rgba(0,0,0,0.5); }
.app-container.theme-dark .half-day.favorable { border-left-color: #66bb6a; background: transparent; }
.app-container.theme-dark .half-day.defavorable { border-left-color: #e57373; background: transparent; }
.app-container.theme-dark .hourly-details { border-top-color: rgba(255,255,255,0.1); }
.app-container.theme-dark .hourly-row { border-bottom-color: rgba(255,255,255,0.05); }
.app-container.theme-dark .hourly-header { color: #aaa; border-bottom-color: rgba(255,255,255,0.15); }
.app-container.theme-dark .rain-bar-container { background: rgba(255,255,255,0.1); }
.app-container.theme-dark .rain-val { color: #bbb; }
.app-container.theme-dark .bike-day-indicator { background: rgba(0, 0, 0, 0.35); }
.app-container.theme-dark .bike-day-indicator.bike-day-favorable { background: transparent; border-color: transparent; }
.app-container.theme-dark .bike-day-favorable { color: #81c784; }
.app-container.theme-dark .bike-day-defavorable { color: #ef9a9a; }
.app-container.theme-dark .half-day.favorable h4 .weather-main-icon { color: #81c784; }
.app-container.theme-dark .half-day.defavorable h4 .weather-main-icon { color: #ef9a9a; }
.app-container.theme-dark .metrics .metric-critere.critere-fav .mdi { color: #a5d6a7; }
.app-container.theme-dark .metrics .metric-critere.critere-def .mdi { color: #ef9a9a; }
.app-container.theme-dark .metrics .metric-critere.critere-neutre .mdi { color: #9aa0a6; }
.app-container.theme-dark .facteurs-def { color: #ffab91; }
.app-container.theme-dark .ia-advice { color: #c5cad3; background: rgba(0,0,0,0.2); }
.app-container.theme-dark .suggestions-list { background: #252a32; border-color: #4a515c; }
.app-container.theme-dark .suggestions-list li { border-bottom-color: #3d4450; }
.app-container.theme-dark .status-msg { color: #b0b8c4; }
.app-container.theme-dark .error-msg { background: #4a2328; color: #ffcdd2; }
.app-container.theme-dark .refresh-btn { background: #3d4450; color: #e8eaed; border: none; border-radius: 8px; padding: 10px 14px; cursor: pointer; }
.app-container.theme-dark .refresh-btn:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
<script setup>
import { ref, onMounted } from 'vue'
import axios from 'axios'
import { jwtDecode } from 'jwt-decode'

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

      // On met aussi à jour le localStorage pour que initializeApp() soit cohérent
      localStorage.setItem('selected_city', city.value)
      localStorage.setItem('selected_lat', lat.value)
      localStorage.setItem('selected_lon', lon.value)
      localStorage.setItem('user_consignes', consignes.value)
    } else {
      // Si l'utilisateur n'a aucune préférence en BDD, on vide le local pour ne pas
      // polluer sa session avec les données du précédent utilisateur
      localStorage.removeItem('selected_city')
      localStorage.removeItem('selected_lat')
      localStorage.removeItem('selected_lon')
      localStorage.removeItem('user_consignes')
      city.value = ''; consignes.value = ''; lat.value = null; lon.value = null;
    }

    initializeApp()
  } catch (err) {
    loginError.value = "Identifiant ou mot de passe incorrect."
  }
}

const handleLogout = () => {
  localStorage.removeItem('auth_token')
  delete axios.defaults.headers.common['Authorization']
  isLoggedIn.value = false
  userRole.value = ''
  currentUser.value = ''
  forecastData.value = null
  showAdminPanel.value = false
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
      consignes: consignes.value
    })
  } catch (err) {
    console.error("Erreur de synchronisation BDD", err)
  }
}

onMounted(() => {
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
  <div class="app-container">
    <header>
      <h1><img src="/logo_velo.png" alt="Logo" class="app-logo" /> Vélo Météo IA</h1>
      
      <div v-if="isLoggedIn" class="header-controls">
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
        
        <div class="input-group">
          <label>Utilisateur :</label>
          <input v-model="loginUser" type="text" @keyup.enter="handleLogin" />
        </div>
        
        <div class="input-group">
          <label>Mot de passe :</label>
          <input v-model="loginPass" type="password" @keyup.enter="handleLogin" />
        </div>
        
        <button @click="handleLogin" class="login-btn">Se connecter</button>
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
              <div class="half-day" :class="day.matin.favorable ? 'favorable' : 'defavorable'">
                <h4><span class="mdi weather-main-icon" :class="getWeatherIcon(day.matin)"></span> Matin</h4>
                <div class="metrics">
                  <span><span class="mdi mdi-thermometer"></span> {{ day.matin.temp }}°C</span>
                  <span><span class="mdi mdi-water-percent"></span> {{ day.matin.rain }}%</span>
                  <span><span class="mdi mdi-weather-pouring"></span> {{ day.matin.precip }}mm</span>
                  <span><span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.matin.dir)"></span> {{ day.matin.wind }}km/h ({{ day.matin.gust }})</span>
                </div>
                <div class="ia-advice">{{ day.matin.conseil }}</div>
              </div>
              <div class="half-day" :class="day.apres_midi.favorable ? 'favorable' : 'defavorable'">
                <h4><span class="mdi weather-main-icon" :class="getWeatherIcon(day.apres_midi)"></span> Après-midi</h4>
                <div class="metrics">
                  <span><span class="mdi mdi-thermometer"></span> {{ day.apres_midi.temp }}°C</span>
                  <span><span class="mdi mdi-water-percent"></span> {{ day.apres_midi.rain }}%</span>
                  <span><span class="mdi mdi-weather-pouring"></span> {{ day.apres_midi.precip }}mm</span>
                  <span><span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.apres_midi.dir)"></span> {{ day.apres_midi.wind }}km/h ({{ day.apres_midi.gust }})</span>
                </div>
                <div class="ia-advice">{{ day.apres_midi.conseil }}</div>
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
</style>

<style scoped>
/* STRUCTURE GENERALE */
.app-container { max-width: 800px; margin: 0 auto; padding: 20px; font-family: 'Segoe UI', sans-serif; color: #333; }
header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid #eee; padding-bottom: 15px; }
header h1 { margin: 0; display: flex; align-items: center; gap: 15px; font-size: 1.5rem; }
.app-logo { height: 40px; width: auto; vertical-align: middle; }

/* NAVIGATION & BOUTONS */
.header-controls { display: flex; align-items: center; gap: 15px; }
.admin-nav { display: flex; background: #eee; padding: 4px; border-radius: 8px; }
.admin-nav button { border: none; padding: 6px 12px; cursor: pointer; border-radius: 6px; background: transparent; font-weight: bold; color: #666; }
.admin-nav button.active { background: white; color: #4caf50; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
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
.half-day { padding: 12px; border-radius: 8px; border-left: 6px solid #ddd; background: #f9f9f9; }
.half-day.favorable { border-left-color: #4caf50; background: #f1f8e9; }
.half-day.defavorable { border-left-color: #f44336; background: #ffebee; }

/* METRICS & ICONS */
.metrics { display: flex; flex-wrap: wrap; gap: 10px; margin: 8px 0; font-size: 0.85rem; font-weight: 600; }
.metrics span { display: flex; align-items: center; gap: 3px; }
.weather-main-icon { font-size: 1.2rem; }
.mdi-weather-sunny { color: #f39c12; }
.mdi-weather-rainy, .mdi-weather-pouring, .wind-icon { color: #3498db; }
.ia-advice { font-size: 0.9rem; font-style: italic; color: #555; background: rgba(255,255,255,0.5); padding: 6px; border-radius: 4px; }

/* SUGGESTIONS & STATUS */
.search-container { position: relative; }
.search-input-wrapper { display: flex; gap: 8px; }
.suggestions-list { position: absolute; width: 100%; background: white; border: 1px solid #ddd; z-index: 10; list-style: none; padding: 0; margin: 0; border-radius: 8px; }
.suggestions-list li { padding: 10px; cursor: pointer; border-bottom: 1px solid #eee; }
.status-msg, .error-msg { text-align: center; margin-top: 20px; padding: 10px; border-radius: 8px; }
.error-msg { background: #ffcdd2; color: #b71c1c; }
</style>
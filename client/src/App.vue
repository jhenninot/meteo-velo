<script setup>
import { ref, onMounted, watch, computed } from 'vue'
import axios from 'axios'
import { jwtDecode } from 'jwt-decode'
import WeatherChart from './components/WeatherChart.vue'
import StravaActivities from './components/StravaActivities.vue'
import AdminPanel from './components/AdminPanel.vue'
import { MDI_ICONS } from './utils/mdi-icons.js'

// --- ÉTATS D'AUTHENTIFICATION ---
const isLoggedIn = ref(false)
const userRole = ref('') // 'admin' ou 'user'
const currentUser = ref('')
const loginUser = ref('')
const loginPass = ref('')
const loginError = ref('')
const showAccountPanel = ref(false)
const showBurgerMenu = ref(false)
const passwordForm = ref({ currentPassword: '', newPassword: '', confirmPassword: '' })
const passwordMsg = ref({ text: '', type: '' })
const passwordLoading = ref(false)
const showLoginPassword = ref(false)
const visiblePasswordFields = ref({})
const userActivities = ref([])
const activityForm = ref({ id: null, label: '', icon: 'mdi-bike', constraints: '' })
const activityMsg = ref({ text: '', type: '' })
const activityLoading = ref(false)
const selectedActivityId = ref(localStorage.getItem('selected_activity_id') || 'none')
const showIconSuggestions = ref(false)

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
const fallbackWarning = ref('')
const geoLoading = ref(false)
const expandedPeriods = ref({})
const favorites = ref([])

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

const isCurrentCityFavorite = computed(() => {
  if (!city.value || lat.value === null || lon.value === null) return false
  return favorites.value.some(fav => 
    fav.city.toLowerCase() === city.value.toLowerCase() || 
    (Math.abs(fav.lat - lat.value) < 0.001 && Math.abs(fav.lon - lon.value) < 0.001)
  )
})

const selectedActivity = computed(() => {
  if (selectedActivityId.value === 'none') {
    return {
      _id: 'none',
      label: 'Aucune',
      icon: '',
      constraints: 'Aucune contrainte d\'activité.'
    }
  }
  return userActivities.value.find(activity => activity._id === selectedActivityId.value) || null
})

const selectedActivityIcon = computed(() => {
  if (selectedActivityId.value === 'none') return ''
  return selectedActivity.value?.icon || 'mdi-bike'
})

const themeIcon = computed(() => {
  if (theme.value === 'light') return 'mdi-white-balance-sunny'
  if (theme.value === 'dark') return 'mdi-weather-night'
  return 'mdi-brightness-auto'
})

// --- LOGIQUE AUTOCOMPLÉTION ICÔNES MDI ---
const focusedIconIndex = ref(0)

const normalizedQuery = computed(() => {
  return (activityForm.value.icon || '')
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
})

const filteredIcons = computed(() => {
  const q = normalizedQuery.value
  if (!q) {
    return MDI_ICONS
  }
  return MDI_ICONS.filter(icon => {
    const nameMatch = icon.name.toLowerCase().includes(q)
    const tagMatch = icon.tags.some(tag => 
      tag.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(q)
    )
    return nameMatch || tagMatch
  })
})

const categorizedFilteredIcons = computed(() => {
  const icons = filteredIcons.value
  const groups = {}
  icons.forEach(icon => {
    const cat = icon.category || 'Autres'
    if (!groups[cat]) {
      groups[cat] = []
    }
    groups[cat].push(icon)
  })
  return groups
})

const focusedIcon = computed(() => {
  const icons = filteredIcons.value
  if (icons.length && focusedIconIndex.value >= 0 && focusedIconIndex.value < icons.length) {
    return icons[focusedIconIndex.value]
  }
  return null
})

const navigateIcons = (direction) => {
  const total = filteredIcons.value.length
  if (!total) return
  
  const cols = 6
  let current = focusedIconIndex.value
  
  if (direction === 'right') {
    current = (current + 1) % total
  } else if (direction === 'left') {
    current = (current - 1 + total) % total
  } else if (direction === 'down') {
    current = current + cols
    if (current >= total) {
      current = current % cols
      if (current >= total) current = 0
    }
  } else if (direction === 'up') {
    current = current - cols
    if (current < 0) {
      const lastRowStart = Math.floor((total - 1) / cols) * cols
      current = lastRowStart + (current + cols)
      if (current >= total) {
        current = total - 1
      }
    }
  }
  focusedIconIndex.value = current
}

const selectIcon = (iconName) => {
  activityForm.value.icon = iconName
  showIconSuggestions.value = false
}

const selectFocusedIcon = () => {
  const icons = filteredIcons.value
  if (icons.length && focusedIconIndex.value >= 0 && focusedIconIndex.value < icons.length) {
    selectIcon(icons[focusedIconIndex.value].name)
  }
}

watch(filteredIcons, () => {
  focusedIconIndex.value = 0
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

    await loadUserActivities()
    await loadFavorites()
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
  userActivities.value = []
  favorites.value = []
  selectedActivityId.value = ''
  showAdminPanel.value = false
  showStravaPage.value = false
  showAccountPanel.value = false
  theme.value = 'auto'
}

const openAdmin = () => {
  showAdminPanel.value = true
  showStravaPage.value = false
  showAccountPanel.value = false
  showBurgerMenu.value = false
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
  showBurgerMenu.value = false
  loadUserActivities()
}

const closeBurgerOnLogout = () => {
  showBurgerMenu.value = false
  handleLogout()
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

const resetActivityForm = () => {
  activityForm.value = { id: null, label: '', icon: 'mdi-bike', constraints: '' }
}

const loadUserActivities = async () => {
  activityMsg.value = { text: '', type: '' }
  activityLoading.value = true
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/user/activities`)
    userActivities.value = data
    if (selectedActivityId.value !== 'none' && !userActivities.value.some(activity => activity._id === selectedActivityId.value)) {
      selectedActivityId.value = userActivities.value[0]?._id || 'none'
    }
    if (selectedActivityId.value) {
      localStorage.setItem('selected_activity_id', selectedActivityId.value)
    } else {
      localStorage.removeItem('selected_activity_id')
    }
  } catch (err) {
    activityMsg.value = { text: err.response?.data?.error || "Impossible de charger les activités.", type: 'error' }
  } finally {
    activityLoading.value = false
  }
}

const saveActivity = async () => {
  activityMsg.value = { text: '', type: '' }
  activityLoading.value = true
  try {
    const payload = {
      label: activityForm.value.label,
      icon: activityForm.value.icon,
      constraints: activityForm.value.constraints
    }

    if (activityForm.value.id) {
      await axios.put(`${API_BASE_URL}/api/user/activities/${activityForm.value.id}`, payload)
      activityMsg.value = { text: "Activité modifiée.", type: 'success' }
    } else {
      await axios.post(`${API_BASE_URL}/api/user/activities`, payload)
      activityMsg.value = { text: "Activité ajoutée.", type: 'success' }
    }

    resetActivityForm()
    await loadUserActivities()
  } catch (err) {
    activityMsg.value = { text: err.response?.data?.error || "Impossible d'enregistrer l'activité.", type: 'error' }
  } finally {
    activityLoading.value = false
  }
}

const editActivity = (activity) => {
  activityForm.value = {
    id: activity._id,
    label: activity.label || '',
    icon: activity.icon || 'mdi-bike',
    constraints: activity.constraints || ''
  }
}

const deleteActivity = async (activityId) => {
  if (!confirm("Supprimer cette activité ?")) return
  activityMsg.value = { text: '', type: '' }
  activityLoading.value = true
  try {
    await axios.delete(`${API_BASE_URL}/api/user/activities/${activityId}`)
    if (activityForm.value.id === activityId) resetActivityForm()
    activityMsg.value = { text: "Activité supprimée.", type: 'success' }
    await loadUserActivities()
  } catch (err) {
    activityMsg.value = { text: err.response?.data?.error || "Impossible de supprimer l'activité.", type: 'error' }
  } finally {
    activityLoading.value = false
  }
}

const handleActivitySelection = () => {
  if (selectedActivityId.value) {
    localStorage.setItem('selected_activity_id', selectedActivityId.value)
  } else {
    localStorage.removeItem('selected_activity_id')
  }
  forecastData.value = null
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
      await loadUserActivities()
      await loadFavorites()
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
  rafales: 'Rafales',
  uv: 'Indice UV'
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

const useDeviceLocation = () => {
  if (!navigator.geolocation) {
    error.value = "La géolocalisation n'est pas supportée par votre navigateur."
    return
  }
  
  geoLoading.value = true
  error.value = null
  suggestions.value = []
  
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      const { latitude, longitude } = position.coords
      try {
        const response = await axios.get(`${API_BASE_URL}/api/reverse?lat=${latitude}&lon=${longitude}`)
        const features = response.data
        
        let resolvedCity = 'Ma position'
        if (features && features.length > 0) {
          const props = features[0].properties
          resolvedCity = props.city || props.town || props.village || props.name || 'Ma position'
        }
        
        lat.value = latitude
        lon.value = longitude
        city.value = resolvedCity
        query.value = resolvedCity
        
        await fetchForecast()
        await syncPreferences()
      } catch (err) {
        console.error("Reverse geocoding error:", err)
        lat.value = latitude
        lon.value = longitude
        city.value = 'Ma position'
        query.value = 'Ma position'
        
        await fetchForecast()
        await syncPreferences()
      } finally {
        geoLoading.value = false
      }
    },
    (err) => {
      console.error("Geolocation error:", err)
      geoLoading.value = false
      if (err.code === 1) {
        error.value = "Accès à la géolocalisation refusé. Veuillez autoriser l'accès ou saisir une ville."
      } else if (err.code === 2) {
        error.value = "Position géographique indisponible."
      } else if (err.code === 3) {
        error.value = "Délai d'attente de la géolocalisation dépassé."
      } else {
        error.value = "Impossible de récupérer votre position actuelle."
      }
    },
    {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 0
    }
  )
}

const loadFavorites = async () => {
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/user/favorites`)
    favorites.value = data
  } catch (err) {
    console.error("Erreur lors de la récupération des favoris", err)
  }
}

const toggleFavorite = async () => {
  if (!city.value || lat.value === null || lon.value === null) return
  
  const existing = favorites.value.find(fav => 
    fav.city.toLowerCase() === city.value.toLowerCase() || 
    (Math.abs(fav.lat - lat.value) < 0.001 && Math.abs(fav.lon - lon.value) < 0.001)
  )
  
  try {
    if (existing) {
      const response = await axios.delete(`${API_BASE_URL}/api/user/favorites`, {
        params: {
          city: existing.city,
          lat: existing.lat,
          lon: existing.lon
        }
      })
      favorites.value = response.data
    } else {
      const response = await axios.post(`${API_BASE_URL}/api/user/favorites`, {
        city: city.value,
        lat: lat.value,
        lon: lon.value
      })
      favorites.value = response.data
    }
  } catch (err) {
    console.error("Erreur lors de la modification des favoris:", err.response?.data?.error || err.message)
  }
}

const selectFavorite = (fav) => {
  city.value = fav.city
  query.value = fav.city
  lat.value = fav.lat
  lon.value = fav.lon
  suggestions.value = []
  fetchForecast()
  syncPreferences()
}

const fetchForecast = async () => {
  if (!city.value || !lat.value || !lon.value) return;
  if (!selectedActivityId.value) {
    error.value = "Veuillez sélectionner une activité avant de lancer l'analyse."
    return
  }
  loading.value = true
  error.value = null
  suggestions.value = [] 
  
  localStorage.setItem('selected_city', city.value)
  localStorage.setItem('selected_lat', lat.value)
  localStorage.setItem('selected_lon', lon.value)
  localStorage.setItem('selected_activity_id', selectedActivityId.value)

  try {
    const response = await axios.post(`${API_BASE_URL}/api/forecast`, {
      city: city.value,
      lat: lat.value,
      lon: lon.value,
      activityId: selectedActivityId.value
    })
    forecastData.value = response.data.forecast
    fallbackWarning.value = response.data.fallbackMessage || ''
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
      <!-- Rangée 1 : brand + burger -->
      <div class="header-top">
        <div class="header-brand">
          <img src="/actiweather-transparent.png" alt="Logo" class="app-logo" />
          <div class="header-title-group">
            <h1>ActiWeather</h1>
            <p class="app-subtitle">Analyse météo intelligente</p>
          </div>
        </div>

        <div v-if="isLoggedIn" class="header-actions">
          <!-- Bouton burger -->
          <button
            class="burger-btn"
            :class="{ active: showBurgerMenu }"
            @click.stop="showBurgerMenu = !showBurgerMenu"
            aria-label="Menu utilisateur"
            title="Menu"
          >
            <span class="mdi" :class="showBurgerMenu ? 'mdi-close' : 'mdi-menu'" style="font-size:1.4rem"></span>
          </button>

          <!-- Menu déroulant -->
          <Transition name="burger-menu">
            <div
              v-if="showBurgerMenu"
              class="burger-menu-dropdown"
              @click.stop
            >
              <!-- Thème -->
              <div class="burger-menu-item burger-theme-item">
                <span class="burger-menu-icon mdi" :class="themeIcon"></span>
                <span class="burger-menu-label">Thème</span>
                <select :value="theme" @change="setTheme($event.target.value)" class="theme-select burger-theme-select" aria-label="Sélectionner le thème">
                  <option value="light">Jour</option>
                  <option value="auto">Auto</option>
                  <option value="dark">Nuit</option>
                </select>
              </div>

              <div class="burger-menu-divider"></div>

              <!-- Compte -->
              <button @click="openAccount" class="burger-menu-item burger-menu-btn" :class="{ active: showAccountPanel }">
                <span class="burger-menu-icon mdi mdi-account-cog"></span>
                <span class="burger-menu-label">Compte</span>
              </button>

              <!-- Admin (si admin) -->
              <template v-if="userRole === 'admin'">
                <div class="burger-menu-divider"></div>
                <button @click="openAdmin" class="burger-menu-item burger-menu-btn burger-admin" :class="{ active: showAdminPanel }">
                  <span class="burger-menu-icon mdi mdi-shield-account"></span>
                  <span class="burger-menu-label">Administration</span>
                </button>
              </template>

              <div class="burger-menu-divider"></div>

              <!-- Déconnexion -->
              <button @click="closeBurgerOnLogout" class="burger-menu-item burger-menu-btn burger-logout">
                <span class="burger-menu-icon mdi mdi-logout"></span>
                <span class="burger-menu-label">Déconnexion</span>
              </button>
            </div>
          </Transition>

          <!-- Overlay pour fermer le menu -->
          <div v-if="showBurgerMenu" class="burger-overlay" @click="showBurgerMenu = false"></div>
        </div>
      </div>

      <!-- Rangée 2 : navigation Météo / Activités, alignée à droite -->
      <div v-if="isLoggedIn" class="header-controls">
        <nav class="main-nav">
          <button @click="openWeather" :class="{ active: !showAdminPanel && !showStravaPage && !showAccountPanel }">
            <span class="mdi mdi-weather-sunny"></span> Météo
          </button>
          <button @click="openStrava" :class="{ active: showStravaPage }">
            <img src="/strava_logo.png" alt="Strava" class="strava-nav-logo" /> Activités
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

        <section class="account-section">
          <h3><span class="mdi mdi-format-list-checks"></span> Mes activités</h3>
          <div v-if="activityMsg.text" :class="['msg-banner', activityMsg.type]">{{ activityMsg.text }}</div>
          <form @submit.prevent="saveActivity">
            <div class="input-group">
              <label>Libellé :</label>
              <input v-model="activityForm.label" type="text" maxlength="80" placeholder="Ex: Vélo route, Gravel, Course à pied..." required />
            </div>
            <div class="input-group">
              <label>Icône MDI :</label>
              <div class="activity-icon-input-container">
                <div class="activity-icon-input">
                  <span class="mdi activity-icon-preview" :class="activityForm.icon || 'mdi-bike'"></span>
                  <input
                    v-model="activityForm.icon"
                    type="text"
                    maxlength="60"
                    placeholder="Ex: mdi-bike, mdi-run, mdi-hiking..."
                    @focus="showIconSuggestions = true; focusedIconIndex = 0"
                    @blur="showIconSuggestions = false"
                    @keydown.down.prevent="navigateIcons('down')"
                    @keydown.up.prevent="navigateIcons('up')"
                    @keydown.right.prevent="navigateIcons('right')"
                    @keydown.left.prevent="navigateIcons('left')"
                    @keydown.enter.prevent="selectFocusedIcon"
                    @keydown.esc="showIconSuggestions = false"
                  />
                </div>
                <div v-if="showIconSuggestions" class="icon-picker-dropdown">
                  <div class="icon-picker-body">
                    <div
                      v-for="(categoryIcons, categoryName) in categorizedFilteredIcons"
                      :key="categoryName"
                    >
                      <div class="icon-picker-category-title">{{ categoryName }}</div>
                      <div class="icon-picker-grid">
                        <div
                          v-for="icon in categoryIcons"
                          :key="icon.name"
                          :class="{ 'is-focused': filteredIcons.indexOf(icon) === focusedIconIndex }"
                          @mouseenter="focusedIconIndex = filteredIcons.indexOf(icon)"
                          @mousedown.prevent="selectIcon(icon.name)"
                          class="icon-grid-item"
                          :title="icon.name"
                        >
                          <span class="mdi" :class="icon.name"></span>
                        </div>
                      </div>
                    </div>
                    <div v-if="filteredIcons.length === 0" class="icon-picker-no-results">
                      Aucun icône prédéfini trouvé
                    </div>
                  </div>
                  <div v-if="focusedIcon" class="icon-picker-footer">
                    <span class="mdi icon-picker-footer-preview" :class="focusedIcon.name"></span>
                    <div class="icon-picker-footer-info">
                      <span class="icon-picker-footer-name">{{ focusedIcon.name }}</span>
                      <span class="icon-picker-footer-tags">{{ focusedIcon.tags.join(', ') }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div class="input-group">
              <label>Contraintes :</label>
              <textarea v-model="activityForm.constraints" maxlength="4000" placeholder="Ex: Pas de vent supérieur à 20 km/h, pas de pluie, température minimale..."></textarea>
            </div>
            <div class="activity-form-actions">
              <button type="submit" class="login-btn" :disabled="activityLoading">
                {{ activityLoading ? 'Enregistrement...' : (activityForm.id ? 'Modifier l’activité' : 'Ajouter l’activité') }}
              </button>
              <button v-if="activityForm.id" type="button" class="secondary-btn" @click="resetActivityForm" :disabled="activityLoading">
                Annuler
              </button>
            </div>
          </form>

          <div class="activity-list">
            <p v-if="activityLoading && userActivities.length === 0" class="empty-activities">Chargement des activités...</p>
            <p v-else-if="userActivities.length === 0" class="empty-activities">Aucune activité enregistrée.</p>
            <article v-for="activity in userActivities" :key="activity._id" class="activity-card">
              <div class="activity-card-content">
                <h4><span class="mdi" :class="activity.icon || 'mdi-bike'"></span> {{ activity.label }}</h4>
                <p>{{ activity.constraints || 'Aucune contrainte renseignée.' }}</p>
              </div>
              <div class="activity-actions">
                <button type="button" @click="editActivity(activity)" title="Modifier">
                  <span class="mdi mdi-pencil"></span>
                </button>
                <button type="button" @click="deleteActivity(activity._id)" title="Supprimer">
                  <span class="mdi mdi-delete"></span>
                </button>
              </div>
            </article>
          </div>
        </section>
      </div>
    </main>
    <main v-else-if="showStravaPage">
      <StravaActivities :theme="resolvedTheme" :api-base-url="API_BASE_URL" />
    </main>
    <main v-else>
      <section class="config-section">
        <div class="input-group">
          <label><span class="mdi mdi-format-list-checks"></span> Activité à analyser :</label>
          <select v-model="selectedActivityId" @change="handleActivitySelection" :disabled="activityLoading">
            <option value="none">Aucune (Plein air général)</option>
            <option v-for="activity in userActivities" :key="activity._id" :value="activity._id">{{ activity.label }}</option>
          </select>
          <p v-if="selectedActivity" class="selected-activity-constraints"><span v-if="selectedActivity.icon" class="mdi" :class="selectedActivity.icon"></span> {{ selectedActivity.constraints || 'Aucune contrainte renseignée pour cette activité.' }}</p>
          <p v-else class="selected-activity-constraints">Ajoutez vos activités depuis la page Mon compte.</p>
        </div>

        <div class="search-container">
          <div class="search-input-wrapper">
            <input v-model="query" @input="searchCities" placeholder="Ville..." @keyup.enter="fetchForecast"/>
            <button type="button" @click="toggleFavorite" :disabled="!city || loading" class="fav-btn" :title="isCurrentCityFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'">
              <span class="mdi" :class="isCurrentCityFavorite ? 'mdi-star text-warning' : 'mdi-star-outline'"></span>
            </button>
            <button type="button" @click="useDeviceLocation" :disabled="loading || geoLoading" class="geo-btn" title="Utiliser ma position actuelle">
              <span v-if="!geoLoading" class="mdi mdi-crosshairs-gps"></span>
              <span v-else class="mdi mdi-loading mdi-spin"></span>
            </button>
            <button @click="fetchForecast" :disabled="loading || !city || geoLoading" class="refresh-btn" title="Actualiser">
              <span v-if="!loading" class="mdi mdi-refresh"></span>
              <span v-else class="mdi mdi-loading mdi-spin"></span>
            </button>
          </div>
          <div v-if="favorites.length > 0" class="favorites-container">
            <span class="favorites-title"><span class="mdi mdi-star"></span> Favoris :</span>
            <button v-for="fav in favorites" :key="fav._id || fav.city" @click="selectFavorite(fav)" class="fav-badge-btn" type="button" title="Charger cette ville">
              {{ fav.city }}
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
      <div v-if="fallbackWarning" class="fallback-msg">
        <span class="mdi mdi-alert"></span> {{ fallbackWarning }}
        <button class="fallback-close" @click="fallbackWarning = ''" aria-label="Fermer">&times;</button>
      </div>

      <section v-if="forecastData && !loading" class="results-section">
        <div class="forecast-grid">
          <div v-for="(day, index) in forecastData" :key="index" class="day-card">
            <h3><span class="mdi mdi-calendar"></span> {{ formatDate(day.date) }}</h3>
            <div class="day-split">
              <div v-if="day.matin" class="half-day" :class="[day.matin.favorable ? 'favorable' : 'defavorable', { 'is-expanded': expandedPeriods[`${index}-matin`] }]" @click="togglePeriod(index, 'matin')">
                <span
                  class="bike-day-indicator"
                  :class="day.matin.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'"
                  :title="day.matin.favorable ? 'Conditions favorables pour l?activit?' : 'Conditions d?favorables pour l?activit?'"
                  role="img"
                  :aria-label="day.matin.favorable ? 'Activit? : conditions favorables' : 'Activit? : conditions d?favorables'"
                >
                  <span class="mdi bike-day-indicator__icon" :class="selectedActivityIcon" aria-hidden="true"></span>
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
                  <span :class="critereClass(day.matin, 'uv')"><span class="mdi mdi-sun-wireless"></span> UV {{ day.matin.uv }}</span>
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
                  :title="day.apres_midi.favorable ? 'Conditions favorables pour l?activit?' : 'Conditions d?favorables pour l?activit?'"
                  role="img"
                  :aria-label="day.apres_midi.favorable ? 'Activit? : conditions favorables' : 'Activit? : conditions d?favorables'"
                >
                  <span class="mdi bike-day-indicator__icon" :class="selectedActivityIcon" aria-hidden="true"></span>
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
                  <span :class="critereClass(day.apres_midi, 'uv')"><span class="mdi mdi-sun-wireless"></span> UV {{ day.apres_midi.uv }}</span>
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

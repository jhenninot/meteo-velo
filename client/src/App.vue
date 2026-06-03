<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import axios from 'axios'
import { jwtDecode } from 'jwt-decode'
import WeatherChart from './components/WeatherChart.vue'
import WeatherIcon from './components/WeatherIcon.vue'
import WeatherHourlyTimeline from './components/WeatherHourlyTimeline.vue'
import StravaActivities from './components/StravaActivities.vue'
import StravaRoutes from './components/StravaRoutes.vue'
import AdminPanel from './components/AdminPanel.vue'
import ActivityForm from './components/ActivityForm.vue'

import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Fix Leaflet default icon path for Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

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
const editingActivityId = ref(null)
const showAddForm = ref(false)
const showEditWeatherPageForm = ref(false)
const showAddWeatherPageForm = ref(false)
const activityMsg = ref({ text: '', type: '' })
const activityLoading = ref(false)
const selectedActivityId = ref(localStorage.getItem('selected_activity_id') || 'none')
const useAiAnalysis = ref(true)

// --- ÉTATS NAVIGATION ---
const showAdminPanel = ref(false)
const showStravaPage = ref(false)
const showStravaRoutesPage = ref(false)
const isWeatherPage = computed(() => !showAdminPanel.value && !showStravaPage.value && !showStravaRoutesPage.value && !showAccountPanel.value)

// --- ÉTATS DE L'APPLICATION MÉTÉO ---
const city = ref('')
const lat = ref(localStorage.getItem('selected_lat') || null)
const lon = ref(localStorage.getItem('selected_lon') || null)
const query = ref('')
const suggestions = ref([])
const consignes = ref(localStorage.getItem('user_consignes') || '')
const weatherData = ref(null)      // météo brute (Open-Meteo aggrégée), affichée immédiatement
const forecastData = ref(null)     // météo enrichie par l'IA (après analyse)
const forecastCollectedAt = ref(null)
const forecastLoadedFromCache = ref(false)
const loading = ref(false)         // chargement météo brute
const aiLoading = ref(false)       // chargement analyse IA
const error = ref(null)
const fallbackWarning = ref('')
const actualWeatherProvider = ref(null)
const currentWeather = ref(null)
const geoLoading = ref(false)
const expandedPeriods = ref({})
const favorites = ref([])
const selectedDayIndex = ref(null)
const loadedDayIndexes = ref([])

watch([weatherData, forecastData], () => {
  const list = forecastData.value || weatherData.value
  if (list && list.length > 0) {
    selectedDayIndex.value = 0
    if (list.length > 1) {
      loadedDayIndexes.value = [0, 1]
    } else {
      loadedDayIndexes.value = [0]
    }
  } else {
    selectedDayIndex.value = null
    loadedDayIndexes.value = []
  }
})

watch(selectedDayIndex, (newVal) => {
  if (newVal === null) {
    loadedDayIndexes.value = []
  }
})

// --- ÉTATS DE LA CARTE DE LOCALISATION ---
const showMap = ref(false)
let weatherMapInstance = null
let weatherMarkerInstance = null
const showWeatherFullscreen = ref(false)
let weatherFullscreenMapInstance = null
let weatherFullscreenMarkerInstance = null

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

const selectedFavoriteIndex = computed({
  get() {
    if (!city.value) return "-1"
    const index = favorites.value.findIndex(fav => 
      fav.city.toLowerCase() === city.value.toLowerCase() || 
      (lat.value !== null && lon.value !== null && Math.abs(fav.lat - lat.value) < 0.001 && Math.abs(fav.lon - lon.value) < 0.001)
    )
    return index !== -1 ? String(index) : "-1"
  },
  set(newIndex) {
    const idx = parseInt(newIndex, 10)
    if (isNaN(idx) || idx < 0 || idx >= favorites.value.length) return
    const fav = favorites.value[idx]
    selectFavorite(fav)
  }
})

const isSuggestionFavorite = (s) => {
  if (!s || !s.properties) return false
  
  const name = s.properties.name
  const lonVal = s.geometry.coordinates[0]
  const latVal = s.geometry.coordinates[1]
  
  // Normalisation des chaînes de caractères pour une comparaison robuste des noms de villes
  const normalizeString = (str) => {
    if (!str) return ''
    return str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "") // Supprimer les accents
      .replace(/[^a-z0-9]/g, ' ')      // Remplacer les tirets/caractères spéciaux par des espaces
      .replace(/\s+/g, ' ')            // Condenser les espaces multiples
      .trim()
  }

  const normName = normalizeString(name)

  return favorites.value.some(fav => {
    const normFavCity = normalizeString(fav.city)
    
    // 1. Correspondance exacte par nom normalisé (ex: "hardelot-plage" et "hardelot plage" correspondront)
    if (normName === normFavCity) return true
    
    // 2. Correspondance par proximité géographique, mais uniquement s'il s'agit d'une localité/ville
    // pour éviter de marquer des POIs comme des pharmacies ou des clubs de voile situés à proximité.
    const isPlaceOrBeach = s.properties.osm_key === 'place' || 
                           ['city', 'town', 'village', 'hamlet', 'suburb', 'administrative', 'beach'].includes(s.properties.osm_value)
    
    if (isPlaceOrBeach) {
      const latDiff = Math.abs(fav.lat - latVal)
      const lonDiff = Math.abs(fav.lon - lonVal)
      // Seuil de proximité serré à 0.005 degrés (environ 500m)
      if (latDiff < 0.005 && lonDiff < 0.005) {
        return true
      }
    }
    
    return false
  })
}

const selectedActivity = computed(() => {
  if (selectedActivityId.value === 'none') {
    return {
      _id: 'none',
      label: 'Aucune',
      icon: '',
      constraints: 'Aucune contrainte d\'activité.',
      slot1Name: 'Matin',
      slot1Start: 8,
      slot1End: 12,
      slot2Name: 'Après-midi',
      slot2Start: 14,
      slot2End: 19
    }
  }
  return userActivities.value.find(activity => activity._id === selectedActivityId.value) || null
})

const selectedActivityIcon = computed(() => {
  if (selectedActivityId.value === 'none') return 'mdi-compass-outline'
  return selectedActivity.value?.icon || 'mdi-bike'
})

const themeIcon = computed(() => {
  if (theme.value === 'light') return 'mdi-white-balance-sunny'
  if (theme.value === 'dark') return 'mdi-weather-night'
  return 'mdi-brightness-auto'
})
watch(isDark, (val) => {
  document.documentElement.classList.toggle('meteo-theme-dark', val)
}, { immediate: true })

// --- CONFIGURATION ---
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || `http://${window.location.hostname}:3001`

// --- LOGIQUE STRAVA HEADER ---
const stravaStatus = ref({ connected: false, athleteName: null, athleteProfile: null })
const loadingConnect = ref(false)

const fetchStravaStatus = async () => {
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/strava/status`)
    stravaStatus.value = data
  } catch (e) {
    console.error('Strava status error', e)
  }
}

const connectStrava = async () => {
  loadingConnect.value = true
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/strava/authorize`)
    window.location.href = data.url
  } catch (e) {
    loadingConnect.value = false
    console.error('Impossible de contacter Strava.', e)
  }
}

const disconnectStrava = async () => {
  if (!confirm('Délier votre compte Strava ?')) return
  try {
    await axios.delete(`${API_BASE_URL}/api/strava/disconnect`)
    stravaStatus.value = { connected: false, athleteName: null, athleteProfile: null }
    window.location.reload()
  } catch (e) {
    console.error('Erreur lors de la déconnexion Strava.', e)
  }
}

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
      if (preferences.useAiAnalysis !== undefined) {
        useAiAnalysis.value = preferences.useAiAnalysis
      } else {
        useAiAnalysis.value = true
      }

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
    await loadSystemSettings()
    await fetchStravaStatus()
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
  weatherData.value = null
  forecastData.value = null
  currentWeather.value = null
  userActivities.value = []
  favorites.value = []
  selectedActivityId.value = ''
  showAdminPanel.value = false
  showStravaPage.value = false
  showStravaRoutesPage.value = false
  showAccountPanel.value = false
  theme.value = 'auto'
  stravaStatus.value = { connected: false, athleteName: null, athleteProfile: null }
}

const openAdmin = () => {
  showAdminPanel.value = true
  showStravaPage.value = false
  showStravaRoutesPage.value = false
  showAccountPanel.value = false
  showBurgerMenu.value = false
}

const openWeather = () => {
  showAdminPanel.value = false
  showStravaPage.value = false
  showStravaRoutesPage.value = false
  showAccountPanel.value = false
  fetchCurrentWeatherOnly()
}

const openStrava = () => {
  showAdminPanel.value = false
  showStravaPage.value = true
  showStravaRoutesPage.value = false
  showAccountPanel.value = false
}

const openStravaRoutes = () => {
  showAdminPanel.value = false
  showStravaPage.value = false
  showStravaRoutesPage.value = true
  showAccountPanel.value = false
}

const updateGlobalLocation = (newLoc) => {
  city.value = newLoc.city
  lat.value = newLoc.lat
  lon.value = newLoc.lon
  query.value = newLoc.city
  localStorage.setItem('selected_city', newLoc.city)
  localStorage.setItem('selected_lat', newLoc.lat)
  localStorage.setItem('selected_lon', newLoc.lon)
  if (isLoggedIn.value) {
    fetchForecast()
    syncPreferences()
  }
}

const openAccount = () => {
  showAdminPanel.value = false
  showStravaPage.value = false
  showStravaRoutesPage.value = false
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

const loadUserActivities = async () => {
  activityMsg.value = { text: '', type: '' }
  activityLoading.value = true
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/user/activities`)
    userActivities.value = data
    
    // Auto-select the first activity for new users/connections
    const hasSavedActivity = !!localStorage.getItem('selected_activity_id')
    if ((selectedActivityId.value === 'none' || !hasSavedActivity) && userActivities.value.length > 0) {
      selectedActivityId.value = userActivities.value[0]._id
    }

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

const saveActivity = async (payload, activityId = null) => {
  activityMsg.value = { text: '', type: '' }
  activityLoading.value = true
  try {
    if (activityId) {
      await axios.put(`${API_BASE_URL}/api/user/activities/${activityId}`, payload)
      activityMsg.value = { text: "Activité modifiée.", type: 'success' }
      editingActivityId.value = null
      showEditWeatherPageForm.value = false
      
      // Si l'activité modifiée est celle sélectionnée sur la page météo, rafraîchir l'analyse
      if (selectedActivityId.value === activityId && city.value && lat.value !== null && lon.value !== null) {
        const cacheKey = `forecast_${lat.value}_${lon.value}_${selectedActivityId.value}`
        localStorage.removeItem(cacheKey)
        fetchForecast(false)
      }
    } else {
      const { data } = await axios.post(`${API_BASE_URL}/api/user/activities`, payload)
      activityMsg.value = { text: "Activité ajoutée.", type: 'success' }
      showAddForm.value = false
      showAddWeatherPageForm.value = false
      
      // Sélectionner automatiquement la nouvelle activité
      if (data && data._id) {
        selectedActivityId.value = data._id
        localStorage.setItem('selected_activity_id', data._id)
        if (city.value && lat.value !== null && lon.value !== null) {
          fetchForecast(false)
        }
      }
    }
    await loadUserActivities()
  } catch (err) {
    activityMsg.value = { text: err.response?.data?.error || "Impossible d'enregistrer l'activité.", type: 'error' }
  } finally {
    activityLoading.value = false
  }
}

const toggleEditActivity = (activityId) => {
  showAddForm.value = false
  if (editingActivityId.value === activityId) {
    editingActivityId.value = null
  } else {
    editingActivityId.value = activityId
  }
}

const cancelEdit = () => {
  editingActivityId.value = null
}

const toggleAddForm = () => {
  editingActivityId.value = null
  showAddForm.value = !showAddForm.value
}

const toggleEditWeatherPageActivity = () => {
  showAddWeatherPageForm.value = false
  showEditWeatherPageForm.value = !showEditWeatherPageForm.value
}

const toggleAddWeatherPageActivity = () => {
  showEditWeatherPageForm.value = false
  showAddWeatherPageForm.value = !showAddWeatherPageForm.value
}

const deleteActivity = async (activityId) => {
  if (!confirm("Supprimer cette activité ?")) return
  activityMsg.value = { text: '', type: '' }
  activityLoading.value = true
  try {
    await axios.delete(`${API_BASE_URL}/api/user/activities/${activityId}`)
    if (editingActivityId.value === activityId) editingActivityId.value = null
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
  weatherData.value = null
  forecastData.value = null

  if (city.value && lat.value !== null && lon.value !== null) {
    fetchForecast()
  }
}

const showActivityDropdown = ref(false)
const toggleActivityDropdown = () => {
  showActivityDropdown.value = !showActivityDropdown.value
}
const selectActivityCustom = (activityId) => {
  selectedActivityId.value = activityId
  showActivityDropdown.value = false
  handleActivitySelection()
}
const closeActivityDropdown = () => {
  showActivityDropdown.value = false
}

const syncPreferences = async () => {
  if (!isLoggedIn.value) return
  try {
    await axios.post(`${API_BASE_URL}/api/user/preferences`, {
      city: city.value,
      lat: lat.value,
      lon: lon.value,
      consignes: consignes.value,
      theme: theme.value,
      useAiAnalysis: useAiAnalysis.value
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
    if (data.useAiAnalysis !== undefined) {
      useAiAnalysis.value = data.useAiAnalysis
    }
    if (data.consignes !== undefined) {
      consignes.value = data.consignes || ''
      localStorage.setItem('user_consignes', consignes.value)
    }
    if (data.city && data.lat !== undefined && data.lon !== undefined) {
      if (!localStorage.getItem('selected_city') || !localStorage.getItem('selected_lat') || !localStorage.getItem('selected_lon')) {
        city.value = data.city
        lat.value = Number(data.lat)
        lon.value = Number(data.lon)
        query.value = data.city
        localStorage.setItem('selected_city', data.city)
        localStorage.setItem('selected_lat', data.lat.toString())
        localStorage.setItem('selected_lon', data.lon.toString())
      }
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
  document.addEventListener('click', closeActivityDropdown)
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
      await loadSystemSettings()
      await fetchStravaStatus()
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
  const savedLat = localStorage.getItem('selected_lat') || lat.value
  const savedLon = localStorage.getItem('selected_lon') || lon.value
  if (savedCity && savedLat && savedLon) {
    city.value = savedCity
    lat.value = Number(savedLat)
    lon.value = Number(savedLon)
    query.value = savedCity
    if (selectedActivityId.value) {
      if (!restoreCachedForecast()) {
        fetchForecast()
      } else {
        fetchCurrentWeatherOnly()
      }
    }
  } else {
    detectAndSetUserLocation()
      .then(() => {
        if (selectedActivityId.value) {
          fetchForecast()
        }
      })
      .catch((err) => {
        console.error("Erreur géolocalisation initiale :", err)
      })
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

const isWeekend = (dateString) => {
  if (!dateString) return false;
  const [year, month, day] = dateString.split('-');
  const date = new Date(year, month - 1, day);
  const dayOfWeek = date.getDay();
  return dayOfWeek === 0 || dayOfWeek === 6;
}

const scrollToDayDetail = (index) => {
  const el = document.getElementById(`day-detail-${index}`)
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}

const formatDateTime = (isoString) => {
  if (!isoString) return '';
  return new Intl.DateTimeFormat('fr-FR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(isoString));
}

const formatCollectionTime = (timeStr) => {
  if (!timeStr) return '';
  const parts = timeStr.split('T');
  if (parts.length < 2) return '';
  const timePart = parts[1];
  const timeSubparts = timePart.split(':');
  if (timeSubparts.length < 2) return '';
  return `${timeSubparts[0]}:${timeSubparts[1]}`;
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

const getWeatherIcon = (periodData, isNight = false) => {
  if (!periodData) return 'mdi-help-circle-outline';
  if (periodData.precip >= 2) return 'mdi-weather-pouring';
  if (periodData.precip > 0 || periodData.rain >= 50) return 'mdi-weather-rainy';
  if (periodData.wind > 35) return 'mdi-weather-windy';
  if (periodData.rain > 20) {
    return isNight ? 'mdi-weather-night-partly-cloudy' : 'mdi-weather-partly-cloudy';
  }
  return isNight ? 'mdi-weather-night' : 'mdi-weather-sunny';
}

const getStravaTypeLabel = (type) => {
  const labels = {
    Ride: 'Vélo de Route',
    GravelRide: 'Gravel',
    MountainBikeRide: 'VTT',
    EBikeRide: 'Vélo Électrique',
    Run: 'Course à pied',
    TrailRun: 'Trail',
    Walk: 'Marche',
    Hike: 'Randonnée'
  }
  return labels[type] || type
}

const hasNumericalConstraints = (activity) => {
  return activity && (
         activity.tempMin !== null && activity.tempMin !== undefined ||
         activity.tempMax !== null && activity.tempMax !== undefined ||
         activity.windMin !== null && activity.windMin !== undefined ||
         activity.windMax !== null && activity.windMax !== undefined ||
         activity.gustMin !== null && activity.gustMin !== undefined ||
         activity.gustMax !== null && activity.gustMax !== undefined ||
         activity.precipMin !== null && activity.precipMin !== undefined ||
         activity.precipMax !== null && activity.precipMax !== undefined ||
         activity.uvMin !== null && activity.uvMin !== undefined ||
         activity.uvMax !== null && activity.uvMax !== undefined
  );
}

const formatLimit = (min, max, unit = '') => {
  const u = unit ? ' ' + unit : '';
  const hasMin = min !== null && min !== undefined && min !== '';
  const hasMax = max !== null && max !== undefined && max !== '';
  if (hasMin && hasMax) return `${min} à ${max}${u}`;
  if (hasMin) return `≥ ${min}${u}`;
  if (hasMax) return `≤ ${max}${u}`;
  return '';
}

const getCurrentWeatherLabel = (current) => {
  if (!current) return ''
  const isNight = isNightHour(new Date().toISOString().split('T')[0], new Date().getHours())
  if (current.precip >= 2) return 'Pluie forte'
  if (current.precip > 0 || current.rain >= 50) return 'Pluie'
  if (current.wind > 35) return 'Vent fort'
  if (current.rain > 20) return 'Nuageux'
  return isNight ? 'Dégagé' : 'Ensoleillé'
}

const getShortDayName = (dateString) => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  const date = new Date(year, month - 1, day);
  const formatted = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

const getDailyMinTemp = (day) => {
  if (day.full_day?.minTemp !== undefined) return day.full_day.minTemp;
  const temps = [];
  if (day.matin?.temp !== undefined) temps.push(day.matin.temp);
  if (day.apres_midi?.temp !== undefined) temps.push(day.apres_midi.temp);
  if (temps.length === 0) return '-';
  return Math.min(...temps);
}

const getDailyMaxTemp = (day) => {
  if (day.full_day?.temp !== undefined) return day.full_day.temp;
  const temps = [];
  if (day.matin?.temp !== undefined) temps.push(day.matin.temp);
  if (day.apres_midi?.temp !== undefined) temps.push(day.apres_midi.temp);
  if (temps.length === 0) return '-';
  return Math.max(...temps);
}

const getDailyWind = (day) => {
  if (day.full_day?.wind !== undefined) return day.full_day.wind;
  const winds = [];
  if (day.matin?.wind !== undefined) winds.push(day.matin.wind);
  if (day.apres_midi?.wind !== undefined) winds.push(day.apres_midi.wind);
  if (winds.length === 0) return '-';
  return Math.max(...winds);
}

const getDailyGust = (day) => {
  if (day.full_day?.gust !== undefined) return day.full_day.gust;
  const gusts = [];
  if (day.matin?.gust !== undefined) gusts.push(day.matin.gust);
  if (day.apres_midi?.gust !== undefined) gusts.push(day.apres_midi.gust);
  if (gusts.length === 0) return '-';
  return Math.max(...gusts);
}

const getDailyWindDir = (day) => {
  if (day.full_day?.dir !== undefined) return day.full_day.dir;
  if (day.apres_midi?.dir !== undefined) return day.apres_midi.dir;
  if (day.matin?.dir !== undefined) return day.matin.dir;
  return 0;
}

const getDailyPrecip = (day) => {
  if (day.full_day?.precip !== undefined) return day.full_day.precip;
  let precip = 0;
  if (day.matin?.precip) precip += day.matin.precip;
  if (day.apres_midi?.precip) precip += day.apres_midi.precip;
  return Number(precip.toFixed(1));
}

const getDailyRain = (day) => {
  if (day.full_day?.rain !== undefined) return day.full_day.rain;
  const rains = [];
  if (day.matin?.rain !== undefined) rains.push(day.matin.rain);
  if (day.apres_midi?.rain !== undefined) rains.push(day.apres_midi.rain);
  if (rains.length === 0) return 0;
  return Math.max(...rains);
}

const getDailyWeatherIcon = (day) => {
  if (day.full_day) return getWeatherIcon(day.full_day);
  const mainPeriod = day.apres_midi || day.matin;
  return getWeatherIcon(mainPeriod);
}

const toggleDayHourly = (index) => {
  if (selectedDayIndex.value === index) {
    selectedDayIndex.value = null;
    loadedDayIndexes.value = [];
  } else {
    selectedDayIndex.value = index;
    const list = forecastData.value || weatherData.value;
    if (list && index + 1 < list.length) {
      loadedDayIndexes.value = [index, index + 1];
    } else {
      loadedDayIndexes.value = [index];
    }
    nextTick(() => {
      const container = document.querySelector('.hourly-scroll-container');
      if (container) {
        container.scrollLeft = 0;
      }
    });
  }
}

const handleHourlyScroll = (event) => {
  const container = event.target;
  const isNearEnd = container.scrollWidth - container.scrollLeft - container.clientWidth < 80;
  if (isNearEnd) {
    const list = forecastData.value || weatherData.value;
    if (!list) return;
    const maxIndex = Math.max(...loadedDayIndexes.value);
    if (maxIndex + 1 < list.length) {
      loadedDayIndexes.value.push(maxIndex + 1);
    }
  }
}

const getDayByIndex = (index) => {
  const list = forecastData.value || weatherData.value;
  return list ? list[index] : null;
}

const selectedDayForHourly = computed(() => {
  const list = forecastData.value || weatherData.value;
  if (list && selectedDayIndex.value !== null && selectedDayIndex.value >= 0 && selectedDayIndex.value < list.length) {
    return list[selectedDayIndex.value];
  }
  return null;
});

const isNightHour = (dateString, hour) => {
  if (!dateString) return hour < 6 || hour >= 22;
  const month = new Date(dateString).getMonth(); // 0 = Jan, 11 = Dec
  
  let sunrise = 7;
  let sunset = 19;
  
  if (month >= 4 && month <= 7) { // Mai, Juin, Juillet, Août
    sunrise = 6;
    sunset = 22;
  } else if (month === 3 || month === 8) { // Avril, Septembre
    sunrise = 7;
    sunset = 21;
  } else if (month === 2 || month === 9) { // Mars, Octobre
    sunrise = 7;
    sunset = 20;
  } else { // Nov, Déc, Jan, Fév
    sunrise = 8;
    sunset = 18;
  }
  
  return hour < sunrise || hour >= sunset;
}

const searchCities = async () => {
  if (query.value.length < 3) { suggestions.value = []; return; }
  try {
    const response = await axios.get(`${API_BASE_URL}/api/search?q=${query.value}`)
    
    // Déduplication par nom, région (state) et pays pour éviter les doublons visuels comme "Paris - Île-de-France"
    const seen = new Set()
    const uniqueSuggestions = []
    
    if (Array.isArray(response.data)) {
      for (const feature of response.data) {
        if (!feature.properties) continue
        
        const name = (feature.properties.name || '').trim().toLowerCase()
        const state = (feature.properties.state || '').trim().toLowerCase()
        const country = (feature.properties.country || '').trim().toLowerCase()
        
        const key = `${name}|${state}|${country}`
        if (!seen.has(key)) {
          seen.add(key)
          uniqueSuggestions.push(feature)
        }
      }
    }
    
    suggestions.value = uniqueSuggestions
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

const removeFavorite = async (fav) => {
  try {
    const response = await axios.delete(`${API_BASE_URL}/api/user/favorites`, {
      params: {
        city: fav.city,
        lat: fav.lat,
        lon: fav.lon
      }
    })
    favorites.value = response.data
  } catch (err) {
    console.error("Erreur lors de la suppression du favori:", err.response?.data?.error || err.message)
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

const toggleMap = () => {
  showMap.value = !showMap.value
}

const initOrUpdateWeatherMap = async () => {
  if (!lat.value || !lon.value) return

  await nextTick()

  const container = document.getElementById('weather-map-container')
  if (!container) return

  const latitude = parseFloat(lat.value)
  const longitude = parseFloat(lon.value)

  const loadRadar = async () => {
    if (radarFrames.value.length === 0) {
      await fetchRadarMetadata()
    }
    if (radarFrames.value.length > 0) {
      showRadarFrame(radarPosition.value)
    }
  }

  if (!weatherMapInstance) {
    if (container._leaflet_id) {
      container._leaflet_id = null
    }

    weatherMapInstance = L.map(container, {
      zoomControl: true,
      scrollWheelZoom: false
    }).setView([latitude, longitude], 11)

    const standardLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19
    })

    const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
      maxZoom: 17
    })

    const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      maxZoom: 19
    })

    topoLayer.addTo(weatherMapInstance)

    const baseLayers = {
      "Standard": standardLayer,
      "Topographique": topoLayer,
      "Satellite": satelliteLayer
    }
    L.control.layers(baseLayers, null, { position: 'bottomleft' }).addTo(weatherMapInstance)

    weatherMarkerInstance = L.marker([latitude, longitude]).addTo(weatherMapInstance)

    // Initialisation du radar
    loadRadar()

    weatherMapInstance.on('movestart', () => {
      clearRadarLayersCache(radarLayersNormal, weatherMapInstance)
    })
  } else {
    weatherMapInstance.setView([latitude, longitude], 11)
    if (weatherMarkerInstance) {
      weatherMarkerInstance.setLatLng([latitude, longitude])
    } else {
      weatherMarkerInstance = L.marker([latitude, longitude]).addTo(weatherMapInstance)
    }
    // Chargement/Mise à jour du radar
    loadRadar()
    // Force Leaflet recalculation for dynamic visibility/sizing
    setTimeout(() => {
      if (weatherMapInstance) {
        weatherMapInstance.invalidateSize()
      }
    }, 100)
  }
}

const openWeatherFullscreen = async () => {
  if (!lat.value || !lon.value) return
  showWeatherFullscreen.value = true

  await nextTick()

  const container = document.getElementById('weather-fullscreen-map')
  if (!container) return

  const latitude = parseFloat(lat.value)
  const longitude = parseFloat(lon.value)

  if (weatherFullscreenMapInstance) {
    try {
      weatherFullscreenMapInstance.remove()
    } catch (e) {
      console.error(e)
    }
    weatherFullscreenMapInstance = null
  }

  if (container._leaflet_id) {
    container._leaflet_id = null
  }

  weatherFullscreenMapInstance = L.map(container, {
    zoomControl: true,
    scrollWheelZoom: true
  }).setView([latitude, longitude], 11)

  const standardLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
  })

  const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)',
    maxZoom: 17
  })

  const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
    maxZoom: 19
  })

  topoLayer.addTo(weatherFullscreenMapInstance)

  const baseLayers = {
    "Standard": standardLayer,
    "Topographique": topoLayer,
    "Satellite": satelliteLayer
  }
  L.control.layers(baseLayers, null, { position: 'bottomleft' }).addTo(weatherFullscreenMapInstance)

  weatherFullscreenMarkerInstance = L.marker([latitude, longitude]).addTo(weatherFullscreenMapInstance)

  // Initialisation du radar en plein écran
  if (radarFrames.value.length > 0) {
    showRadarFrame(radarPosition.value)
  } else {
    fetchRadarMetadata().then(() => {
      if (radarFrames.value.length > 0) {
        showRadarFrame(radarPosition.value)
      }
    })
  }

  weatherFullscreenMapInstance.on('movestart', () => {
    clearRadarLayersCache(radarLayersFullscreen, weatherFullscreenMapInstance)
  })
}

const closeWeatherFullscreen = () => {
  if (weatherFullscreenMapInstance) {
    try {
      weatherFullscreenMapInstance.remove()
    } catch (e) {
      console.error(e)
    }
    weatherFullscreenMapInstance = null
  }
  weatherFullscreenMarkerInstance = null
  radarLayersFullscreen = { currentLayer: null }
  showWeatherFullscreen.value = false
}

watch(showMap, (newVal) => {
  if (newVal) {
    initOrUpdateWeatherMap()
  }
})

watch([lat, lon], ([newLat, newLon]) => {
  if (!newLat || !newLon) {
    showMap.value = false
    closeWeatherFullscreen()
  } else {
    resetRadar()
    if (showMap.value) {
      initOrUpdateWeatherMap()
    }
    if (showWeatherFullscreen.value) {
      openWeatherFullscreen()
    }
  }
})

onUnmounted(() => {
  document.removeEventListener('click', closeActivityDropdown)
  stopRadarAnimation()
  if (weatherMapInstance) {
    try { weatherMapInstance.remove() } catch (e) {}
    weatherMapInstance = null
  }
  if (weatherFullscreenMapInstance) {
    try { weatherFullscreenMapInstance.remove() } catch (e) {}
    weatherFullscreenMapInstance = null
  }
})


const CACHE_KEY = 'weather_forecast_cache'
const cacheMaxAge = ref(60) // en minutes

const loadSystemSettings = async () => {
  try {
    const { data } = await axios.get(`${API_BASE_URL}/api/settings`)
    if (data && data.cache_max_age !== undefined) {
      cacheMaxAge.value = parseInt(data.cache_max_age, 10) || 60
    }
  } catch (err) {
    console.error("Erreur de récupération des paramètres système", err)
  }
}

const roundCoord = (value) => {
  if (value === null || value === undefined) return ''
  return Number(value).toFixed(5)
}

const getForecastCacheKey = () => {
  return [roundCoord(lat.value), roundCoord(lon.value), selectedActivityId.value, useAiAnalysis.value ? 'ai' : 'rules'].join('::')
}

const loadForecastCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || '{}')
  } catch (e) {
    return {}
  }
}

const saveForecastCache = (cache) => {
  localStorage.setItem(CACHE_KEY, JSON.stringify(cache))
}

const loadCachedForecast = () => {
  if (!city.value || lat.value === null || lon.value === null || !selectedActivityId.value) {
    return null
  }

  const cache = loadForecastCache()
  const key = getForecastCacheKey()
  const item = cache[key]
  if (!item) return null

  const age = Date.now() - Number(item.fetchedAt || 0)
  const cacheMaxAgeMs = cacheMaxAge.value * 60 * 1000
  if (age > cacheMaxAgeMs) {
    delete cache[key]
    saveForecastCache(cache)
    return null
  }
  return item
}

const restoreCachedForecast = () => {
  const cached = loadCachedForecast()
  if (!cached) return false

  weatherData.value = cached.weather || cached.forecast
  forecastData.value = cached.forecast
  fallbackWarning.value = cached.fallbackMessage || ''
  actualWeatherProvider.value = cached.provider || 'open-meteo'
  forecastCollectedAt.value = cached.collectedAt || new Date(Number(cached.fetchedAt || Date.now())).toISOString()
  currentWeather.value = null
  forecastLoadedFromCache.value = true
  return true
}

const saveForecastToCache = (weather, forecast, fallbackMessage = '', provider = '', current = null) => {
  if (!city.value || lat.value === null || lon.value === null || !selectedActivityId.value) {
    return
  }

  const cache = loadForecastCache()
  const key = getForecastCacheKey()
  cache[key] = {
    city: city.value,
    lat: lat.value,
    lon: lon.value,
    activityId: selectedActivityId.value,
    fetchedAt: Date.now(),
    collectedAt: new Date().toISOString(),
    weather,
    forecast,
    fallbackMessage,
    provider,
    current: null
  }
  saveForecastCache(cache)
}

const runAnalysisOnly = async () => {
  if (!weatherData.value || !city.value || !selectedActivityId.value) return
  
  aiLoading.value = true
  error.value = null
  try {
    const analyzeRes = await axios.post(`${API_BASE_URL}/api/analyze`, {
      city: city.value,
      activityId: selectedActivityId.value,
      structuredWeather: weatherData.value,
      useAi: useAiAnalysis.value
    })
    forecastData.value = analyzeRes.data.forecast
    fallbackWarning.value = analyzeRes.data.fallbackMessage || ''
    forecastCollectedAt.value = new Date().toISOString()
    saveForecastToCache(weatherData.value, analyzeRes.data.forecast, fallbackWarning.value, actualWeatherProvider.value, currentWeather.value)
  } catch (err) {
    if (err.response?.status !== 401) {
      error.value = useAiAnalysis.value ? "Impossible d'obtenir l'analyse IA" : "Impossible d'obtenir l'analyse"
    }
  } finally {
    aiLoading.value = false
  }
}

const toggleAiPreference = () => {
  useAiAnalysis.value = !useAiAnalysis.value
  handleAiToggle()
}

const handleAiToggle = () => {
  syncPreferences()
  if (restoreCachedForecast()) {
    fetchCurrentWeatherOnly()
    return
  }
  if (weatherData.value && city.value && selectedActivityId.value) {
    runAnalysisOnly()
  }
}

const fetchForecast = async (useCache = true) => {
  if (!city.value || !lat.value || !lon.value) return;
  if (!selectedActivityId.value) {
    error.value = "Veuillez sélectionner une activité avant de lancer l'analyse."
    return
  }
  if (useCache && restoreCachedForecast()) {
    fetchCurrentWeatherOnly()
    return
  }

  // --- ÉTAPE 1 : Récupération météo brute ---
  loading.value = true
  aiLoading.value = false
  error.value = null
  suggestions.value = []
  weatherData.value = null
  forecastData.value = null
  currentWeather.value = null
  forecastLoadedFromCache.value = false

  localStorage.setItem('selected_city', city.value)
  localStorage.setItem('selected_lat', lat.value)
  localStorage.setItem('selected_lon', lon.value)
  localStorage.setItem('selected_activity_id', selectedActivityId.value)

  let rawWeather = null
  let detectedProvider = 'open-meteo'
  try {
    const weatherRes = await axios.post(`${API_BASE_URL}/api/weather`, {
      lat: lat.value,
      lon: lon.value,
      activityId: selectedActivityId.value
    })
    rawWeather = weatherRes.data.weather
    currentWeather.value = weatherRes.data.current || null
    weatherData.value = rawWeather
    detectedProvider = weatherRes.data.provider || 'open-meteo'
    actualWeatherProvider.value = detectedProvider
  } catch (err) {
    if (err.response?.status !== 401) {
      error.value = "Impossible de récupérer la météo"
    }
    loading.value = false
    return
  } finally {
    loading.value = false
  }

  // --- ÉTAPE 2 : Analyse ---
  await runAnalysisOnly()
}

const fetchCurrentWeatherOnly = async () => {
  if (!lat.value || !lon.value) return
  try {
    const weatherRes = await axios.post(`${API_BASE_URL}/api/weather`, {
      lat: lat.value,
      lon: lon.value,
      activityId: selectedActivityId.value
    })
    currentWeather.value = weatherRes.data.current || null
  } catch (err) {
    console.error("Erreur lors du rafraîchissement des conditions actuelles :", err)
  }
}

const detectAndSetUserLocation = () => {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("La géolocalisation n'est pas supportée par votre navigateur."));
      return;
    }
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const { latitude, longitude } = position.coords;
        const res = await axios.get(`${API_BASE_URL}/api/reverse?lat=${latitude}&lon=${longitude}`);
        let cityName = "Ma position";
        if (res.data && res.data.length > 0) {
          const feature = res.data[0];
          cityName = feature.properties.city || feature.properties.name || feature.properties.town || "Ma position";
        }
        
        city.value = cityName;
        lat.value = latitude;
        lon.value = longitude;
        query.value = cityName;
        
        localStorage.setItem('selected_city', cityName);
        localStorage.setItem('selected_lat', latitude.toString());
        localStorage.setItem('selected_lon', longitude.toString());

        await syncPreferences();
        resolve({ city: cityName, lat: latitude, lon: longitude });
      } catch (err) {
        console.error("Erreur lors de la géolocalisation inversée :", err);
        const cityName = "Ma position";
        city.value = cityName;
        lat.value = position.coords.latitude;
        lon.value = position.coords.longitude;
        query.value = cityName;
        localStorage.setItem('selected_city', cityName);
        localStorage.setItem('selected_lat', position.coords.latitude.toString());
        localStorage.setItem('selected_lon', position.coords.longitude.toString());
        await syncPreferences();
        resolve({ city: cityName, lat: position.coords.latitude, lon: position.coords.longitude });
      }
    }, (err) => {
      console.warn("Permission de géolocalisation refusée ou indisponible :", err.message);
      reject(err);
    });
  });
};

// --- ÉTATS DU RADAR MÉTÉO (RAINVIEWER) ---
const radarEnabled = ref(true)
const radarPlaying = ref(false)
const radarFrames = ref([])
const radarPosition = ref(0)
const radarLoading = ref(false)

let radarLayersNormal = { currentLayer: null }
let radarLayersFullscreen = { currentLayer: null }
let radarTimer = null

const RADAR_OPACITY = 0.8
const TILE_SIZE = window.devicePixelRatio >= 2 ? 512 : 256
const API_URL = "https://api.rainviewer.com/public/weather-maps.json"

const fetchRadarMetadata = async () => {
  try {
    const response = await axios.get(API_URL)
    if (response.data && response.data.radar && response.data.radar.past) {
      radarFrames.value = response.data.radar.past
      radarPosition.value = radarFrames.value.length - 1
    }
  } catch (err) {
    console.error("Impossible de récupérer les métadonnées RainViewer :", err)
  }
}

const createRadarTileLayer = (frame, host) => {
  return L.tileLayer(`${host}${frame.path}/${TILE_SIZE}/{z}/{x}/{y}/2/1_1.png`, {
    tileSize: 256,
    opacity: 0.001,
    maxNativeZoom: 7,
    maxZoom: 18,
    zIndex: 100
  })
}

const updateMapRadarLayer = (mapInst, position, cache) => {
  if (radarFrames.value.length === 0) return
  const frame = radarFrames.value[position]
  if (!frame) return

  const oldLayer = cache.currentLayer
  
  if (cache[position]) {
    if (oldLayer && oldLayer !== cache[position]) {
      oldLayer.setOpacity(0)
    }
    if (radarEnabled.value) {
      cache[position].setOpacity(RADAR_OPACITY)
    } else {
      cache[position].setOpacity(0)
    }
    cache.currentLayer = cache[position]
  } else {
    const host = "https://tilecache.rainviewer.com"
    const newLayer = createRadarTileLayer(frame, host)
    
    newLayer.once('load', () => {
      if (radarPosition.value === position && radarEnabled.value) {
        newLayer.setOpacity(RADAR_OPACITY)
        if (oldLayer && oldLayer !== newLayer) {
          oldLayer.setOpacity(0)
        }
        cache.currentLayer = newLayer
      } else {
        newLayer.setOpacity(0)
      }
      cache[position] = newLayer
    })
    newLayer.addTo(mapInst)
  }
}

const preloadRadarFrame = (position) => {
  if (radarFrames.value.length === 0) return
  const frame = radarFrames.value[position]
  if (!frame) return

  const host = "https://tilecache.rainviewer.com"
  if (weatherMapInstance && !radarLayersNormal[position]) {
    const newLayer = createRadarTileLayer(frame, host)
    newLayer.once('load', () => {
      newLayer.setOpacity(0)
      radarLayersNormal[position] = newLayer
    })
    newLayer.addTo(weatherMapInstance)
  }

  if (weatherFullscreenMapInstance && !radarLayersFullscreen[position]) {
    const newLayer = createRadarTileLayer(frame, host)
    newLayer.once('load', () => {
      newLayer.setOpacity(0)
      radarLayersFullscreen[position] = newLayer
    })
    newLayer.addTo(weatherFullscreenMapInstance)
  }
}

const showRadarFrame = (position) => {
  if (radarFrames.value.length === 0) return
  
  if (position >= radarFrames.value.length) {
    position = 0
  } else if (position < 0) {
    position = radarFrames.value.length - 1
  }
  
  radarPosition.value = position

  if (weatherMapInstance && radarEnabled.value) {
    updateMapRadarLayer(weatherMapInstance, position, radarLayersNormal)
  }

  if (weatherFullscreenMapInstance && radarEnabled.value) {
    updateMapRadarLayer(weatherFullscreenMapInstance, position, radarLayersFullscreen)
  }

  const nextPos = (position + 1) % radarFrames.value.length
  preloadRadarFrame(nextPos)
}

const startRadarAnimation = () => {
  if (radarTimer) return
  radarPlaying.value = true
  
  const playStep = () => {
    let nextPos = radarPosition.value + 1
    if (nextPos >= radarFrames.value.length) {
      nextPos = 0
    }
    showRadarFrame(nextPos)
    radarTimer = setTimeout(playStep, 800)
  }
  radarTimer = setTimeout(playStep, 800)
}

const stopRadarAnimation = () => {
  if (radarTimer) {
    clearTimeout(radarTimer)
    radarTimer = null
  }
  radarPlaying.value = false
}

const toggleRadarAnimation = () => {
  if (radarPlaying.value) {
    stopRadarAnimation()
  } else {
    startRadarAnimation()
  }
}

const stepRadarFrame = (direction) => {
  stopRadarAnimation()
  showRadarFrame(radarPosition.value + direction)
}

const selectRadarPosition = (idx) => {
  stopRadarAnimation()
  showRadarFrame(idx)
}

const toggleRadarEnabled = () => {
  radarEnabled.value = !radarEnabled.value
  if (!radarEnabled.value) {
    stopRadarAnimation()
    if (radarLayersNormal.currentLayer) {
      radarLayersNormal.currentLayer.setOpacity(0)
    }
    if (radarLayersFullscreen.currentLayer) {
      radarLayersFullscreen.currentLayer.setOpacity(0)
    }
  } else {
    showRadarFrame(radarPosition.value)
  }
}

const clearRadarLayersCache = (cache, mapInst) => {
  stopRadarAnimation()
  for (const pos in cache) {
    if (pos === 'currentLayer') continue
    const positionIndex = parseInt(pos, 10)
    if (positionIndex !== radarPosition.value && cache[positionIndex]) {
      if (mapInst) {
        try { mapInst.removeLayer(cache[positionIndex]) } catch (e) {}
      }
      delete cache[positionIndex]
    }
  }
}

const resetRadar = () => {
  stopRadarAnimation()
  if (weatherMapInstance) {
    for (const pos in radarLayersNormal) {
      if (pos === 'currentLayer') continue
      if (radarLayersNormal[pos]) {
        try { weatherMapInstance.removeLayer(radarLayersNormal[pos]) } catch (e) {}
      }
    }
    if (radarLayersNormal.currentLayer) {
      try { weatherMapInstance.removeLayer(radarLayersNormal.currentLayer) } catch (e) {}
    }
  }
  radarLayersNormal = { currentLayer: null }

  if (weatherFullscreenMapInstance) {
    for (const pos in radarLayersFullscreen) {
      if (pos === 'currentLayer') continue
      if (radarLayersFullscreen[pos]) {
        try { weatherFullscreenMapInstance.removeLayer(radarLayersFullscreen[pos]) } catch (e) {}
      }
    }
    if (radarLayersFullscreen.currentLayer) {
      try { weatherFullscreenMapInstance.removeLayer(radarLayersFullscreen.currentLayer) } catch (e) {}
    }
  }
  radarLayersFullscreen = { currentLayer: null }
  
  radarFrames.value = []
  radarPosition.value = 0
}

const formatRadarTime = (timestamp) => {
  if (!timestamp) return ''
  const date = new Date(timestamp * 1000)
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (radarFrames.value.length > 0 && timestamp === radarFrames.value[radarFrames.value.length - 1].time) {
    return `${timeStr} (Direct)`
  }
  return timeStr
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
          <!-- Avatar Strava (si lié) ou Bouton pour lier (si non lié) -->
          <div class="header-strava-action">
            <img v-if="stravaStatus.connected && stravaStatus.athleteProfile" :src="stravaStatus.athleteProfile" class="header-strava-avatar" :alt="stravaStatus.athleteName" :title="`Compte Strava lié : ${stravaStatus.athleteName}`" />
            <span v-else-if="stravaStatus.connected" class="mdi mdi-account-circle header-strava-avatar-fallback" :title="`Compte Strava lié : ${stravaStatus.athleteName}`"></span>
            <button v-else class="btn-strava-connect-header" @click="connectStrava" :disabled="loadingConnect" title="Associer mon compte Strava">
              <span v-if="loadingConnect" class="mdi mdi-loading mdi-spin"></span>
              <img v-else src="/strava_logo.png" alt="Strava" class="strava-btn-logo-header" />
            </button>
          </div>

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

              <!-- Analyse IA Toggle -->
              <div class="burger-menu-item burger-ai-item">
                <span class="burger-menu-icon mdi mdi-brain"></span>
                <span class="burger-menu-label">Analyse par l'IA</span>
                <label class="switch-container">
                  <input type="checkbox" v-model="useAiAnalysis" @change="handleAiToggle" />
                  <span class="switch-slider"></span>
                </label>
              </div>

              <div class="burger-menu-divider"></div>

              <!-- Compte -->
              <button @click="openAccount" class="burger-menu-item burger-menu-btn" :class="{ active: showAccountPanel }">
                <span class="burger-menu-icon mdi mdi-account-cog"></span>
                <span class="burger-menu-label">Compte</span>
              </button>

              <!-- Délier Strava (si connecté) -->
              <template v-if="stravaStatus.connected">
                <div class="burger-menu-divider"></div>
                <button @click="disconnectStrava" class="burger-menu-item burger-menu-btn burger-strava-disconnect">
                  <span class="burger-menu-icon mdi mdi-link-off"></span>
                  <span class="burger-menu-label">Délier Strava</span>
                </button>
              </template>

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
        <div v-if="isWeatherPage && city" class="header-location">
          <span class="mdi mdi-map-marker"></span>
          <span class="location-name">{{ city }}</span>
        </div>
        <nav class="main-nav">
          <button @click="openWeather" :class="{ active: isWeatherPage }">
            <span class="mdi mdi-weather-sunny"></span> Météo
          </button>
          <button @click="openStrava" :class="{ active: showStravaPage }">
            <img src="/strava_logo.png" alt="Strava" class="strava-nav-logo" /> Activités
          </button>
          <button @click="openStravaRoutes" :class="{ active: showStravaRoutesPage }">
            <span class="mdi mdi-map-marker-distance"></span> Itinéraires
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
          
          <!-- Formulaire d'ajout d'activité pliable -->
          <div class="add-activity-trigger-wrapper">
            <button 
              type="button" 
              class="btn-add-activity" 
              @click="toggleAddForm"
            >
              <span class="mdi" :class="showAddForm ? 'mdi-close' : 'mdi-plus'"></span>
              {{ showAddForm ? 'Fermer le formulaire' : 'Ajouter une activité' }}
            </button>
          </div>

          <Transition name="accordion">
            <div v-if="showAddForm" class="activity-add-accordion-wrapper">
              <ActivityForm 
                :loading="activityLoading"
                @submit="saveActivity"
                @cancel="showAddForm = false"
              />
            </div>
          </Transition>

          <div class="activity-list">
            <p v-if="activityLoading && userActivities.length === 0" class="empty-activities">Chargement des activités...</p>
            <p v-else-if="userActivities.length === 0" class="empty-activities">Aucune activité enregistrée.</p>
            
            <div 
              v-for="activity in userActivities" 
              :key="activity._id" 
              class="activity-item-container"
              :class="{ 'is-editing': editingActivityId === activity._id }"
            >
              <article class="activity-card">
                <div class="activity-card-content">
                  <h4><span class="mdi" :class="activity.icon || 'mdi-bike'"></span> {{ activity.label }}</h4>
                  <div v-if="activity.stravaSportType" style="font-size: 0.78rem; font-weight: 600; color: var(--color-strava); margin-top: 4px; display: flex; align-items: center; gap: 4px;">
                    <span class="mdi mdi-strava"></span> Strava : {{ getStravaTypeLabel(activity.stravaSportType) }}
                  </div>
                  <p v-if="activity.constraints" class="activity-constraints-text">
                    {{ activity.constraints }}
                  </p>
                  <div v-if="hasNumericalConstraints(activity)" class="activity-numerical-constraints-list">
                    <span v-if="activity.tempMin !== null || activity.tempMax !== null" class="activity-limit-badge">
                      <span class="mdi mdi-thermometer"></span> {{ formatLimit(activity.tempMin, activity.tempMax, '°C') }}
                    </span>
                    <span v-if="activity.windMin !== null || activity.windMax !== null" class="activity-limit-badge">
                      <span class="mdi mdi-navigation wind-icon-static"></span> {{ formatLimit(activity.windMin, activity.windMax, 'km/h') }}
                    </span>
                    <span v-if="activity.gustMin !== null || activity.gustMax !== null" class="activity-limit-badge">
                      <span class="mdi mdi-weather-windy"></span> {{ formatLimit(activity.gustMin, activity.gustMax, 'km/h') }}
                    </span>
                    <span v-if="activity.precipMin !== null || activity.precipMax !== null" class="activity-limit-badge">
                      <span class="mdi mdi-weather-pouring"></span> {{ formatLimit(activity.precipMin, activity.precipMax, 'mm') }}
                    </span>
                    <span v-if="activity.uvMin !== null || activity.uvMax !== null" class="activity-limit-badge">
                      <span class="mdi mdi-sun-wireless"></span> UV {{ formatLimit(activity.uvMin, activity.uvMax) }}
                    </span>
                  </div>
                </div>
                <div class="activity-actions">
                  <button type="button" @click="toggleEditActivity(activity._id)" :title="editingActivityId === activity._id ? 'Fermer' : 'Modifier'">
                    <span class="mdi" :class="editingActivityId === activity._id ? 'mdi-close' : 'mdi-pencil'"></span>
                  </button>
                  <button type="button" @click="deleteActivity(activity._id)" title="Supprimer">
                    <span class="mdi mdi-delete"></span>
                  </button>
                </div>
              </article>

              <Transition name="accordion">
                <div v-if="editingActivityId === activity._id" class="activity-edit-accordion">
                  <ActivityForm 
                    :initialData="activity"
                    :loading="activityLoading"
                    @submit="saveActivity"
                    @cancel="cancelEdit"
                  />
                </div>
              </Transition>
            </div>
          </div>
        </section>
      </div>
    </main>
    <main v-else-if="showStravaPage">
      <StravaActivities :theme="resolvedTheme" :api-base-url="API_BASE_URL" />
    </main>
    <main v-else-if="showStravaRoutesPage">
      <StravaRoutes
        :theme="resolvedTheme"
        :api-base-url="API_BASE_URL"
        :initial-city="city"
        :initial-lat="lat"
        :initial-lon="lon"
        :favorites="favorites"
        :user-activities="userActivities"
        :use-ai-analysis="useAiAnalysis"
        @update:location="updateGlobalLocation"
      />
    </main>
    <main v-else>
      <section class="config-section location-section">
        <div class="search-container">
          <div class="input-group">
            <label><span class="mdi mdi-map-marker"></span> Localisation :</label>
            <div class="search-input-wrapper">
              <input v-model="query" @input="searchCities" placeholder="Ville..." @keyup.enter="fetchForecast"/>
              <button type="button" @click="toggleFavorite" :disabled="!city || loading" class="fav-btn" :title="isCurrentCityFavorite ? 'Retirer des favoris' : 'Ajouter aux favoris'">
                <span class="mdi" :class="isCurrentCityFavorite ? 'mdi-star text-warning' : 'mdi-star-outline'"></span>
              </button>
              <button type="button" @click="useDeviceLocation" :disabled="loading || geoLoading" class="geo-btn" title="Utiliser ma position actuelle">
                <span v-if="!geoLoading" class="mdi mdi-crosshairs-gps"></span>
                <span v-else class="mdi mdi-loading mdi-spin"></span>
              </button>
              <button type="button" @click="toggleMap" :disabled="!lat || !lon" class="map-btn" :class="{ 'map-active': showMap }" :title="showMap ? 'Masquer la carte' : 'Afficher la carte'">
                <span class="mdi" :class="showMap ? 'mdi-map-legend' : 'mdi-map'"></span>
              </button>
              <button @click="fetchForecast(false)" :disabled="loading || !city || geoLoading" class="refresh-btn" title="Actualiser">
                <span v-if="!loading" class="mdi mdi-refresh"></span>
                <span v-else class="mdi mdi-loading mdi-spin"></span>
              </button>
            </div>
          </div>
          <ul v-if="suggestions.length > 0" class="suggestions-list">
            <li v-for="(s, index) in suggestions" :key="index" @click="selectCity(s)" class="suggestion-item">
              <div class="suggestion-info">
                <span v-if="isSuggestionFavorite(s)" class="mdi mdi-star suggestion-fav-star" title="Cette ville est dans vos favoris"></span>
                <strong>{{ s.properties.name }}</strong>
                <span class="region-text" v-if="s.properties.state">- {{ s.properties.state }}</span>
              </div>
            </li>
          </ul>
          <!-- Carte de localisation interactive -->
          <div v-show="showMap" class="weather-map-container-wrapper">
            <div class="map-container-relative">
              <div class="map-actions-overlay">
                <button type="button" class="btn-map-action" :class="{ 'radar-active': radarEnabled }" @click="toggleRadarEnabled" title="Activer/Désactiver le radar météo">
                  <span class="mdi" :class="radarEnabled ? 'mdi-radar' : 'mdi-radar-off'"></span> Radar
                </button>
                <button type="button" class="btn-map-action" @click="openWeatherFullscreen" title="Ouvrir la carte en plein écran">
                  <span class="mdi mdi-fullscreen"></span> Plein écran
                </button>
              </div>
              <div id="weather-map-container" class="weather-map-container"></div>

              <!-- Contrôles du radar météo -->
              <div v-if="radarFrames.length > 0 && radarEnabled" class="radar-controls-overlay">
                <div class="radar-animation-panel">
                  <button type="button" class="btn-radar-control" @click="stepRadarFrame(-1)" title="Image précédente">
                    <span class="mdi mdi-chevron-left"></span>
                  </button>
                  <button type="button" class="btn-radar-control btn-play-pause" @click="toggleRadarAnimation" :title="radarPlaying ? 'Pause' : 'Play'">
                    <span class="mdi" :class="radarPlaying ? 'mdi-pause' : 'mdi-play'"></span>
                  </button>
                  <button type="button" class="btn-radar-control" @click="stepRadarFrame(1)" title="Image suivante">
                    <span class="mdi mdi-chevron-right"></span>
                  </button>
                  
                  <div class="radar-info">
                    <span class="radar-timestamp">{{ formatRadarTime(radarFrames[radarPosition]?.time) }}</span>
                  </div>

                  <div class="radar-timeline">
                    <div 
                      v-for="(frame, idx) in radarFrames" 
                      :key="frame.time" 
                      class="radar-timeline-tick"
                      :class="{ 'is-active': idx === radarPosition }"
                      @click="selectRadarPosition(idx)"
                      :title="formatRadarTime(frame.time)"
                    ></div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-if="favorites.length > 0" class="favorites-dropdown-container">
            <label for="favorites-select" class="favorites-dropdown-label">
              <span class="mdi mdi-star"></span> Favoris :
            </label>
            <select id="favorites-select" v-model="selectedFavoriteIndex" class="favorites-select" aria-label="Sélectionner une ville favorite">
              <option value="-1" disabled>Choisir une ville favorite...</option>
              <option v-for="(fav, index) in favorites" :key="fav._id || fav.city" :value="index">
                {{ fav.city }}
              </option>
            </select>
          </div>
        </div>
      </section>

      <!-- Pavé des conditions actuelles -->
      <Transition name="fade">
        <div v-if="currentWeather && !loading" class="current-weather-panel">
          <h3 class="current-weather-title">
            <span class="mdi mdi-weather-cloudy" aria-hidden="true"></span>
            <div class="current-weather-title-text">
              <span class="current-weather-subtitle">
                Conditions météo à
                <span v-if="currentWeather.time"> {{ formatCollectionTime(currentWeather.time) }} (heure locale)</span>
              </span>
              <span class="current-city-name">{{ city }}</span>
            </div>
          </h3>
          <div class="current-weather-layout">
            <!-- Icone météo principale sur la gauche -->
            <div class="current-weather-left">
              <WeatherIcon :icon="getWeatherIcon(currentWeather, isNightHour(new Date().toISOString().split('T')[0], new Date().getHours()))" class="current-weather-main-icon" />
              <span class="current-weather-label-text">{{ getCurrentWeatherLabel(currentWeather) }}</span>
            </div>

            <!-- Informations chiffrées sur la droite -->
            <div class="current-weather-right">
              <!-- Carte Température Actuelle -->
              <div class="current-weather-card">
                <span class="mdi mdi-thermometer current-weather-icon text-temp" aria-hidden="true"></span>
                <div class="current-weather-details">
                  <span class="current-weather-label">Température</span>
                  <span class="current-weather-value">{{ currentWeather.temp }}°C</span>
                </div>
              </div>

              <!-- Carte Température Ressentie -->
              <div class="current-weather-card">
                <span class="mdi mdi-thermometer-lines current-weather-icon text-apparent" aria-hidden="true"></span>
                <div class="current-weather-details">
                  <span class="current-weather-label">Ressentie</span>
                  <span class="current-weather-value">{{ currentWeather.apparentTemp }}°C</span>
                </div>
              </div>

              <!-- Carte Vent -->
              <div class="current-weather-card">
                <div class="current-weather-icon text-wind">
                  <span class="mdi mdi-navigation wind-icon" :style="getWindStyle(currentWeather.windDir)" aria-hidden="true"></span>
                </div>
                <div class="current-weather-details">
                  <span class="current-weather-label">Vent</span>
                  <span class="current-weather-value">{{ currentWeather.wind }} km/h</span>
                </div>
              </div>

              <!-- Carte Rafales -->
              <div class="current-weather-card">
                <span class="mdi mdi-weather-windy current-weather-icon text-gust" aria-hidden="true"></span>
                <div class="current-weather-details">
                  <span class="current-weather-label">Rafales</span>
                  <span class="current-weather-value">{{ currentWeather.gust }} km/h</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <div v-if="loading" class="status-msg"><span class="mdi mdi-cloud-download-outline mdi-spin-slow"></span> Récupération de la météo...</div>
      <div v-if="aiLoading" class="status-msg status-msg-ai">
        <span class="mdi" :class="useAiAnalysis ? 'mdi-brain mdi-pulse' : 'mdi-sync mdi-spin'"></span>
        {{ useAiAnalysis ? 'Analyse IA en cours...' : 'Analyse des critères en cours...' }}
      </div>
      <div v-if="error" class="error-msg"><span class="mdi mdi-alert-circle"></span> {{ error }}</div>
      <div v-if="fallbackWarning" class="fallback-msg">
        <span class="mdi mdi-alert"></span> {{ fallbackWarning }}
        <button class="fallback-close" @click="fallbackWarning = ''" aria-label="Fermer">&times;</button>
      </div>

      <!-- Résumé journalier : affiche la météo brute dès qu'elle est disponible -->
      <div v-if="(weatherData || forecastData) && !loading" class="daily-summary-container">
        <div class="daily-summary-scroll">
          <div v-for="(day, index) in (forecastData || weatherData)" :key="'summary-'+index" class="daily-summary-card" :class="{ 'is-selected': selectedDayIndex === index, 'is-weekend': isWeekend(day.date) }" @click="toggleDayHourly(index)">
            <div class="summary-day">{{ getShortDayName(day.date) }}</div>
            <div class="summary-icon"><WeatherIcon :icon="getDailyWeatherIcon(day)" /></div>
            <div class="summary-temps">
              <span class="temp-min">{{ getDailyMinTemp(day) }}°</span> /
              <span class="temp-max">{{ getDailyMaxTemp(day) }}°</span>
            </div>
            <div class="summary-wind">
              <span class="mdi mdi-navigation wind-icon" :style="getWindStyle(getDailyWindDir(day))"></span>
              {{ getDailyWind(day) }} km/h
            </div>
            <div class="summary-gust">
              <span class="mdi mdi-weather-windy" title="Rafales"></span> {{ getDailyGust(day) }} km/h
            </div>
            <div class="summary-precip">
              <span class="mdi mdi-weather-pouring" title="Précipitations"></span> {{ getDailyPrecip(day) }} mm
            </div>
            <div class="summary-rain">
              <span class="mdi mdi-water-percent" title="Probabilité de pluie"></span> {{ getDailyRain(day) }}%
            </div>
          </div>
        </div>
      </div>

      <!-- Détail heure par heure du jour sélectionné -->
      <Transition name="fade">
        <div v-if="selectedDayForHourly" class="selected-day-hourly-details">
          <div class="hourly-scroll-wrapper">
            <div class="hourly-scroll-container" @scroll="handleHourlyScroll">
              <div v-for="dayIndex in loadedDayIndexes" :key="dayIndex" class="hourly-day-group">
                <div class="hourly-day-header">
                  <span class="mdi mdi-calendar"></span> {{ formatDate(getDayByIndex(dayIndex)?.date) }}
                </div>
                <WeatherHourlyTimeline :hourlyData="getDayByIndex(dayIndex)?.full_day?.hourly" :date="getDayByIndex(dayIndex)?.date" :theme="resolvedTheme" />
              </div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- Activité à analyser (scindé et relocalisé) -->
      <section class="config-section activity-section">
        <div class="search-container">
          <div class="input-group">
            <label><span class="mdi mdi-format-list-checks"></span> Activité à analyser :</label>
            <div class="activity-select-row">
              <div class="custom-select-container">
                <button
                  type="button"
                  class="custom-select-trigger"
                  @click.stop="toggleActivityDropdown"
                  :disabled="activityLoading"
                  aria-haspopup="listbox"
                  :aria-expanded="showActivityDropdown"
                >
                  <span class="mdi custom-select-trigger-icon" :class="selectedActivityIcon"></span>
                  <span class="custom-select-trigger-text">
                    {{ selectedActivityId === 'none' ? 'Aucune (Plein air général)' : (selectedActivity?.label || 'Aucune') }}
                  </span>
                  <span class="mdi mdi-chevron-down custom-select-arrow" :class="{ 'arrow-rotate': showActivityDropdown }"></span>
                </button>
                
                <ul v-if="showActivityDropdown" class="custom-select-options" role="listbox">
                  <li
                    class="custom-select-option"
                    :class="{ 'is-selected': selectedActivityId === 'none' }"
                    role="option"
                    @click="selectActivityCustom('none')"
                  >
                    <span class="mdi option-icon mdi-compass-outline"></span>
                    <span class="option-label">Aucune (Plein air général)</span>
                  </li>
                  <li
                    v-for="activity in userActivities"
                    :key="activity._id"
                    class="custom-select-option"
                    :class="{ 'is-selected': selectedActivityId === activity._id }"
                    role="option"
                    @click="selectActivityCustom(activity._id)"
                  >
                    <span class="mdi option-icon" :class="activity.icon || 'mdi-bike'"></span>
                    <span class="option-label">{{ activity.label }}</span>
                  </li>
                </ul>
              </div>

              <button
                v-if="selectedActivityId !== 'none'"
                type="button"
                class="btn-edit-selected-activity"
                @click="toggleEditWeatherPageActivity"
                :title="showEditWeatherPageForm ? 'Fermer la modification' : 'Modifier cette activité'"
              >
                <span class="mdi" :class="showEditWeatherPageForm ? 'mdi-close' : 'mdi-pencil'"></span>
              </button>

              <button
                type="button"
                class="btn-add-selected-activity"
                @click="toggleAddWeatherPageActivity"
                :title="showAddWeatherPageForm ? 'Fermer l\'ajout' : 'Ajouter une activité'"
              >
                <span class="mdi" :class="showAddWeatherPageForm ? 'mdi-close' : 'mdi-plus'"></span>
              </button>
            </div>

            <!-- Formulaire d'édition de l'activité sélectionnée en accordéon -->
            <Transition name="accordion">
              <div v-if="showEditWeatherPageForm && selectedActivity && selectedActivityId !== 'none'" class="weather-page-activity-edit-accordion">
                <ActivityForm
                  :initialData="selectedActivity"
                  :loading="activityLoading"
                  @submit="saveActivity"
                  @cancel="showEditWeatherPageForm = false"
                />
              </div>
            </Transition>

            <!-- Formulaire d'ajout d'activité en accordéon -->
            <Transition name="accordion">
              <div v-if="showAddWeatherPageForm" class="weather-page-activity-edit-accordion">
                <ActivityForm
                  :loading="activityLoading"
                  @submit="saveActivity"
                  @cancel="showAddWeatherPageForm = false"
                />
              </div>
            </Transition>
            
            <!-- Affichage des critères et plages horaires de l'activité sélectionnée -->
            <div v-if="selectedActivity" class="selected-activity-details" style="margin-top: 8px;">
              <p v-if="selectedActivity.constraints && selectedActivityId !== 'none'" class="activity-constraints-text" style="margin: 6px 0; font-size: 0.82rem; color: var(--text-secondary);">
                {{ selectedActivity.constraints }}
              </p>
              <div class="activity-numerical-constraints-list" style="margin-top: 4px; display: flex; flex-wrap: wrap; gap: 6px;">
                <!-- Plages horaires -->
                <span class="activity-limit-badge slot-badge">
                  <span class="mdi mdi-clock-outline"></span> 
                  <strong>{{ selectedActivity.slot1Name || 'Matin' }}</strong> : {{ selectedActivity.slot1Start }}h - {{ selectedActivity.slot1End }}h
                </span>
                <span class="activity-limit-badge slot-badge">
                  <span class="mdi mdi-clock-outline"></span> 
                  <strong>{{ selectedActivity.slot2Name || 'Après-midi' }}</strong> : {{ selectedActivity.slot2Start }}h - {{ selectedActivity.slot2End }}h
                </span>
                
                <!-- Limites météo numériques (seulement si ce n'est pas 'none' et qu'il y a des limites) -->
                <template v-if="selectedActivityId !== 'none' && hasNumericalConstraints(selectedActivity)">
                  <span v-if="selectedActivity.tempMin !== null || selectedActivity.tempMax !== null" class="activity-limit-badge">
                    <span class="mdi mdi-thermometer"></span> {{ formatLimit(selectedActivity.tempMin, selectedActivity.tempMax, '°C') }}
                  </span>
                  <span v-if="selectedActivity.windMin !== null || selectedActivity.windMax !== null" class="activity-limit-badge">
                    <span class="mdi mdi-navigation wind-icon-static"></span> {{ formatLimit(selectedActivity.windMin, selectedActivity.windMax, 'km/h') }}
                  </span>
                  <span v-if="selectedActivity.gustMin !== null || selectedActivity.gustMax !== null" class="activity-limit-badge">
                    <span class="mdi mdi-weather-windy"></span> {{ formatLimit(selectedActivity.gustMin, selectedActivity.gustMax, 'km/h') }}
                  </span>
                  <span v-if="selectedActivity.precipMin !== null || selectedActivity.precipMax !== null" class="activity-limit-badge">
                    <span class="mdi mdi-weather-pouring"></span> {{ formatLimit(selectedActivity.precipMin, selectedActivity.precipMax, 'mm') }}
                  </span>
                  <span v-if="selectedActivity.uvMin !== null || selectedActivity.uvMax !== null" class="activity-limit-badge">
                    <span class="mdi mdi-sun-wireless"></span> UV {{ formatLimit(selectedActivity.uvMin, selectedActivity.uvMax) }}
                  </span>
                </template>
              </div>
            </div>

            <!-- Récapitulatif des demi-journées (seulement après analyse, fusionné dans le pavé activité) -->
            <div v-if="forecastData && !loading" class="periods-recap-inside-card">
              <h3 class="recap-title">
                <span class="mdi mdi-checkbox-multiple-marked-outline"></span> Aperçu rapide des créneaux
              </h3>
              <div class="periods-recap-scroll">
                <div 
                  v-for="(day, index) in forecastData" 
                  :key="'recap-'+index" 
                  class="recap-day-tile" 
                  :class="{ 'is-weekend': isWeekend(day.date) }"
                  @click="scrollToDayDetail(index)"
                  title="Cliquer pour voir le détail de ce jour"
                >
                  <div class="recap-day-label">{{ getShortDayName(day.date) }}</div>
                  <div class="recap-periods">
                    <!-- Demi-journée 1 (Matin) -->
                    <span v-if="day.matin" class="bike-day-indicator" :class="day.matin.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'" :title="`${day.matin.label || 'Matin'} : ${day.matin.favorable ? 'Favorable' : 'Défavorable'}`" role="img" :aria-label="day.matin.favorable ? 'Activité : conditions favorables' : 'Activité : conditions défavorables'">
                      <span class="mdi bike-day-indicator__icon" :class="selectedActivityIcon" aria-hidden="true"></span>
                    </span>
                    <div v-else class="recap-slot-empty">
                      <span class="mdi mdi-minus"></span>
                    </div>
                    
                    <!-- Demi-journée 2 (Après-midi) -->
                    <span v-if="day.apres_midi" class="bike-day-indicator" :class="day.apres_midi.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'" :title="`${day.apres_midi.label || 'Après-midi'} : ${day.apres_midi.favorable ? 'Favorable' : 'Défavorable'}`" role="img" :aria-label="day.apres_midi.favorable ? 'Activité : conditions favorables' : 'Activité : conditions défavorables'">
                      <span class="mdi bike-day-indicator__icon" :class="selectedActivityIcon" aria-hidden="true"></span>
                    </span>
                    <div v-else class="recap-slot-empty">
                      <span class="mdi mdi-minus"></span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Grille détaillée : affiche la météo brute (sans IA) si l'IA n'a pas encore répondu -->
      <section v-if="(weatherData || forecastData) && !loading" class="results-section">
        <div class="forecast-grid">
          <div v-for="(day, index) in (forecastData || weatherData)" :key="index" class="day-card" :class="{ 'is-weekend': isWeekend(day.date) }" :id="'day-detail-' + index">
            <h3><span class="mdi mdi-calendar"></span> {{ formatDate(day.date) }}</h3>
            <div class="day-split">
              <!-- MATIN -->
              <div v-if="day.matin" class="half-day" :class="[
                forecastData ? (day.matin.favorable ? 'favorable' : 'defavorable') : 'weather-only',
                { 'is-expanded': expandedPeriods[`${index}-matin`] }
              ]" @click="togglePeriod(index, 'matin')">
                <!-- Indicateur activité : affiché seulement après l'analyse IA -->
                <span v-if="forecastData"
                  class="bike-day-indicator"
                  :class="day.matin.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'"
                  :title="day.matin.favorable ? 'Conditions favorables pour l\'activité' : 'Conditions défavorables pour l\'activité'"
                  role="img"
                  :aria-label="day.matin.favorable ? 'Activité : conditions favorables' : 'Activité : conditions défavorables'"
                >
                  <span class="mdi bike-day-indicator__icon" :class="selectedActivityIcon" aria-hidden="true"></span>
                </span>
                <h4 class="half-day-heading">
                  <WeatherIcon class="weather-main-icon" :icon="getWeatherIcon(day.matin)" />
                  <span class="half-day-heading-label">{{ day.matin.label || 'Matin' }} <span class="half-day-hours">({{ selectedActivity?.slot1Start ?? 8 }}h-{{ selectedActivity?.slot1End ?? 12 }}h)</span></span>
                </h4>
                <div class="metrics">
                  <span :class="forecastData ? critereClass(day.matin, 'temperature') : 'metric-critere critere-neutre'"><span class="mdi mdi-thermometer"></span> {{ day.matin.minTemp !== undefined ? day.matin.minTemp + ' / ' + day.matin.temp : day.matin.temp }}°C</span>
                  <span :class="forecastData ? critereClass(day.matin, 'pluie') : 'metric-critere critere-neutre'"><span class="mdi mdi-water-percent"></span> {{ day.matin.rain }}%</span>
                  <span :class="forecastData ? critereClass(day.matin, 'precipitations') : 'metric-critere critere-neutre'"><span class="mdi mdi-weather-pouring"></span> {{ day.matin.precip }}mm</span>
                  <span :class="forecastData ? critereClass(day.matin, 'vent') : 'metric-critere critere-neutre'"><span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.matin.dir)"></span> {{ day.matin.wind }}km/h</span>
                  <span :class="forecastData ? critereClass(day.matin, 'rafales') : 'metric-critere critere-neutre'"><span class="mdi mdi-weather-windy" title="Rafales"></span> {{ day.matin.gust }}km/h</span>
                  <span :class="forecastData ? critereClass(day.matin, 'uv') : 'metric-critere critere-neutre'"><span class="mdi mdi-sun-wireless"></span> UV {{ day.matin.uv }}</span>
                </div>
                <!-- Conseil IA : affiché seulement après l'analyse -->
                <div v-if="forecastData" class="ia-advice">{{ day.matin.conseil }}</div>
                <div v-else-if="aiLoading" class="ia-advice ia-advice-pending">
                  <span class="mdi mdi-brain mdi-spin-slow"></span> Analyse en cours...
                </div>

                <div v-if="expandedPeriods[`${index}-matin`] && day.matin.hourly" @click.stop class="timeline-scroll-container">
                  <WeatherHourlyTimeline fit-container :hourlyData="day.matin.hourly" :date="day.date" :theme="resolvedTheme" />
                </div>
              </div>

              <!-- APRÈS-MIDI -->
              <div v-if="day.apres_midi" class="half-day" :class="[
                forecastData ? (day.apres_midi.favorable ? 'favorable' : 'defavorable') : 'weather-only',
                { 'is-expanded': expandedPeriods[`${index}-apres_midi`] }
              ]" @click="togglePeriod(index, 'apres_midi')">
                <span v-if="forecastData"
                  class="bike-day-indicator"
                  :class="day.apres_midi.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'"
                  :title="day.apres_midi.favorable ? 'Conditions favorables pour l\'activité' : 'Conditions défavorables pour l\'activité'"
                  role="img"
                  :aria-label="day.apres_midi.favorable ? 'Activité : conditions favorables' : 'Activité : conditions défavorables'"
                >
                  <span class="mdi bike-day-indicator__icon" :class="selectedActivityIcon" aria-hidden="true"></span>
                </span>
                <h4 class="half-day-heading">
                  <WeatherIcon class="weather-main-icon" :icon="getWeatherIcon(day.apres_midi)" />
                  <span class="half-day-heading-label">{{ day.apres_midi.label || 'Après-midi' }} <span class="half-day-hours">({{ selectedActivity?.slot2Start ?? 14 }}h-{{ selectedActivity?.slot2End ?? 19 }}h)</span></span>
                </h4>
                <div class="metrics">
                  <span :class="forecastData ? critereClass(day.apres_midi, 'temperature') : 'metric-critere critere-neutre'"><span class="mdi mdi-thermometer"></span> {{ day.apres_midi.minTemp !== undefined ? day.apres_midi.minTemp + ' / ' + day.apres_midi.temp : day.apres_midi.temp }}°C</span>
                  <span :class="forecastData ? critereClass(day.apres_midi, 'pluie') : 'metric-critere critere-neutre'"><span class="mdi mdi-water-percent"></span> {{ day.apres_midi.rain }}%</span>
                  <span :class="forecastData ? critereClass(day.apres_midi, 'precipitations') : 'metric-critere critere-neutre'"><span class="mdi mdi-weather-pouring"></span> {{ day.apres_midi.precip }}mm</span>
                  <span :class="forecastData ? critereClass(day.apres_midi, 'vent') : 'metric-critere critere-neutre'"><span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.apres_midi.dir)"></span> {{ day.apres_midi.wind }}km/h</span>
                  <span :class="forecastData ? critereClass(day.apres_midi, 'rafales') : 'metric-critere critere-neutre'"><span class="mdi mdi-weather-windy" title="Rafales"></span> {{ day.apres_midi.gust }}km/h</span>
                  <span :class="forecastData ? critereClass(day.apres_midi, 'uv') : 'metric-critere critere-neutre'"><span class="mdi mdi-sun-wireless"></span> UV {{ day.apres_midi.uv }}</span>
                </div>
                <div v-if="forecastData" class="ia-advice">{{ day.apres_midi.conseil }}</div>
                <div v-else-if="aiLoading" class="ia-advice ia-advice-pending">
                  <span class="mdi mdi-brain mdi-spin-slow"></span> Analyse en cours...
                </div>

                <div v-if="expandedPeriods[`${index}-apres_midi`] && day.apres_midi.hourly" @click.stop class="timeline-scroll-container">
                  <WeatherHourlyTimeline fit-container :hourlyData="day.apres_midi.hourly" :date="day.date" :theme="resolvedTheme" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>

    <!-- Modal Carte Plein Écran pour la météo -->
    <div v-if="showWeatherFullscreen" class="map-fullscreen-modal">
      <div class="fullscreen-header">
        <div class="fullscreen-title-group">
          <div class="fullscreen-type-badge">
            <span class="mdi mdi-map-marker-radius"></span>
          </div>
          <div class="fullscreen-title-main">
            <h2>{{ city || 'Localisation' }}</h2>
            <span class="fullscreen-date">Localisation météo</span>
          </div>
        </div>
        <div class="fullscreen-actions">
          <button type="button" class="btn-fullscreen-close" :class="{ 'radar-active': radarEnabled }" @click="toggleRadarEnabled" title="Activer/Désactiver le radar météo" style="margin-right: 8px;">
            <span class="mdi" :class="radarEnabled ? 'mdi-radar' : 'mdi-radar-off'"></span> Radar
          </button>
          <button type="button" class="btn-fullscreen-close" @click="closeWeatherFullscreen">
            <span class="mdi mdi-close"></span> Fermer
          </button>
        </div>
      </div>
      <div class="map-container-relative" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
        <div id="weather-fullscreen-map" class="fullscreen-map-container"></div>
        
        <!-- Contrôles du radar météo en plein écran -->
        <div v-if="radarFrames.length > 0 && radarEnabled" class="radar-controls-overlay">
          <div class="radar-animation-panel">
            <button type="button" class="btn-radar-control" @click="stepRadarFrame(-1)" title="Image précédente">
              <span class="mdi mdi-chevron-left"></span>
            </button>
            <button type="button" class="btn-radar-control btn-play-pause" @click="toggleRadarAnimation" :title="radarPlaying ? 'Pause' : 'Play'">
              <span class="mdi" :class="radarPlaying ? 'mdi-pause' : 'mdi-play'"></span>
            </button>
            <button type="button" class="btn-radar-control" @click="stepRadarFrame(1)" title="Image suivante">
              <span class="mdi mdi-chevron-right"></span>
            </button>
            
            <div class="radar-info">
              <span class="radar-timestamp">{{ formatRadarTime(radarFrames[radarPosition]?.time) }}</span>
            </div>

            <div class="radar-timeline">
              <div 
                v-for="(frame, idx) in radarFrames" 
                :key="frame.time" 
                class="radar-timeline-tick"
                :class="{ 'is-active': idx === radarPosition }"
                @click="selectRadarPosition(idx)"
                :title="formatRadarTime(frame.time)"
              ></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

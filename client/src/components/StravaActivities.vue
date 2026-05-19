<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import axios from 'axios'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

// Fix Leaflet default icon path for Vite
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: new URL('leaflet/dist/images/marker-icon-2x.png', import.meta.url).href,
  iconUrl: new URL('leaflet/dist/images/marker-icon.png', import.meta.url).href,
  shadowUrl: new URL('leaflet/dist/images/marker-shadow.png', import.meta.url).href,
})

const props = defineProps({
  theme: String,
  apiBaseUrl: { type: String, default: 'http://localhost:3001' }
})

const stravaStatus = ref({ connected: false, athleteName: null, athleteProfile: null })
const activities = ref([])
const loading = ref(false)
const loadingConnect = ref(false)
const error = ref(null)
const expandedId = ref(null)

// ---- Tri ----
const sortField = ref('date')
const sortOrder = ref('desc') // 'asc' | 'desc'

const SORT_OPTIONS = [
  { value: 'date', label: 'Date' },
  { value: 'distance', label: 'Distance' },
  { value: 'elevation', label: 'Dénivelé' },
  { value: 'speed', label: 'Vitesse moy.' },
  { value: 'duration', label: 'Durée' },
]

// ---- Période temporelle ----
const timeframe = ref(30) // En jours ou 'custom'
const TIMEFRAME_OPTIONS = [
  { value: 7,   label: '1 semaine' },
  { value: 30,  label: '30 jours' },
  { value: 60,  label: '60 jours' },
  { value: 365, label: '1 an' },
  { value: 'custom', label: 'Calendrier' },
]

const customStartDate = ref(new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().split('T')[0])
const customEndDate = ref(new Date().toISOString().split('T')[0])

const formatShortDate = (isoStr) => {
  if (!isoStr) return ''
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(isoStr))
}

const timeframeLabel = computed(() => {
  if (timeframe.value === 7) return '7 derniers jours'
  if (timeframe.value === 30) return '30 derniers jours'
  if (timeframe.value === 60) return '60 derniers jours'
  if (timeframe.value === 365) return '12 derniers mois'
  if (timeframe.value === 'custom') {
    return `du ${formatShortDate(customStartDate.value)} au ${formatShortDate(customEndDate.value)}`
  }
  return `${timeframe.value} derniers jours`
})

// ---- Filtre par type (multi-sélection) ----
const activeTypeFilters = ref([])
let isInitialized = false

// Watch filters deeply and save to BDD
watch(activeTypeFilters, async (newVal) => {
  if (!isInitialized) return
  try {
    await axios.post(`${props.apiBaseUrl}/api/user/preferences`, {
      stravaFilters: newVal
    })
  } catch (e) {
    console.error('Error saving strava filters to DB', e)
  }
}, { deep: true })

const fetchSavedFilters = async () => {
  try {
    const { data } = await axios.get(`${props.apiBaseUrl}/api/user/preferences`)
    if (data && Array.isArray(data.stravaFilters)) {
      activeTypeFilters.value = data.stravaFilters
    }
  } catch (e) {
    console.error('Error loading strava filters from BDD', e)
  } finally {
    isInitialized = true
  }
}

// Types effectivement présents dans les activités chargées
const availableTypes = computed(() => {
  const seen = [...new Set(activities.value.map(a => a.type))]
  return seen.map(type => ({
    type,
    label: getTypeLabel(type),
    icon: getTypeIcon(type)
  }))
})

const displayedActivities = computed(() => {
  const filtered = activeTypeFilters.value.length === 0
    ? activities.value
    : activities.value.filter(a => activeTypeFilters.value.includes(a.type))

  return [...filtered].sort((a, b) => {
    let va, vb
    switch (sortField.value) {
      case 'date':      va = new Date(a.start_date); vb = new Date(b.start_date); break
      case 'distance':  va = a.distance || 0;         vb = b.distance || 0;         break
      case 'elevation': va = a.total_elevation_gain || 0; vb = b.total_elevation_gain || 0; break
      case 'speed':     va = a.average_speed || 0;    vb = b.average_speed || 0;    break
      case 'duration':  va = a.moving_time || 0;      vb = b.moving_time || 0;      break
      default:          va = new Date(a.start_date); vb = new Date(b.start_date)
    }
    return sortOrder.value === 'desc' ? (va > vb ? -1 : va < vb ? 1 : 0) : (va < vb ? -1 : va > vb ? 1 : 0)
  })
})

const toggleTypeFilter = (type) => {
  if (type === 'all') {
    activeTypeFilters.value = []
    return
  }
  const idx = activeTypeFilters.value.indexOf(type)
  if (idx > -1) {
    activeTypeFilters.value.splice(idx, 1)
  } else {
    activeTypeFilters.value.push(type)
  }
}

const toggleSortOrder = () => { sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc' }
const setSortField = (field) => {
  if (sortField.value === field) toggleSortOrder()
  else { sortField.value = field; sortOrder.value = 'desc' }
}
const stravaNotif = ref(null) // 'success' | 'error' | null

const mapInstances = {} // plain JS, not reactive

// ---- Polyline decoder (Google Encoded Polyline Algorithm) ----
function decodePolyline(encoded) {
  if (!encoded) return []
  const points = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let b, shift = 0, result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1))
    shift = 0; result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1))
    points.push([lat / 1e5, lng / 1e5])
  }
  return points
}

// ---- Formatters ----
const formatDistance = (m) => m ? (m / 1000).toFixed(1) + ' km' : '—'
const formatElevation = (m) => m ? Math.round(m) + ' m' : '—'
const formatSpeed = (ms, type) => {
  if (!ms) return '—'
  const isPace = ['Run', 'Walk', 'Hike'].includes(type)
  if (isPace) {
    const secPerKm = 1000 / ms
    if (secPerKm > 3600) return '—'
    const mins = Math.floor(secPerKm / 60)
    const secs = Math.floor(secPerKm % 60)
    return `${mins}:${secs.toString().padStart(2, '0')} /km`
  } else {
    return (ms * 3.6).toFixed(1) + ' km/h'
  }
}
const formatDuration = (s) => {
  if (!s) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}min` : `${m}min`
}
const formatDate = (iso) => {
  if (!iso) return ''
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso))
}
const getTypeLabel = (type) => {
  const labels = {
    Ride: 'Route',
    GravelRide: 'Gravel',
    VirtualRide: 'Virtuel',
    EBikeRide: 'Vélo Élec',
    MountainBikeRide: 'VTT',
    Run: 'Course',
    Walk: 'Marche',
    Hike: 'Randonnée',
    Swim: 'Natation',
    AlpineSki: 'Ski Alpin',
    Snowboard: 'Snowboard',
    Workout: 'Renforcement',
    Yoga: 'Yoga',
    Kayaking: 'Kayak',
    Canoeing: 'Canoë',
    WeightTraining: 'Muscu'
  }
  return labels[type] || type
}
const getTypeIcon = (type) => {
  const icons = {
    Ride: 'mdi-road-variant',
    GravelRide: 'mdi-terrain',
    VirtualRide: 'mdi-monitor',
    EBikeRide: 'mdi-bicycle-electric',
    MountainBikeRide: 'mdi-pine-tree',
    Run: 'mdi-run',
    Walk: 'mdi-walk',
    Hike: 'mdi-image-filter-hdr',
    Swim: 'mdi-water',
    AlpineSki: 'mdi-ski',
    Snowboard: 'mdi-snowboard',
    Workout: 'mdi-dumbbell',
    Yoga: 'mdi-yoga',
    Kayaking: 'mdi-rowing',
    Canoeing: 'mdi-rowing',
    WeightTraining: 'mdi-dumbbell'
  }
  return icons[type] || 'mdi-motion'
}

// ---- Monthly stats (adaptées aux activités filtrées activement) ----
const monthlyStats = computed(() => {
  const totalKm = displayedActivities.value.reduce((s, a) => s + (a.distance || 0), 0) / 1000
  const totalElev = displayedActivities.value.reduce((s, a) => s + (a.total_elevation_gain || 0), 0)
  const totalTime = displayedActivities.value.reduce((s, a) => s + (a.moving_time || 0), 0)
  return { count: displayedActivities.value.length, totalKm: totalKm.toFixed(0), totalElev: Math.round(totalElev), totalTime: formatDuration(totalTime) }
})

// ---- API calls ----
const fetchStatus = async () => {
  try {
    const { data } = await axios.get(`${props.apiBaseUrl}/api/strava/status`)
    stravaStatus.value = data
  } catch (e) { console.error('Strava status error', e) }
}

const fetchActivities = async () => {
  loading.value = true
  error.value = null
  try {
    const params = {}
    if (timeframe.value === 'custom') {
      params.startDate = customStartDate.value
      params.endDate = customEndDate.value
    } else {
      params.days = timeframe.value
    }
    const { data } = await axios.get(`${props.apiBaseUrl}/api/strava/activities`, { params })
    activities.value = data
  } catch (e) {
    error.value = 'Impossible de charger les activités Strava.'
  } finally { loading.value = false }
}

// Re-fetch activities when timeframe changes
watch(timeframe, () => {
  if (stravaStatus.value.connected) {
    fetchActivities()
  }
})



const connectStrava = async () => {
  loadingConnect.value = true
  try {
    const { data } = await axios.get(`${props.apiBaseUrl}/api/strava/authorize`)
    window.location.href = data.url
  } catch (e) {
    loadingConnect.value = false
    error.value = 'Impossible de contacter Strava.'
  }
}

const disconnectStrava = async () => {
  if (!confirm('Délier votre compte Strava ?')) return
  try {
    await axios.delete(`${props.apiBaseUrl}/api/strava/disconnect`)
    stravaStatus.value = { connected: false, athleteName: null, athleteProfile: null }
    activities.value = []
    Object.keys(mapInstances).forEach(k => { try { mapInstances[k].remove() } catch {} ; delete mapInstances[k] })
  } catch (e) { error.value = 'Erreur lors de la déconnexion.' }
}

// ---- Map logic ----
const initMap = (activityId, encodedPolyline) => {
  const containerId = `strava-map-${activityId}`
  const container = document.getElementById(containerId)
  if (!container) return

  if (mapInstances[activityId]) {
    mapInstances[activityId].invalidateSize()
    return
  }

  const map = L.map(containerId, { zoomControl: true, scrollWheelZoom: false })

  const standardLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
  )

  const topoLayer = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)', maxZoom: 17 }
  )

  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community', maxZoom: 19 }
  )

  // Default to standard layer
  standardLayer.addTo(map)

  // Add premium layers control
  const baseLayers = {
    "Standard": standardLayer,
    "Topographique (Dénivelés)": topoLayer,
    "Satellite": satelliteLayer
  }
  L.control.layers(baseLayers, null, { position: 'bottomleft' }).addTo(map)

  const points = decodePolyline(encodedPolyline)
  if (points.length) {
    const poly = L.polyline(points, { color: '#FC4C02', weight: 4, opacity: 0.9 })
    poly.addTo(map)
    // Start marker (green) and end marker (red)
    L.circleMarker(points[0], { radius: 6, fillColor: '#22c55e', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map)
    L.circleMarker(points[points.length - 1], { radius: 6, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map)
    map.fitBounds(poly.getBounds(), { padding: [20, 20] })
  }
  mapInstances[activityId] = map
}

const escapeXml = (unsafe) => {
  if (!unsafe) return ''
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
      default: return c;
    }
  })
}

const exportToGPX = (activity) => {
  const polyline = activity.map?.summary_polyline
  if (!polyline) return

  const points = decodePolyline(polyline)
  if (points.length === 0) return

  // Build the GPX XML content
  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MeteoVelo" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(activity.name)}</name>
    <time>${activity.start_date || new Date().toISOString()}</time>
  </metadata>
  <trk>
    <name>${escapeXml(activity.name)}</name>
    <type>${activity.type}</type>
    <trkseg>
`

  points.forEach(([lat, lng]) => {
    xml += `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>\n`
  })

  xml += `    </trkseg>
  </trk>
</gpx>`

  // Trigger browser download
  const blob = new Blob([xml], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = activity.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || 'activite'
  a.download = `${safeName}.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const fullscreenActivity = ref(null)
let fullscreenMapInstance = null

const openFullscreenMap = async (activity) => {
  fullscreenActivity.value = activity
  await nextTick()

  const containerId = 'fullscreen-map'
  const container = document.getElementById(containerId)
  if (!container) return

  fullscreenMapInstance = L.map(containerId, { zoomControl: true, scrollWheelZoom: true })

  const standardLayer = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
  )

  const topoLayer = L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)', maxZoom: 17 }
  )

  const satelliteLayer = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community', maxZoom: 19 }
  )

  // Default to standard layer
  standardLayer.addTo(fullscreenMapInstance)

  // Add premium layers control
  const baseLayers = {
    "Standard": standardLayer,
    "Topographique (Dénivelés)": topoLayer,
    "Satellite": satelliteLayer
  }
  L.control.layers(baseLayers, null, { position: 'bottomleft' }).addTo(fullscreenMapInstance)

  const points = decodePolyline(activity.map?.summary_polyline)
  if (points.length) {
    const poly = L.polyline(points, { color: '#FC4C02', weight: 5, opacity: 0.9 })
    poly.addTo(fullscreenMapInstance)

    L.circleMarker(points[0], { radius: 7, fillColor: '#22c55e', color: '#fff', weight: 2.5, fillOpacity: 1 }).addTo(fullscreenMapInstance)
    L.circleMarker(points[points.length - 1], { radius: 7, fillColor: '#ef4444', color: '#fff', weight: 2.5, fillOpacity: 1 }).addTo(fullscreenMapInstance)

    fullscreenMapInstance.fitBounds(poly.getBounds(), { padding: [50, 50] })
  }
}

const closeFullscreenMap = () => {
  if (fullscreenMapInstance) {
    fullscreenMapInstance.remove()
    fullscreenMapInstance = null
  }
  fullscreenActivity.value = null
}

const toggleActivity = async (activity) => {
  if (expandedId.value === activity.id) {
    expandedId.value = null
  } else {
    expandedId.value = activity.id
    if (activity.map?.summary_polyline) {
      await nextTick()
      initMap(activity.id, activity.map.summary_polyline)
    }
  }
}

onMounted(async () => {
  // Check for ?strava= URL param (return from OAuth)
  const params = new URLSearchParams(window.location.search)
  if (params.get('strava') === 'success') stravaNotif.value = 'success'
  if (params.get('strava') === 'error') stravaNotif.value = 'error'
  if (params.has('strava')) {
    const url = new URL(window.location)
    url.searchParams.delete('strava')
    window.history.replaceState({}, '', url)
  }

  await fetchStatus()
  if (stravaStatus.value.connected) {
    await fetchSavedFilters()
    await fetchActivities()
  }
})

onUnmounted(() => {
  Object.keys(mapInstances).forEach(k => { try { mapInstances[k].remove() } catch {} })
  if (fullscreenMapInstance) {
    fullscreenMapInstance.remove()
  }
})
</script>

<template>
  <div class="strava-page" :class="{ 'theme-dark': theme === 'dark' }">

    <!-- Notification retour OAuth -->
    <div v-if="stravaNotif === 'success'" class="strava-notif success">
      <span class="mdi mdi-check-circle"></span> Compte Strava connecté avec succès !
      <button @click="stravaNotif = null" class="notif-close">×</button>
    </div>
    <div v-if="stravaNotif === 'error'" class="strava-notif strava-error">
      <span class="mdi mdi-alert-circle"></span> Erreur lors de la connexion Strava.
      <button @click="stravaNotif = null" class="notif-close">×</button>
    </div>

    <!-- Écran non connecté -->
    <div v-if="!stravaStatus.connected" class="connect-screen">
      <div class="connect-card">
        <div class="strava-logo-wrap">
          <span class="mdi mdi-bike strava-hero-icon"></span>
        </div>
        <h2>Connectez votre compte Strava</h2>
        <p>Visualisez vos activités Strava sur la période de votre choix avec leur tracé sur la carte.</p>
        <button class="btn-strava-connect" @click="connectStrava" :disabled="loadingConnect">
          <span v-if="loadingConnect" class="mdi mdi-loading mdi-spin"></span>
          <span v-else class="mdi mdi-strava"></span>
          {{ loadingConnect ? 'Redirection…' : 'Se connecter avec Strava' }}
        </button>
        <p class="connect-note">Vos données restent privées et sécurisées.</p>
      </div>
    </div>

    <!-- Écran connecté -->
    <div v-else>

      <!-- En-tête athlète -->
      <div class="athlete-header">
        <img v-if="stravaStatus.athleteProfile" :src="stravaStatus.athleteProfile" class="athlete-avatar" alt="avatar" />
        <span v-else class="mdi mdi-account-circle athlete-avatar-fallback"></span>
        <div class="athlete-info">
          <div class="athlete-name">{{ stravaStatus.athleteName }}</div>
          <div class="athlete-sub">{{ timeframeLabel }} · Activités Strava</div>
        </div>
        <button class="btn-disconnect" @click="disconnectStrava" title="Délier Strava">
          <span class="mdi mdi-link-off"></span> Délier
        </button>
      </div>

      <!-- Chargement -->
      <div v-if="loading" class="strava-loading">
        <span class="mdi mdi-loading mdi-spin"></span> Chargement des activités…
      </div>

      <!-- Erreur -->
      <div v-if="error" class="strava-error-msg">
        <span class="mdi mdi-alert-circle"></span> {{ error }}
      </div>

      <!-- Aucune activité -->
      <div v-if="!loading && !error && activities.length === 0" class="strava-empty">
        <span class="mdi mdi-bike-fast strava-empty-icon"></span>
        <p>Aucune activité Strava sur cette période ({{ timeframeLabel }}).</p>
      </div>

      <!-- Sélection de la période -->
      <div v-if="!loading" class="timeframe-controls">
        <span class="sort-label"><span class="mdi mdi-calendar-range"></span> Période :</span>
        <div class="sort-buttons">
          <button
            v-for="opt in TIMEFRAME_OPTIONS"
            :key="opt.value"
            class="sort-btn"
            :class="{ active: timeframe === opt.value }"
            @click="timeframe = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>

      <!-- Date pickers personnalisés -->
      <div v-if="!loading && timeframe === 'custom'" class="custom-date-pickers">
        <div class="date-picker-group">
          <label for="start-date-input">Du :</label>
          <input
            id="start-date-input"
            type="date"
            v-model="customStartDate"
            class="date-input"
          />
        </div>
        <div class="date-picker-group">
          <label for="end-date-input">Au :</label>
          <input
            id="end-date-input"
            type="date"
            v-model="customEndDate"
            class="date-input"
          />
        </div>
        <button class="btn-validate-date" @click="fetchActivities" title="Appliquer la période sélectionnée">
          <span class="mdi mdi-check"></span> Valider
        </button>
      </div>



      <!-- Filtres par type -->
      <div v-if="!loading && activities.length && availableTypes.length > 1" class="filter-controls">
        <span class="sort-label"><span class="mdi mdi-filter-variant"></span> Types (multi) :</span>
        <div class="sort-buttons">
          <button
            class="sort-btn"
            :class="{ active: activeTypeFilters.length === 0 }"
            @click="toggleTypeFilter('all')"
          >
            <span class="mdi mdi-run-fast"></span> Tous
            <span class="type-count">({{ activities.length }})</span>
          </button>
          <button
            v-for="t in availableTypes"
            :key="t.type"
            class="sort-btn"
            :class="{ active: activeTypeFilters.includes(t.type) }"
            @click="toggleTypeFilter(t.type)"
          >
            <span class="mdi" :class="t.icon"></span>
            {{ t.label }}
            <span class="type-count">({{ activities.filter(a => a.type === t.type).length }})</span>
          </button>
        </div>
      </div>

      <!-- Contrôles de tri -->
      <div v-if="!loading && activities.length" class="sort-controls">
        <span class="sort-label"><span class="mdi mdi-sort"></span> Trier par :</span>
        <div class="sort-buttons">
          <button
            v-for="opt in SORT_OPTIONS"
            :key="opt.value"
            class="sort-btn"
            :class="{ active: sortField === opt.value }"
            @click="setSortField(opt.value)"
          >
            {{ opt.label }}
            <span v-if="sortField === opt.value" class="mdi" :class="sortOrder === 'desc' ? 'mdi-arrow-down' : 'mdi-arrow-up'"></span>
          </button>
        </div>
      </div>

      <!-- Stats mensuelles -->
      <div v-if="!loading && activities.length" class="monthly-stats">
        <div class="stat-tile">
          <span class="mdi mdi-run-fast stat-icon"></span>
          <div class="stat-val">{{ monthlyStats.count }}</div>
          <div class="stat-label">Activités</div>
        </div>
        <div class="stat-tile">
          <span class="mdi mdi-map-marker-distance stat-icon"></span>
          <div class="stat-val">{{ monthlyStats.totalKm }} <small>km</small></div>
          <div class="stat-label">Distance totale</div>
        </div>
        <div class="stat-tile">
          <span class="mdi mdi-summit stat-icon"></span>
          <div class="stat-val">{{ monthlyStats.totalElev.toLocaleString() }} <small>m</small></div>
          <div class="stat-label">Dénivelé cumulé</div>
        </div>
        <div class="stat-tile">
          <span class="mdi mdi-clock-outline stat-icon"></span>
          <div class="stat-val">{{ monthlyStats.totalTime }}</div>
          <div class="stat-label">Durée totale</div>
        </div>
      </div>

      <!-- Aucun résultat après filtrage -->
      <div v-if="!loading && activities.length && displayedActivities.length === 0" class="strava-empty">
        <span class="mdi mdi-filter-off strava-empty-icon"></span>
        <p>Aucune activité de ce type sur les 30 derniers jours.</p>
      </div>

      <!-- Liste des activités -->
      <div class="activities-list">
        <div
          v-for="activity in displayedActivities"
          :key="activity.id"
          class="activity-card"
          :class="{ 'is-expanded': expandedId === activity.id }"
        >
          <!-- En-tête de la carte (cliquable) -->
          <div class="activity-header" @click="toggleActivity(activity)">
            <div class="activity-type-badge" :title="getTypeLabel(activity.type)">
              <span class="mdi" :class="getTypeIcon(activity.type)"></span>
            </div>
            <div class="activity-main">
              <div class="activity-name">{{ activity.name }}</div>
              <div class="activity-date">{{ formatDate(activity.start_date) }}</div>
            </div>
            <div class="activity-metrics">
              <span class="metric"><span class="mdi mdi-map-marker-distance"></span>{{ formatDistance(activity.distance) }}</span>
              <span class="metric"><span class="mdi mdi-summit"></span>{{ formatElevation(activity.total_elevation_gain) }}</span>
              <span class="metric"><span class="mdi mdi-speedometer"></span>{{ formatSpeed(activity.average_speed, activity.type) }}</span>
              <span class="metric"><span class="mdi mdi-timer-outline"></span>{{ formatDuration(activity.moving_time) }}</span>
            </div>
            <span class="activity-expand-icon mdi" :class="expandedId === activity.id ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
          </div>

          <!-- Carte Leaflet (collapsible) -->
          <div v-show="expandedId === activity.id" class="activity-map-wrap">
            <div v-if="!activity.map?.summary_polyline" class="map-unavailable">
              <span class="mdi mdi-map-marker-off"></span> Trace GPS non disponible pour cette activité.
            </div>
            <div v-else class="map-container-relative">
              <div :id="`strava-map-${activity.id}`" class="activity-map"></div>
              <!-- Action Overlay: Voir sur Strava & Plein écran & Exporter GPX -->
              <div class="map-actions-overlay">
                <a :href="`https://www.strava.com/activities/${activity.id}`" target="_blank" class="btn-map-action btn-strava-link" title="Voir l'activité sur Strava (nouvel onglet)">
                  <span class="mdi mdi-open-in-new"></span> Voir sur Strava
                </a>
                <button class="btn-map-action" @click.stop="openFullscreenMap(activity)" title="Ouvrir la carte en plein écran">
                  <span class="mdi mdi-fullscreen"></span> Plein écran
                </button>
                <button class="btn-map-action" @click.stop="exportToGPX(activity)" title="Exporter le parcours en GPX">
                  <span class="mdi mdi-download"></span> Exporter GPX
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Modal de Carte Plein Écran -->
    <div v-if="fullscreenActivity" class="map-fullscreen-modal">
      <div class="fullscreen-header">
        <div class="fullscreen-title-group">
          <div class="fullscreen-type-badge">
            <span class="mdi" :class="getTypeIcon(fullscreenActivity.type)"></span>
          </div>
          <div class="fullscreen-title-main">
            <h2>{{ fullscreenActivity.name }}</h2>
            <span class="fullscreen-date">{{ formatDate(fullscreenActivity.start_date) }}</span>
          </div>
        </div>
        <div class="fullscreen-actions">
          <a :href="`https://www.strava.com/activities/${fullscreenActivity.id}`" target="_blank" class="btn-fullscreen-action btn-strava-link-full" title="Voir l'activité sur Strava (nouvel onglet)">
            <span class="mdi mdi-open-in-new"></span> Voir sur Strava
          </a>
          <button class="btn-fullscreen-action" @click="exportToGPX(fullscreenActivity)">
            <span class="mdi mdi-download"></span> Exporter GPX
          </button>
          <button class="btn-fullscreen-close" @click="closeFullscreenMap">
            <span class="mdi mdi-close"></span> Fermer
          </button>
        </div>
      </div>
      <div id="fullscreen-map" class="fullscreen-map-container"></div>
    </div>
  </div>
</template>

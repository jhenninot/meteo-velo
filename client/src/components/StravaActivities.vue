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
const activeTypeFilters = ref([]) // Tableau vide = Tous les types affichés

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
const formatSpeed = (ms) => ms ? (ms * 3.6).toFixed(1) + ' km/h' : '—'
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
  const isDark = props.theme === 'dark'
  L.tileLayer(
    isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: isDark ? '© OpenStreetMap © CARTO' : '© OpenStreetMap contributors', maxZoom: 19 }
  ).addTo(map)

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
  const isDark = props.theme === 'dark'
  L.tileLayer(
    isDark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: isDark ? '© OpenStreetMap © CARTO' : '© OpenStreetMap contributors', maxZoom: 19 }
  ).addTo(fullscreenMapInstance)

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
  if (stravaStatus.value.connected) await fetchActivities()
})

onUnmounted(() => {
  Object.keys(mapInstances).forEach(k => { try { mapInstances[k].remove() } catch {} })
  if (fullscreenMapInstance) {
    fullscreenMapInstance.remove()
  }
})
</script>

<template>
  <div class="strava-page">

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
            <span class="mdi mdi-bike"></span> Tous
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
          <span class="mdi mdi-bike stat-icon"></span>
          <div class="stat-val">{{ monthlyStats.count }}</div>
          <div class="stat-label">Sorties</div>
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
          <div class="stat-label">Temps de selle</div>
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
              <span class="metric"><span class="mdi mdi-speedometer"></span>{{ formatSpeed(activity.average_speed) }}</span>
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
              <!-- Action Overlay: Plein écran & Exporter GPX -->
              <div class="map-actions-overlay">
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

<style scoped>
/* ---- Page container ---- */
.strava-page { padding: 8px 0 40px; }

/* ---- Notifications ---- */
.strava-notif {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 16px; border-radius: 10px; margin-bottom: 20px;
  font-weight: 600; font-size: 0.95rem;
}
.strava-notif.success { background: #dcfce7; color: #166534; }
.strava-notif.strava-error { background: #fee2e2; color: #991b1b; }
.notif-close { margin-left: auto; background: none; border: none; font-size: 1.2rem; cursor: pointer; color: inherit; line-height: 1; }

/* ---- Connect screen ---- */
.connect-screen { display: flex; justify-content: center; padding: 40px 20px; }
.connect-card {
  background: #fff; border-radius: 20px; box-shadow: 0 8px 40px rgba(0,0,0,0.1);
  padding: 48px 40px; max-width: 440px; width: 100%; text-align: center;
}
.strava-logo-wrap { margin-bottom: 20px; }
.strava-hero-icon { font-size: 4rem; color: #FC4C02; }
.connect-card h2 { margin: 0 0 12px; font-size: 1.5rem; color: #1a1a1a; }
.connect-card p { color: #555; margin-bottom: 28px; line-height: 1.5; }
.btn-strava-connect {
  display: inline-flex; align-items: center; gap: 10px;
  background: #FC4C02; color: #fff; border: none;
  padding: 14px 28px; border-radius: 10px; font-size: 1.05rem;
  font-weight: 700; cursor: pointer; width: 100%; justify-content: center;
  transition: background 0.2s, transform 0.15s;
}
.btn-strava-connect:hover:not(:disabled) { background: #e03e00; transform: translateY(-1px); }
.btn-strava-connect:disabled { opacity: 0.6; cursor: not-allowed; }
.connect-note { font-size: 0.78rem; color: #888; margin-top: 14px; margin-bottom: 0; }

/* ---- Athlete header ---- */
.athlete-header {
  display: flex; align-items: center; gap: 14px;
  background: #fff; border-radius: 14px; padding: 16px 20px;
  box-shadow: 0 2px 12px rgba(0,0,0,0.07); margin-bottom: 20px;
}
.athlete-avatar { width: 52px; height: 52px; border-radius: 50%; object-fit: cover; border: 3px solid #FC4C02; }
.athlete-avatar-fallback { font-size: 3rem; color: #FC4C02; }
.athlete-info { flex: 1; }
.athlete-name { font-weight: 700; font-size: 1.1rem; }
.athlete-sub { font-size: 0.82rem; color: #888; margin-top: 2px; }
.btn-disconnect {
  display: flex; align-items: center; gap: 6px; background: #fff1ee;
  color: #FC4C02; border: 1.5px solid #FC4C02; border-radius: 8px;
  padding: 7px 14px; cursor: pointer; font-weight: 600; font-size: 0.85rem;
  transition: background 0.2s;
}
.btn-disconnect:hover { background: #ffe3db; }

/* ---- Monthly stats ---- */
.monthly-stats {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px;
}
@media (max-width: 640px) { .monthly-stats { grid-template-columns: repeat(2, 1fr); } }
.stat-tile {
  background: #fff; border-radius: 14px; padding: 20px 16px; text-align: center;
  box-shadow: 0 2px 10px rgba(0,0,0,0.07); border-top: 3px solid #FC4C02;
}
.stat-icon { font-size: 1.6rem; color: #FC4C02; }
.stat-val { font-size: 1.5rem; font-weight: 800; margin: 6px 0 2px; color: #1a1a1a; }
.stat-val small { font-size: 0.9rem; font-weight: 600; color: #555; }
.stat-label { font-size: 0.78rem; color: #888; font-weight: 500; }

/* ---- Loading / Error / Empty ---- */
.strava-loading, .strava-error-msg, .strava-empty {
  text-align: center; padding: 30px; border-radius: 12px; margin-bottom: 16px;
}
.strava-loading { color: #888; font-size: 1rem; }
.strava-error-msg { background: #fee2e2; color: #991b1b; font-weight: 600; }
.strava-empty { color: #aaa; }
.strava-empty-icon { font-size: 3rem; display: block; margin-bottom: 10px; }

/* ---- Activity cards ---- */
.activities-list { display: flex; flex-direction: column; gap: 12px; }
.activity-card {
  background: #fff; border-radius: 14px;
  box-shadow: 0 2px 10px rgba(0,0,0,0.07);
  overflow: hidden; transition: box-shadow 0.2s;
  border-left: 4px solid #FC4C02;
}
.activity-card.is-expanded { box-shadow: 0 6px 24px rgba(252,76,2,0.15); }

.activity-header {
  display: flex; align-items: center; gap: 14px;
  padding: 14px 18px; cursor: pointer;
  transition: background 0.15s;
}
.activity-header:hover { background: #fff8f6; }

.activity-type-badge {
  flex-shrink: 0; width: 42px; height: 42px; border-radius: 50%;
  background: #fff1ee; color: #FC4C02;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.3rem;
}
.activity-main { flex: 1; min-width: 0; }
.activity-name { font-weight: 700; font-size: 0.97rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.activity-date { font-size: 0.78rem; color: #888; margin-top: 2px; }

.activity-metrics {
  display: flex; flex-wrap: wrap; gap: 8px 16px;
  font-size: 0.82rem; font-weight: 600; color: #444;
}
.metric { display: flex; align-items: center; gap: 4px; }
.metric .mdi { color: #FC4C02; font-size: 1rem; }

@media (max-width: 600px) {
  .activity-header { flex-wrap: wrap; }
  .activity-metrics { width: 100%; }
}

.activity-expand-icon { font-size: 1.3rem; color: #ccc; flex-shrink: 0; }

/* ---- Map ---- */
.activity-map-wrap { border-top: 1px solid #f0f0f0; }
.activity-map { height: 320px; width: 100%; }
.map-unavailable {
  padding: 20px; text-align: center; color: #aaa;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}

/* ========== DARK MODE ========== */
:global(.theme-dark) .connect-card { background: #252a32; color: #e8eaed; }
:global(.theme-dark) .connect-card h2 { color: #e8eaed; }
:global(.theme-dark) .connect-card p { color: #9aa0a6; }
:global(.theme-dark) .connect-note { color: #6b7280; }
:global(.theme-dark) .athlete-header { background: #252a32; }
:global(.theme-dark) .athlete-name { color: #e8eaed; }
:global(.theme-dark) .btn-disconnect { background: #2d1f1a; }
:global(.theme-dark) .btn-disconnect:hover { background: #3d2a20; }
:global(.theme-dark) .stat-tile { background: #252a32; }
:global(.theme-dark) .stat-val { color: #e8eaed; }
:global(.theme-dark) .stat-val small { color: #9aa0a6; }
:global(.theme-dark) .activity-card { background: #252a32; border-left-color: #FC4C02; }
:global(.theme-dark) .activity-card.is-expanded { box-shadow: 0 6px 24px rgba(252,76,2,0.2); }
:global(.theme-dark) .activity-header:hover { background: #2d2420; }
:global(.theme-dark) .activity-name { color: #e8eaed; }
:global(.theme-dark) .activity-date { color: #6b7280; }
:global(.theme-dark) .activity-metrics { color: #c5cad3; }
:global(.theme-dark) .activity-type-badge { background: #3d2a20; }
:global(.theme-dark) .activity-map-wrap { border-top-color: #3d4450; }
:global(.theme-dark) .strava-notif.success { background: #1e3a24; color: #86efac; }
:global(.theme-dark) .strava-notif.strava-error { background: #4a2328; color: #fca5a5; }
:global(.theme-dark) .strava-error-msg { background: #4a2328; color: #fca5a5; }
:global(.theme-dark) .strava-loading { color: #6b7280; }
:global(.theme-dark) .strava-empty { color: #6b7280; }

/* ---- Filter controls ---- */
.filter-controls {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  margin-bottom: 10px;
}
.type-count { font-size: 0.75rem; opacity: 0.75; margin-left: 2px; }

/* ---- Timeframe controls ---- */
.timeframe-controls {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  margin-bottom: 10px;
}


/* ---- Sort controls ---- */
.sort-controls {
  display: flex; align-items: center; flex-wrap: wrap; gap: 10px;
  margin-bottom: 16px;
}
.sort-label { font-size: 0.82rem; font-weight: 600; color: #888; display: flex; align-items: center; gap: 4px; white-space: nowrap; }
.sort-buttons { display: flex; flex-wrap: wrap; gap: 6px; }
.sort-btn {
  display: flex; align-items: center; gap: 4px;
  padding: 5px 12px; border-radius: 20px; border: 1.5px solid #e5e7eb;
  background: #fff; color: #555; font-size: 0.82rem; font-weight: 600;
  cursor: pointer; transition: all 0.15s;
}
.sort-btn:hover { border-color: #FC4C02; color: #FC4C02; background: #fff8f6; }
.sort-btn.active { background: #FC4C02; color: #fff; border-color: #FC4C02; }
.sort-btn .mdi { font-size: 0.9rem; }

:global(.theme-dark) .sort-label { color: #6b7280; }
:global(.theme-dark) .sort-btn { background: #2d333c; border-color: #3d4450; color: #9aa0a6; }
:global(.theme-dark) .sort-btn:hover { border-color: #FC4C02; color: #FC4C02; background: #2d1f1a; }
:global(.theme-dark) .sort-btn.active { background: #FC4C02; color: #fff; border-color: #FC4C02; }

/* ---- Custom date pickers ---- */
.custom-date-pickers {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  background: #f9fafb;
  border-radius: 12px;
  padding: 12px 16px;
  margin-bottom: 12px;
  border: 1px solid #f3f4f6;
  max-width: fit-content;
}
.date-picker-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.date-picker-group label {
  font-size: 0.85rem;
  font-weight: 600;
  color: #555;
}
.date-input {
  border: 1.5px solid #e5e7eb;
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 0.85rem;
  color: #333;
  outline: none;
  font-family: inherit;
  font-weight: 600;
  background: #fff;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.date-input:focus {
  border-color: #FC4C02;
  box-shadow: 0 0 0 3px rgba(252, 76, 2, 0.15);
}

:global(.theme-dark) .custom-date-pickers {
  background: #1e232b;
  border-color: #2d333c;
}
:global(.theme-dark) .date-picker-group label {
  color: #9aa0a6;
}
:global(.theme-dark) .date-input {
  background: #252a32;
  border-color: #3d4450;
  color: #e8eaed;
}
:global(.theme-dark) .date-input:focus {
  border-color: #FC4C02;
}

/* ---- Validate date button ---- */
.btn-validate-date {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #FC4C02;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 6px 14px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s, transform 0.1s;
}
.btn-validate-date:hover {
  background: #e03e00;
}
.btn-validate-date:active {
  transform: scale(0.96);
}

/* ---- Map Export Overlays ---- */
.map-container-relative {
  position: relative;
  width: 100%;
}
.map-actions-overlay {
  position: absolute;
  top: 10px;
  right: 10px;
  z-index: 1000;
  display: flex;
  gap: 8px;
}
.btn-map-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: rgba(255, 255, 255, 0.95);
  border: 1.5px solid #d1d5db;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 0.8rem;
  font-weight: 700;
  color: #374151;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(0,0,0,0.15);
  transition: all 0.15s;
}
.btn-map-action:hover {
  background: #FC4C02;
  color: #fff;
  border-color: #FC4C02;
}

:global(.theme-dark) .btn-map-action {
  background: rgba(37, 42, 50, 0.95);
  border-color: #4b5563;
  color: #e5e7eb;
}
:global(.theme-dark) .btn-map-action:hover {
  background: #FC4C02;
  color: #fff;
  border-color: #FC4C02;
}

/* ---- Fullscreen Map Modal ---- */
.map-fullscreen-modal {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  width: 100vw;
  height: 100vh;
  z-index: 10000;
  background: #fff;
  display: flex;
  flex-direction: column;
}
.fullscreen-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 24px;
  background: #f9fafb;
  border-bottom: 1px solid #e5e7eb;
  z-index: 10001;
}
.fullscreen-title-group {
  display: flex;
  align-items: center;
  gap: 12px;
}
.fullscreen-type-badge {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  background: #fff8f6;
  border-radius: 50%;
  color: #FC4C02;
  font-size: 1.2rem;
  border: 1px solid rgba(252, 76, 2, 0.2);
}
.fullscreen-title-main h2 {
  font-size: 1.05rem;
  font-weight: 700;
  color: #111827;
  margin: 0;
}
.fullscreen-date {
  font-size: 0.78rem;
  color: #6b7280;
}
.fullscreen-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}
.btn-fullscreen-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: #FC4C02;
  color: #fff;
  border: none;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: background 0.15s;
}
.btn-fullscreen-action:hover {
  background: #e03e00;
}
.btn-fullscreen-close {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: #fff;
  color: #374151;
  border: 1.5px solid #d1d5db;
  border-radius: 8px;
  padding: 8px 16px;
  font-size: 0.85rem;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.15s;
}
.btn-fullscreen-close:hover {
  background: #f3f4f6;
  border-color: #9ca3af;
}
.fullscreen-map-container {
  flex: 1;
  width: 100%;
  height: 100%;
}

:global(.theme-dark) .map-fullscreen-modal {
  background: #1a1e24;
}
:global(.theme-dark) .fullscreen-header {
  background: #252a32;
  border-bottom-color: #3d4450;
}
:global(.theme-dark) .fullscreen-type-badge {
  background: #3d2a20;
  border-color: rgba(252, 76, 2, 0.4);
}
:global(.theme-dark) .fullscreen-title-main h2 {
  color: #e8eaed;
}
:global(.theme-dark) .fullscreen-date {
  color: #9aa0a6;
}
:global(.theme-dark) .btn-fullscreen-close {
  background: #2d333c;
  color: #e5e7eb;
  border-color: #3d4450;
}
:global(.theme-dark) .btn-fullscreen-close:hover {
  background: #3d4450;
  border-color: #4b5563;
}
</style>

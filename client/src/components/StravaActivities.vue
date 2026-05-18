<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick } from 'vue'
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

const sortedActivities = computed(() => {
  return [...activities.value].sort((a, b) => {
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

const toggleSortOrder = () => { sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc' }
const setSortField = (field) => {
  if (sortField.value === field) toggleSortOrder()
  else { sortField.value = field; sortOrder.value = field === 'date' ? 'desc' : 'desc' }
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
const getTypeLabel = (type) => ({ Ride: 'Route', GravelRide: 'Gravel', VirtualRide: 'Virtual', EBikeRide: 'E-Bike', MountainBikeRide: 'VTT' }[type] || type)
const getTypeIcon = (type) => ({ Ride: 'mdi-road-variant', GravelRide: 'mdi-terrain', VirtualRide: 'mdi-monitor', EBikeRide: 'mdi-bicycle-electric', MountainBikeRide: 'mdi-pine-tree' }[type] || 'mdi-bike')

// ---- Monthly stats ----
const monthlyStats = computed(() => {
  const totalKm = activities.value.reduce((s, a) => s + (a.distance || 0), 0) / 1000
  const totalElev = activities.value.reduce((s, a) => s + (a.total_elevation_gain || 0), 0)
  const totalTime = activities.value.reduce((s, a) => s + (a.moving_time || 0), 0)
  return { count: activities.value.length, totalKm: totalKm.toFixed(0), totalElev: Math.round(totalElev), totalTime: formatDuration(totalTime) }
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
    const { data } = await axios.get(`${props.apiBaseUrl}/api/strava/activities`)
    activities.value = data
  } catch (e) {
    error.value = 'Impossible de charger les activités Strava.'
  } finally { loading.value = false }
}

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
        <p>Visualisez vos sorties vélo et gravel des <strong>30 derniers jours</strong> avec leur trace sur la carte.</p>
        <button class="btn-strava-connect" @click="connectStrava" :disabled="loadingConnect">
          <span v-if="loadingConnect" class="mdi mdi-loading mdi-spin"></span>
          <span v-else class="mdi mdi-strava"></span>
          {{ loadingConnect ? 'Redirection…' : 'Se connecter avec Strava' }}
        </button>
        <p class="connect-note">Seules les activités vélo/gravel sont récupérées. Vos données restent privées.</p>
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
          <div class="athlete-sub">30 derniers jours · Activités vélo &amp; gravel</div>
        </div>
        <button class="btn-disconnect" @click="disconnectStrava" title="Délier Strava">
          <span class="mdi mdi-link-off"></span> Délier
        </button>
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
        <p>Aucune sortie vélo ou gravel sur les 30 derniers jours.</p>
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

      <!-- Liste des activités -->
      <div class="activities-list">
        <div
          v-for="activity in sortedActivities"
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
            <div v-else :id="`strava-map-${activity.id}`" class="activity-map"></div>
          </div>
        </div>
      </div>

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
</style>

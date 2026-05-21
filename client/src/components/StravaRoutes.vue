<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import axios from 'axios'
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

const props = defineProps({
  theme: String,
  apiBaseUrl: { type: String, default: 'http://localhost:3001' }
})

const stravaStatus = ref({ connected: false, athleteName: null, athleteProfile: null })
const routes = ref([])
const loading = ref(false)
const loadingConnect = ref(false)
const error = ref(null)
const expandedId = ref(null)

// ---- Tri ----
const sortField = ref('updated')
const sortOrder = ref('desc') // 'asc' | 'desc'

const SORT_OPTIONS = [
  { value: 'updated', label: 'Dernière mise à jour' },
  { value: 'name', label: 'Nom' },
  { value: 'distance', label: 'Distance' },
  { value: 'elevation', label: 'Dénivelé' },
]

// ---- Filtre par type (multi-sélection) ----
const activeTypeFilters = ref([])

const getSportType = (route) => {
  if (route.sport_type) return route.sport_type
  if (route.type === 1) return 'Ride'
  if (route.type === 2) return 'Run'
  return 'Ride'
}

// Types effectivement présents dans les parcours chargés
const availableTypes = computed(() => {
  const seen = [...new Set(routes.value.map(r => getSportType(r)))]
  return seen.map(type => ({
    type,
    label: getTypeLabel(type),
    icon: getTypeIcon(type)
  }))
})

const displayedRoutes = computed(() => {
  const filtered = activeTypeFilters.value.length === 0
    ? routes.value
    : routes.value.filter(r => activeTypeFilters.value.includes(getSportType(r)))

  return [...filtered].sort((a, b) => {
    let va, vb
    switch (sortField.value) {
      case 'updated':   va = new Date(a.updated_at || a.created_at); vb = new Date(b.updated_at || b.created_at); break
      case 'name':      va = (a.name || '').toLowerCase();           vb = (b.name || '').toLowerCase();           break
      case 'distance':  va = a.distance || 0;                        vb = b.distance || 0;                        break
      case 'elevation': va = a.elevation_gain || 0;                  vb = b.elevation_gain || 0;                  break
      default:          va = new Date(a.updated_at || a.created_at); vb = new Date(b.updated_at || b.created_at)
    }
    
    if (sortField.value === 'name') {
      return sortOrder.value === 'desc' ? (va > vb ? -1 : va < vb ? 1 : 0) : (va < vb ? -1 : va > vb ? 1 : 0)
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
const formatDuration = (s) => {
  if (!s) return '—'
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}min` : `${m}min`
}
const formatDate = (iso) => {
  if (!iso) return ''
  return new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
}
const getTypeLabel = (type) => {
  const labels = {
    Ride: 'Vélo de Route',
    GravelRide: 'Gravel',
    MountainBikeRide: 'VTT',
    EBikeRide: 'Velo Élec',
    Run: 'Course à pied',
    TrailRun: 'Trail',
    Walk: 'Marche',
    Hike: 'Randonnée'
  }
  return labels[type] || type
}
const getTypeIcon = (type) => {
  const icons = {
    Ride: 'mdi-road-variant',
    GravelRide: 'mdi-terrain',
    MountainBikeRide: 'mdi-pine-tree',
    EBikeRide: 'mdi-bicycle-electric',
    Run: 'mdi-run',
    TrailRun: 'mdi-image-filter-hdr',
    Walk: 'mdi-walk',
    Hike: 'mdi-image-filter-hdr'
  }
  return icons[type] || 'mdi-motion'
}

// ---- Overall stats ----
const overallStats = computed(() => {
  const totalKm = displayedRoutes.value.reduce((s, r) => s + (r.distance || 0), 0) / 1000
  const maxElev = displayedRoutes.value.reduce((max, r) => Math.max(max, r.elevation_gain || 0), 0)
  return { 
    count: displayedRoutes.value.length, 
    totalKm: totalKm.toFixed(0), 
    maxElev: Math.round(maxElev)
  }
})

// ---- API calls ----
const fetchStatus = async () => {
  try {
    const { data } = await axios.get(`${props.apiBaseUrl}/api/strava/status`)
    stravaStatus.value = data
  } catch (e) { console.error('Strava status error', e) }
}

const fetchRoutes = async () => {
  loading.value = true
  error.value = null
  try {
    const { data } = await axios.get(`${props.apiBaseUrl}/api/strava/routes`)
    routes.value = data
  } catch (e) {
    error.value = 'Impossible de charger les parcours Strava.'
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
    routes.value = []
    Object.keys(mapInstances).forEach(k => { try { mapInstances[k].remove() } catch {} ; delete mapInstances[k] })
  } catch (e) { error.value = 'Erreur lors de la déconnexion.' }
}

// ---- Map logic ----
const initMap = (routeId, encodedPolyline) => {
  const containerId = `strava-map-${routeId}`
  const container = document.getElementById(containerId)
  if (!container) return

  // Check if we have an existing map instance
  if (mapInstances[routeId]) {
    if (mapInstances[routeId]._container === container) {
      mapInstances[routeId].invalidateSize()
      return
    } else {
      try {
        mapInstances[routeId].remove()
      } catch (e) {
        console.error('Error removing stale map instance:', e)
      }
      delete mapInstances[routeId]
    }
  }

  if (container._leaflet_id) {
    container._leaflet_id = null
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

  // Default to topo layer
  topoLayer.addTo(map)

  const baseLayers = {
    "Standard": standardLayer,
    "Topographique (Dénivelés)": topoLayer,
    "Satellite": satelliteLayer
  }
  L.control.layers(baseLayers, null, { position: 'bottomleft' }).addTo(map)

  const points = decodePolyline(encodedPolyline)
  if (points.length) {
    L.polyline(points, { color: '#ffffff', weight: 8, opacity: 0.85 }).addTo(map)
    const poly = L.polyline(points, { color: '#FC4C02', weight: 4.5, opacity: 1.0 })
    poly.addTo(map)
    
    L.circleMarker(points[0], { radius: 6, fillColor: '#22c55e', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map)
    L.circleMarker(points[points.length - 1], { radius: 6, fillColor: '#ef4444', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(map)
    
    map.fitBounds(poly.getBounds(), { padding: [20, 20] })
  }
  mapInstances[routeId] = map
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

const exportToGPX = (route) => {
  const polyline = route.map?.summary_polyline
  if (!polyline) return

  const points = decodePolyline(polyline)
  if (points.length === 0) return

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="MeteoVelo" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${escapeXml(route.name)}</name>
    <desc>${escapeXml(route.description || '')}</desc>
  </metadata>
  <trk>
    <name>${escapeXml(route.name)}</name>
    <type>${getSportType(route)}</type>
    <trkseg>
`

  points.forEach(([lat, lng]) => {
    xml += `      <trkpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}"></trkpt>\n`
  })

  xml += `    </trkseg>
  </trk>
</gpx>`

  const blob = new Blob([xml], { type: 'application/gpx+xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const safeName = route.name.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase() || 'parcours'
  a.download = `${safeName}.gpx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const fullscreenRoute = ref(null)
let fullscreenMapInstance = null

const openFullscreenMap = async (route) => {
  if (fullscreenMapInstance) {
    try {
      fullscreenMapInstance.remove()
    } catch {}
    fullscreenMapInstance = null
  }

  fullscreenRoute.value = route
  await nextTick()

  const containerId = 'fullscreen-map'
  const container = document.getElementById(containerId)
  if (!container) return

  if (container._leaflet_id) {
    container._leaflet_id = null
  }

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

  topoLayer.addTo(fullscreenMapInstance)

  const baseLayers = {
    "Standard": standardLayer,
    "Topographique (Dénivelés)": topoLayer,
    "Satellite": satelliteLayer
  }
  L.control.layers(baseLayers, null, { position: 'bottomleft' }).addTo(fullscreenMapInstance)

  const points = decodePolyline(route.map?.summary_polyline)
  if (points.length) {
    L.polyline(points, { color: '#ffffff', weight: 9, opacity: 0.85 }).addTo(fullscreenMapInstance)
    const poly = L.polyline(points, { color: '#FC4C02', weight: 5.5, opacity: 1.0 })
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
  fullscreenRoute.value = null
}

const toggleRoute = async (route) => {
  if (expandedId.value === route.id) {
    expandedId.value = null
  } else {
    expandedId.value = route.id
    if (route.map?.summary_polyline) {
      await nextTick()
      initMap(route.id, route.map.summary_polyline)
    }
  }
}

onMounted(async () => {
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
    await fetchRoutes()
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
          <span class="mdi mdi-map-legend strava-hero-icon"></span>
        </div>
        <h2>Vos itinéraires de randonnée et vélo</h2>
        <p>Visualisez vos parcours créés sur Strava, affichez leurs tracés topographiques et exportez-les.</p>
        <button class="btn-strava-connect" @click="connectStrava" :disabled="loadingConnect">
          <span v-if="loadingConnect" class="mdi mdi-loading mdi-spin"></span>
          <span v-else class="mdi mdi-strava"></span>
          {{ loadingConnect ? 'Redirection…' : 'Se connecter avec Strava' }}
        </button>
        <p class="connect-note">Vos itinéraires privés et publics sont accessibles en toute sécurité.</p>
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
          <div class="athlete-sub">Mes parcours planifiés Strava</div>
        </div>
        <button class="btn-disconnect" @click="disconnectStrava" title="Délier Strava">
          <span class="mdi mdi-link-off"></span> Délier
        </button>
      </div>

      <!-- Chargement -->
      <div v-if="loading" class="strava-loading">
        <span class="mdi mdi-loading mdi-spin"></span> Chargement des parcours…
      </div>

      <!-- Erreur -->
      <div v-if="error" class="strava-error-msg">
        <span class="mdi mdi-alert-circle"></span> {{ error }}
      </div>

      <!-- Aucun parcours -->
      <div v-if="!loading && !error && routes.length === 0" class="strava-empty">
        <span class="mdi mdi-map-marker-off strava-empty-icon"></span>
        <p>Aucun itinéraire trouvé sur votre compte Strava.</p>
      </div>

      <!-- Filtres par type -->
      <div v-if="!loading && routes.length && availableTypes.length > 1" class="filter-controls">
        <span class="sort-label"><span class="mdi mdi-filter-variant"></span> Types (multi) :</span>
        <div class="sort-buttons">
          <button
            class="sort-btn"
            :class="{ active: activeTypeFilters.length === 0 }"
            @click="toggleTypeFilter('all')"
          >
            <span class="mdi mdi-map-legend"></span> Tous
            <span class="type-count">({{ routes.length }})</span>
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
            <span class="type-count">({{ routes.filter(r => getSportType(r) === t.type).length }})</span>
          </button>
        </div>
      </div>

      <!-- Contrôles de tri -->
      <div v-if="!loading && routes.length" class="sort-controls">
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

      <!-- Stats globales des parcours -->
      <div v-if="!loading && routes.length" class="monthly-stats">
        <div class="stat-tile">
          <span class="mdi mdi-map-legend stat-icon"></span>
          <div class="stat-val">{{ overallStats.count }}</div>
          <div class="stat-label">Itinéraires</div>
        </div>
        <div class="stat-tile">
          <span class="mdi mdi-map-marker-distance stat-icon"></span>
          <div class="stat-val">{{ overallStats.totalKm }} <small>km</small></div>
          <div class="stat-label">Distance cumulée</div>
        </div>
        <div class="stat-tile">
          <span class="mdi mdi-summit stat-icon"></span>
          <div class="stat-val">{{ overallStats.maxElev.toLocaleString() }} <small>m</small></div>
          <div class="stat-label">Dénivelé Max</div>
        </div>
      </div>

      <!-- Aucun résultat après filtrage -->
      <div v-if="!loading && routes.length && displayedRoutes.length === 0" class="strava-empty">
        <span class="mdi mdi-filter-off strava-empty-icon"></span>
        <p>Aucun itinéraire correspondant aux filtres.</p>
      </div>

      <!-- Liste des parcours -->
      <div class="activities-list">
        <div
          v-for="route in displayedRoutes"
          :key="route.id"
          class="strava-activity-card"
          :class="{ 'is-expanded': expandedId === route.id }"
        >
          <!-- En-tête de la carte (cliquable) -->
          <div class="activity-header" @click="toggleRoute(route)">
            <div class="activity-type-badge" :title="getTypeLabel(getSportType(route))">
              <span class="mdi" :class="getTypeIcon(getSportType(route))"></span>
            </div>
            <div class="activity-main">
              <div class="activity-name">{{ route.name }}</div>
              <div class="activity-date" style="font-size: 0.8rem; opacity: 0.7;">
                {{ route.description || 'Aucune description' }}
              </div>
            </div>
            <div class="activity-metrics">
              <span class="metric"><span class="mdi mdi-map-marker-distance"></span>{{ formatDistance(route.distance) }}</span>
              <span class="metric"><span class="mdi mdi-summit"></span>{{ formatElevation(route.elevation_gain) }}</span>
              <span class="metric"><span class="mdi mdi-timer-outline"></span>{{ formatDuration(route.estimated_moving_time) }}</span>
              <span class="metric" style="font-size: 0.8rem;"><span class="mdi mdi-calendar"></span>{{ formatDate(route.updated_at || route.created_at) }}</span>
            </div>
            <span class="activity-expand-icon mdi" :class="expandedId === route.id ? 'mdi-chevron-up' : 'mdi-chevron-down'"></span>
          </div>

          <!-- Carte Leaflet (collapsible) -->
          <div v-show="expandedId === route.id" class="activity-map-wrap">
            <div v-if="!route.map?.summary_polyline" class="map-unavailable">
              <span class="mdi mdi-map-marker-off"></span> Trace GPS non disponible pour cet itinéraire.
            </div>
            <div class="map-container-relative">
              <div :id="`strava-map-${route.id}`" class="activity-map"></div>
              <!-- Action Overlay: Voir sur Strava & Plein écran & Exporter GPX -->
              <div class="map-actions-overlay">
                <a :href="`https://www.strava.com/routes/${route.id}`" target="_blank" class="btn-map-action btn-strava-link" title="Voir sur Strava (nouvel onglet)">
                  <span class="mdi mdi-open-in-new"></span> Voir sur Strava
                </a>
                <button class="btn-map-action" @click.stop="openFullscreenMap(route)" title="Ouvrir la carte en plein écran">
                  <span class="mdi mdi-fullscreen"></span> Plein écran
                </button>
                <button class="btn-map-action" @click.stop="exportToGPX(route)" title="Exporter le parcours en GPX">
                  <span class="mdi mdi-download"></span> Exporter GPX
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

    </div>

    <!-- Modal de Carte Plein Écran -->
    <div v-if="fullscreenRoute" class="map-fullscreen-modal">
      <div class="fullscreen-header">
        <div class="fullscreen-title-group">
          <div class="fullscreen-type-badge">
            <span class="mdi" :class="getTypeIcon(getSportType(fullscreenRoute))"></span>
          </div>
          <div class="fullscreen-title-main">
            <h2>{{ fullscreenRoute.name }}</h2>
            <span class="fullscreen-date">{{ fullscreenRoute.description || 'Aucune description' }}</span>
          </div>
        </div>
        <div class="fullscreen-actions">
          <a :href="`https://www.strava.com/routes/${fullscreenRoute.id}`" target="_blank" class="btn-fullscreen-action btn-strava-link-full" title="Voir sur Strava (nouvel onglet)">
            <span class="mdi mdi-open-in-new"></span> Voir sur Strava
          </a>
          <button class="btn-fullscreen-action" @click="exportToGPX(fullscreenRoute)">
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

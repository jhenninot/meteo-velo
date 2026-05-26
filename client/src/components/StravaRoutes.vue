<script setup>
import { ref, onMounted, onUnmounted, computed, nextTick, watch } from 'vue'
import axios from 'axios'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

import WeatherChart from './WeatherChart.vue'

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
  apiBaseUrl: { type: String, default: 'http://localhost:3001' },
  initialCity: String,
  initialLat: [Number, String],
  initialLon: [Number, String],
  favorites: { type: Array, default: () => [] },
  userActivities: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:location'])

const stravaStatus = ref({ connected: false, athleteName: null, athleteProfile: null })
const routes = ref([])
const loading = ref(false)
const loadingConnect = ref(false)
const error = ref(null)
const expandedId = ref(null)

const query = ref(props.initialCity || '')
const suggestions = ref([])
const enableGeoFilter = ref(false)
const geoRadius = ref(20)

// Filtres métriques
const minDistance = ref(null)
const maxDistance = ref(null)
const minElevation = ref(null)
const maxElevation = ref(null)

watch(() => props.initialCity, (newCity) => {
  query.value = newCity || ''
})

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
  let filtered = activeTypeFilters.value.length === 0
    ? routes.value
    : routes.value.filter(r => activeTypeFilters.value.includes(getSportType(r)))

  if (enableGeoFilter.value && props.initialLat !== null && props.initialLon !== null) {
    filtered = filtered.filter(r => {
      const startPoint = getPolylineFirstPoint(r.map?.summary_polyline)
      if (!startPoint) return false
      const distance = getHaversineDistance(props.initialLat, props.initialLon, startPoint[0], startPoint[1])
      return distance <= geoRadius.value
    })
  }

  if (minDistance.value !== null && minDistance.value !== '') {
    filtered = filtered.filter(r => (r.distance / 1000) >= Number(minDistance.value))
  }
  if (maxDistance.value !== null && maxDistance.value !== '') {
    filtered = filtered.filter(r => (r.distance / 1000) <= Number(maxDistance.value))
  }
  if (minElevation.value !== null && minElevation.value !== '') {
    filtered = filtered.filter(r => r.elevation_gain >= Number(minElevation.value))
  }
  if (maxElevation.value !== null && maxElevation.value !== '') {
    filtered = filtered.filter(r => r.elevation_gain <= Number(maxElevation.value))
  }

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

// Fast decoder for only the first coordinate
function getPolylineFirstPoint(encoded) {
  if (!encoded) return null
  let index = 0, lat = 0, lng = 0
  if (index < encoded.length) {
    let b, shift = 0, result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += ((result & 1) ? ~(result >> 1) : (result >> 1))
    shift = 0; result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += ((result & 1) ? ~(result >> 1) : (result >> 1))
    return [lat / 1e5, lng / 1e5]
  }
  return null
}

// Haversine formula to calculate orthodromic distance in km
function getHaversineDistance(lat1, lon1, lat2, lon2) {
  if (lat1 === null || lon1 === null || lat2 === null || lon2 === null) return 0
  const R = 6371 // Earth radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const getRouteDistanceToSelected = (route) => {
  if (props.initialLat === null || props.initialLon === null) return null
  const startPoint = getPolylineFirstPoint(route.map?.summary_polyline)
  if (!startPoint) return null
  return getHaversineDistance(props.initialLat, props.initialLon, startPoint[0], startPoint[1])
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

const searchCities = async () => {
  if (query.value.length < 3) { suggestions.value = []; return; }
  try {
    const response = await axios.get(`${props.apiBaseUrl}/api/search?q=${query.value}`)
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
  const cityName = selectedFeature.properties.name
  const lonVal = selectedFeature.geometry.coordinates[0] 
  const latVal = selectedFeature.geometry.coordinates[1] 
  suggestions.value = [] 
  query.value = cityName
  
  emit('update:location', {
    city: cityName,
    lat: latVal,
    lon: lonVal
  })
}

const isSuggestionFavorite = (s) => {
  if (!s || !s.properties || !props.favorites) return false
  const name = s.properties.name
  const lonVal = s.geometry.coordinates[0]
  const latVal = s.geometry.coordinates[1]
  
  return props.favorites.some(fav => 
    fav.city.toLowerCase() === name.toLowerCase() || 
    (Math.abs(fav.lat - latVal) < 0.001 && Math.abs(fav.lon - lonVal) < 0.001)
  )
}

const selectedFavoriteIndex = computed({
  get() {
    if (!props.initialCity || !props.favorites) return "-1"
    const index = props.favorites.findIndex(fav => 
      fav.city.toLowerCase() === props.initialCity.toLowerCase() || 
      (props.initialLat !== null && props.initialLon !== null && Math.abs(fav.lat - props.initialLat) < 0.001 && Math.abs(fav.lon - props.initialLon) < 0.001)
    )
    return index !== -1 ? String(index) : "-1"
  },
  set(newIndex) {
    const idx = parseInt(newIndex, 10)
    if (isNaN(idx) || idx < 0 || idx >= props.favorites.length) return
    const fav = props.favorites[idx]
    
    emit('update:location', {
      city: fav.city,
      lat: fav.lat,
      lon: fav.lon
    })
  }
})

// ---- AI analysis state ----
const selectedRouteForAnalysis = ref(null)
const isAnalyzing = ref(false)
const analysisError = ref(null)
const analysisForecastData = ref(null)
const analysisFallbackWarning = ref(null)
const analysisSelectedActivity = ref(null)
const analysisStartCityName = ref('')
const analysisFullscreenOpen = ref(false)
const expandedPeriods = ref({})
let analysisMapInstance = null

// ---- Weather helpers for AI analysis display ----
const getWeatherIcon = (periodData) => {
  if (!periodData) return 'mdi-help-circle-outline';
  if (periodData.precip >= 2) return 'mdi-weather-pouring';
  if (periodData.precip > 0 || periodData.rain >= 50) return 'mdi-weather-rainy';
  if (periodData.wind > 35) return 'mdi-weather-windy';
  if (periodData.rain > 20) return 'mdi-weather-partly-cloudy';
  return 'mdi-weather-sunny';
}

const getShortDayName = (dateString) => {
  if (!dateString) return '';
  const [year, month, day] = dateString.split('-');
  const date = new Date(year, month - 1, day);
  const formatted = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' }).format(date);
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

const getDailyMinTemp = (day) => {
  const temps = [];
  if (day.matin?.temp !== undefined) temps.push(day.matin.temp);
  if (day.apres_midi?.temp !== undefined) temps.push(day.apres_midi.temp);
  if (temps.length === 0) return '-';
  return Math.min(...temps);
}

const getDailyMaxTemp = (day) => {
  const temps = [];
  if (day.matin?.temp !== undefined) temps.push(day.matin.temp);
  if (day.apres_midi?.temp !== undefined) temps.push(day.apres_midi.temp);
  if (temps.length === 0) return '-';
  return Math.max(...temps);
}

const getDailyWind = (day) => {
  const winds = [];
  if (day.matin?.wind !== undefined) winds.push(day.matin.wind);
  if (day.apres_midi?.wind !== undefined) winds.push(day.apres_midi.wind);
  if (winds.length === 0) return '-';
  return Math.max(...winds);
}

const getDailyGust = (day) => {
  const gusts = [];
  if (day.matin?.gust !== undefined) gusts.push(day.matin.gust);
  if (day.apres_midi?.gust !== undefined) gusts.push(day.apres_midi.gust);
  if (gusts.length === 0) return '-';
  return Math.max(...gusts);
}

const getDailyWindDir = (day) => {
  if (day.apres_midi?.dir !== undefined) return day.apres_midi.dir;
  if (day.matin?.dir !== undefined) return day.matin.dir;
  return 0;
}

const getDailyPrecip = (day) => {
  let precip = 0;
  if (day.matin?.precip) precip += day.matin.precip;
  if (day.apres_midi?.precip) precip += day.apres_midi.precip;
  return Number(precip.toFixed(1));
}

const getDailyRain = (day) => {
  const rains = [];
  if (day.matin?.rain !== undefined) rains.push(day.matin.rain);
  if (day.apres_midi?.rain !== undefined) rains.push(day.apres_midi.rain);
  if (rains.length === 0) return 0;
  return Math.max(...rains);
}

const getDailyWeatherIcon = (day) => {
  const mainPeriod = day.apres_midi || day.matin;
  return getWeatherIcon(mainPeriod);
}

const getWindStyle = (degrees) => ({ transform: `rotate(${degrees}deg)`, display: 'inline-block' })

const critereClass = (period, key) => {
  const v = period?.criteres?.[key]
  if (v === 'favorable') return 'metric-critere critere-fav'
  if (v === 'defavorable') return 'metric-critere critere-def'
  return 'metric-critere critere-neutre'
}

const togglePeriod = (dayIndex, periodName) => {
  const key = `${dayIndex}-${periodName}`
  expandedPeriods.value[key] = !expandedPeriods.value[key]
}

const scrollToDay = (index) => {
  const el = document.getElementById('analysis-day-detail-' + index);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

const findMatchingActivityId = (route) => {
  const sportType = getSportType(route) // e.g. 'Ride', 'GravelRide', etc.
  if (!props.userActivities || props.userActivities.length === 0) {
    return 'none'
  }

  // First try: match based on the explicitly configured Strava activity type mapping
  const matchedConfig = props.userActivities.find(act => act.stravaSportType === sportType)
  if (matchedConfig) return matchedConfig._id

  const normalizedSportType = sportType.toLowerCase()

  // Define keywords mapping to match user activities labels
  let keywords = []
  if (normalizedSportType.includes('ride') || normalizedSportType.includes('bike')) {
    if (normalizedSportType.includes('gravel')) {
      keywords = ['gravel', 'velo', 'vélo', 'bike']
    } else if (normalizedSportType.includes('mountain') || normalizedSportType.includes('mtb')) {
      keywords = ['vtt', 'mountain', 'gravel', 'velo', 'vélo', 'bike']
    } else {
      // standard Ride or EBike
      keywords = ['route', 'cyclisme', 'velo', 'vélo', 'bike']
    }
  } else if (normalizedSportType.includes('run') || normalizedSportType.includes('trail')) {
    keywords = ['course', 'pied', 'run', 'trail', 'jogging']
  } else if (normalizedSportType.includes('walk') || normalizedSportType.includes('hike')) {
    keywords = ['marche', 'rando', 'hike', 'walk', 'pied']
  }

  // Second try: exact or fuzzy keyword matches in order of preference
  for (const keyword of keywords) {
    const matched = props.userActivities.find(act => {
      const label = act.label.toLowerCase()
      return label.includes(keyword)
    })
    if (matched) return matched._id
  }

  // Third try: if no match, try to match any activity if there's only one
  if (props.userActivities.length === 1) {
    return props.userActivities[0]._id
  }

  return 'none'
}

const startAnalysisForRoute = async (route) => {
  if (!route) return

  const matchedActivityId = findMatchingActivityId(route)

  selectedRouteForAnalysis.value = route
  analysisFullscreenOpen.value = true
  isAnalyzing.value = true
  analysisError.value = null
  analysisForecastData.value = null
  expandedPeriods.value = {}

  if (matchedActivityId === 'none') {
    analysisSelectedActivity.value = { _id: 'none', label: 'Plein air général', icon: 'mdi-compass-outline' }
  } else {
    analysisSelectedActivity.value = props.userActivities.find(a => a._id === matchedActivityId) || { _id: 'none', label: 'Plein air général', icon: 'mdi-compass-outline' }
  }

  const startPoint = getPolylineFirstPoint(route.map?.summary_polyline)
  if (!startPoint) {
    analysisError.value = "Trace GPS non disponible ou invalide pour cet itinéraire."
    isAnalyzing.value = false
    return
  }

  const [lat, lon] = startPoint

  // Initialize map immediately in the fullscreen view
  await initAnalysisMap(route)

  // Fetch city name via reverse geocoding
  analysisStartCityName.value = 'Recherche du lieu...'
  try {
    const response = await axios.get(`${props.apiBaseUrl}/api/reverse?lat=${lat}&lon=${lon}`)
    const features = response.data
    if (features && features.length > 0) {
      const properties = features[0].properties
      analysisStartCityName.value = properties.city || properties.town || properties.village || properties.name || 'Point de départ'
    } else {
      analysisStartCityName.value = 'Point de départ'
    }
  } catch (err) {
    console.error("Reverse geocoding error:", err)
    analysisStartCityName.value = 'Point de départ'
  }

  // Fetch forecast analysis
  try {
    const response = await axios.post(`${props.apiBaseUrl}/api/forecast`, {
      city: analysisStartCityName.value,
      lat,
      lon,
      activityId: matchedActivityId
    })
    analysisForecastData.value = response.data.forecast
    analysisFallbackWarning.value = response.data.fallbackMessage || ''
  } catch (err) {
    console.error("Forecast analysis error:", err)
    analysisError.value = "Impossible de générer l'analyse météo par l'IA. Veuillez réessayer."
  } finally {
    isAnalyzing.value = false
  }
}

const initAnalysisMap = async (route) => {
  if (analysisMapInstance) {
    try {
      analysisMapInstance.remove()
    } catch {}
    analysisMapInstance = null
  }

  await nextTick()

  const containerId = 'analysis-fullscreen-map'
  const container = document.getElementById(containerId)
  if (!container) return

  if (container._leaflet_id) {
    container._leaflet_id = null
  }

  analysisMapInstance = L.map(containerId, { zoomControl: true, scrollWheelZoom: true })

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

  topoLayer.addTo(analysisMapInstance)

  const baseLayers = {
    "Standard": standardLayer,
    "Topographique (Dénivelés)": topoLayer,
    "Satellite": satelliteLayer
  }
  L.control.layers(baseLayers, null, { position: 'bottomleft' }).addTo(analysisMapInstance)

  const points = decodePolyline(route.map?.summary_polyline)
  if (points.length) {
    L.polyline(points, { color: '#ffffff', weight: 9, opacity: 0.85 }).addTo(analysisMapInstance)
    const poly = L.polyline(points, { color: '#FC4C02', weight: 5.5, opacity: 1.0 })
    poly.addTo(analysisMapInstance)

    L.circleMarker(points[0], { radius: 7, fillColor: '#22c55e', color: '#fff', weight: 2.5, fillOpacity: 1 }).addTo(analysisMapInstance)
    L.circleMarker(points[points.length - 1], { radius: 7, fillColor: '#ef4444', color: '#fff', weight: 2.5, fillOpacity: 1 }).addTo(analysisMapInstance)

    analysisMapInstance.fitBounds(poly.getBounds(), { padding: [50, 50] })
  }

  setTimeout(() => {
    if (analysisMapInstance) {
      analysisMapInstance.invalidateSize()
    }
  }, 250)
}

const closeAnalysisFullscreen = () => {
  if (analysisMapInstance) {
    try {
      analysisMapInstance.remove()
    } catch {}
    analysisMapInstance = null
  }
  analysisFullscreenOpen.value = false
  analysisForecastData.value = null
  analysisError.value = null
  selectedRouteForAnalysis.value = null
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
  if (analysisMapInstance) {
    try {
      analysisMapInstance.remove()
    } catch {}
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

      <!-- Panel de Filtres Avancés -->
      <div v-if="!loading && routes.length" class="search-container geo-filter-panel" style="margin-bottom: 24px;">
        <div class="geo-panel-title" style="margin-bottom: 20px;">
          <span class="mdi mdi-filter-cog-outline" style="font-size: 1.35rem;"></span>
          <h3 style="margin: 0; font-size: 1.1rem; font-weight: 700;">Filtres de recherche avancés</h3>
        </div>
        
        <h4 style="margin: 0 0 16px 0; font-size: 0.95rem; color: var(--color-strava); border-bottom: 1px solid var(--border-color); padding-bottom: 8px; display: flex; align-items: center; gap: 6px;">
          <span class="mdi mdi-map-marker-radius"></span> Proximité géographique
        </h4>
        
        <div class="geo-inputs-grid">
          <!-- Recherche de ville -->
          <div class="input-group" style="position: relative;">
            <label style="font-weight: 600; margin-bottom: 6px; display: block;"><span class="mdi mdi-map-marker" style="color: var(--color-strava);"></span> Localisation de référence :</label>
            <div class="search-input-wrapper">
              <input 
                v-model="query" 
                @input="searchCities" 
                placeholder="Rechercher une ville..."
                @keyup.enter="suggestions = []"
                style="width: 100%;"
              />
              <button 
                type="button" 
                v-if="query"
                @click="query = ''; suggestions = []" 
                class="geo-btn" 
                title="Effacer la recherche"
                style="padding: 10px 14px;"
              >
                <span class="mdi mdi-close"></span>
              </button>
            </div>
            
            <!-- Liste d'autocomplétion -->
            <ul v-if="suggestions.length > 0" class="suggestions-list" style="width: 100%; left: 0; margin-top: 5px; position: absolute; box-shadow: var(--shadow-lg); z-index: 1000;">
              <li v-for="(s, index) in suggestions" :key="index" @click="selectCity(s)" class="suggestion-item">
                <div class="suggestion-info">
                  <span v-if="isSuggestionFavorite(s)" class="mdi mdi-star suggestion-fav-star" title="Cette ville est dans vos favoris"></span>
                  <strong>{{ s.properties.name }}</strong>
                  <span class="region-text" v-if="s.properties.state">- {{ s.properties.state }}</span>
                </div>
              </li>
            </ul>
          </div>

          <!-- Favoris -->
          <div v-if="favorites && favorites.length > 0" class="input-group">
            <label for="favorites-select-routes" style="font-weight: 600; margin-bottom: 6px; display: block;"><span class="mdi mdi-star" style="color: #fbc02d;"></span> Vos favoris :</label>
            <div class="favorites-dropdown-container" style="margin: 0;">
              <select 
                id="favorites-select-routes" 
                v-model="selectedFavoriteIndex" 
                class="favorites-select"
                style="max-width: 100%; width: 100%;"
                aria-label="Sélectionner une ville favorite"
              >
                <option value="-1" disabled>Choisir un favori...</option>
                <option v-for="(fav, index) in favorites" :key="fav._id || fav.city" :value="index">
                  {{ fav.city }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- Curseur de rayon et activation du filtre -->
        <div class="geo-slider-controls">
          <div class="geo-toggle-wrapper">
            <label class="switch-container">
              <input type="checkbox" v-model="enableGeoFilter" />
              <span class="switch-slider"></span>
            </label>
            <span class="geo-toggle-label" @click="enableGeoFilter = !enableGeoFilter">
              Activer le filtrage par distance
            </span>
          </div>

          <div class="slider-wrapper" :class="{ 'is-disabled': !enableGeoFilter }">
            <span class="slider-min">2 km</span>
            <input 
              type="range" 
              v-model.number="geoRadius" 
              min="2" 
              max="100" 
              step="1"
              :disabled="!enableGeoFilter"
              class="range-slider"
            />
            <span class="slider-max">100 km ({{ geoRadius }} km)</span>
          </div>
        </div>
        
        <h4 style="margin: 28px 0 16px 0; font-size: 0.95rem; color: var(--color-strava); border-bottom: 1px solid var(--border-color); padding-bottom: 8px; display: flex; align-items: center; gap: 6px;">
          <span class="mdi mdi-tune"></span> Critères du parcours
        </h4>
        <div class="metrics-filter-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
          
          <!-- Filtre Distance -->
          <div class="filter-group">
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; display: block;">Distance (km)</label>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="number" v-model.number="minDistance" min="0" placeholder="Min" class="filter-number-input" />
              <span style="color: var(--text-muted);">à</span>
              <input type="number" v-model.number="maxDistance" min="0" placeholder="Max" class="filter-number-input" />
            </div>
          </div>

          <!-- Filtre Dénivelé -->
          <div class="filter-group">
            <label style="font-size: 0.85rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; display: block;">Dénivelé (m)</label>
            <div style="display: flex; align-items: center; gap: 8px;">
              <input type="number" v-model.number="minElevation" min="0" placeholder="Min" class="filter-number-input" />
              <span style="color: var(--text-muted);">à</span>
              <input type="number" v-model.number="maxElevation" min="0" placeholder="Max" class="filter-number-input" />
            </div>
          </div>

        </div>
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

      <!-- Fin du panneau des filtres avancés (intégré au-dessus) -->

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
              <div v-if="route.description" class="activity-date" style="font-size: 0.85rem; opacity: 0.8; margin: 4px 0 10px 0; line-height: 1.4; white-space: normal;">
                {{ route.description }}
              </div>
              <div class="activity-metrics" style="margin-top: 6px;">
                <span v-if="enableGeoFilter && getRouteDistanceToSelected(route) !== null" class="metric distance-to-ref" title="Distance à vol d'oiseau depuis la ville de référence">
                  <span class="mdi mdi-near-me"></span>
                  {{ getRouteDistanceToSelected(route).toFixed(1) }} km de {{ initialCity }}
                </span>
                <span class="metric"><span class="mdi mdi-map-marker-distance"></span>{{ formatDistance(route.distance) }}</span>
                <span class="metric"><span class="mdi mdi-summit"></span>{{ formatElevation(route.elevation_gain) }}</span>
                <span class="metric"><span class="mdi mdi-timer-outline"></span>{{ formatDuration(route.estimated_moving_time) }}</span>
                <span class="metric" style="font-size: 0.8rem;"><span class="mdi mdi-calendar"></span>{{ formatDate(route.updated_at || route.created_at) }}</span>
              </div>
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
                 <button class="btn-map-action btn-analyse" @click.stop="startAnalysisForRoute(route)" title="Analyser cet itinéraire par l'IA">
                  <span class="mdi mdi-brain"></span> Analyser
                </button>
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

    <!-- Modal d'Analyse Plein Écran -->
    <div v-if="analysisFullscreenOpen && selectedRouteForAnalysis" class="analysis-fullscreen-modal">
      <div class="fullscreen-header">
        <div class="fullscreen-title-group">
          <div class="fullscreen-type-badge">
            <span class="mdi mdi-brain"></span>
          </div>
          <div class="fullscreen-title-main">
            <h2>Analyse IA : {{ selectedRouteForAnalysis.name }}</h2>
            <span class="fullscreen-date">
              Départ : <strong>{{ analysisStartCityName }}</strong> | Activité : <strong>{{ analysisSelectedActivity?.label || 'Plein air général' }}</strong>
            </span>
          </div>
        </div>
        <div class="fullscreen-actions">
          <button class="btn-fullscreen-close" @click="closeAnalysisFullscreen">
            <span class="mdi mdi-close"></span> Fermer
          </button>
        </div>
      </div>
      
      <div class="analysis-content">
        <!-- Carte en haut -->
        <div class="analysis-map-pane">
          <div id="analysis-fullscreen-map" style="height: 100%; width: 100%;"></div>
        </div>
        
        <!-- Résultats sous la carte -->
        <div class="analysis-results-pane">
          <!-- Loading state -->
          <div v-if="isAnalyzing" class="analysis-loading-state">
            <span class="mdi mdi-brain mdi-spin loading-brain-icon"></span>
            <h3>Analyse météo intelligente en cours...</h3>
            <p>Nous interrogeons les données météo locales au point de départ de votre itinéraire et laissons l'IA évaluer vos conditions.</p>
          </div>
          
          <!-- Error state -->
          <div v-else-if="analysisError" class="analysis-error-state">
            <span class="mdi mdi-alert-circle error-icon"></span>
            <h3>Une erreur est survenue</h3>
            <p>{{ analysisError }}</p>
            <button class="btn-retry" @click="startAnalysisForRoute(selectedRouteForAnalysis)">
              <span class="mdi mdi-refresh"></span> Réessayer
            </button>
          </div>
          
          <!-- Success state / Forecast Data -->
          <div v-else-if="analysisForecastData" class="analysis-success-state">
            <div v-if="analysisFallbackWarning" class="fallback-msg" style="margin-bottom: 20px;">
              <span class="mdi mdi-alert"></span> {{ analysisFallbackWarning }}
            </div>

            <h3 class="analysis-section-title">
              <span class="mdi mdi-weather-partly-cloudy"></span> Prévisions et Analyse à 7 jours
            </h3>

            <!-- 7-day scroll summary -->
            <div class="daily-summary-container">
              <div class="daily-summary-scroll">
                <div v-for="(day, idx) in analysisForecastData" :key="'analysis-sum-'+idx" class="daily-summary-card" @click="scrollToDay(idx)">
                  <div class="summary-day">{{ getShortDayName(day.date) }}</div>
                  <div class="summary-icon"><span class="mdi" :class="getDailyWeatherIcon(day)"></span></div>
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

            <!-- Detailed Grid -->
            <section class="results-section" style="margin-top: 24px; padding: 0;">
              <div class="forecast-grid">
                <div v-for="(day, idx) in analysisForecastData" :key="'analysis-detail-'+idx" class="day-card" :id="'analysis-day-detail-' + idx">
                  <h3><span class="mdi mdi-calendar"></span> {{ formatDate(day.date) }}</h3>
                  <div class="day-split">
                    <!-- Morning -->
                    <div v-if="day.matin" class="half-day" :class="[day.matin.favorable ? 'favorable' : 'defavorable', { 'is-expanded': expandedPeriods[`${idx}-matin`] }]" @click="togglePeriod(idx, 'matin')">
                      <span
                        class="bike-day-indicator"
                        :class="day.matin.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'"
                        :title="day.matin.favorable ? 'Conditions favorables' : 'Conditions défavorables'"
                      >
                        <span class="mdi bike-day-indicator__icon" :class="analysisSelectedActivity?.icon || 'mdi-compass-outline'"></span>
                      </span>
                      <h4 class="half-day-heading">
                        <span class="mdi weather-main-icon" :class="getWeatherIcon(day.matin)"></span>
                        <span class="half-day-heading-label">Matin</span>
                      </h4>
                      <div class="metrics">
                        <span :class="critereClass(day.matin, 'temperature')"><span class="mdi mdi-thermometer"></span> {{ day.matin.temp }}°C</span>
                        <span :class="critereClass(day.matin, 'pluie')"><span class="mdi mdi-water-percent"></span> {{ day.matin.rain }}%</span>
                        <span :class="critereClass(day.matin, 'precipitations')"><span class="mdi mdi-weather-pouring"></span> {{ day.matin.precip }}mm</span>
                        <span :class="critereClass(day.matin, 'vent')"><span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.matin.dir)"></span> {{ day.matin.wind }}km/h</span>
                        <span :class="critereClass(day.matin, 'rafales')"><span class="mdi mdi-weather-windy" title="Rafales"></span> {{ day.matin.gust }}km/h</span>
                        <span :class="critereClass(day.matin, 'uv')"><span class="mdi mdi-sun-wireless"></span> UV {{ day.matin.uv }}</span>
                      </div>
                      <div class="ia-advice">{{ day.matin.conseil }}</div>
                      
                      <div v-if="expandedPeriods[`${idx}-matin`] && day.matin.hourly" @click.stop>
                        <WeatherChart :hourlyData="day.matin.hourly" :theme="theme" />
                      </div>
                    </div>

                    <!-- Afternoon -->
                    <div v-if="day.apres_midi" class="half-day" :class="[day.apres_midi.favorable ? 'favorable' : 'defavorable', { 'is-expanded': expandedPeriods[`${idx}-apres_midi`] }]" @click="togglePeriod(idx, 'apres_midi')">
                      <span
                        class="bike-day-indicator"
                        :class="day.apres_midi.favorable ? 'bike-day-favorable' : 'bike-day-defavorable'"
                        :title="day.apres_midi.favorable ? 'Conditions favorables' : 'Conditions défavorables'"
                      >
                        <span class="mdi bike-day-indicator__icon" :class="analysisSelectedActivity?.icon || 'mdi-compass-outline'"></span>
                      </span>
                      <h4 class="half-day-heading">
                        <span class="mdi weather-main-icon" :class="getWeatherIcon(day.apres_midi)"></span>
                        <span class="half-day-heading-label">Après-midi</span>
                      </h4>
                      <div class="metrics">
                        <span :class="critereClass(day.apres_midi, 'temperature')"><span class="mdi mdi-thermometer"></span> {{ day.apres_midi.temp }}°C</span>
                        <span :class="critereClass(day.apres_midi, 'pluie')"><span class="mdi mdi-water-percent"></span> {{ day.apres_midi.rain }}%</span>
                        <span :class="critereClass(day.apres_midi, 'precipitations')"><span class="mdi mdi-weather-pouring"></span> {{ day.apres_midi.precip }}mm</span>
                        <span :class="critereClass(day.apres_midi, 'vent')"><span class="mdi mdi-navigation wind-icon" :style="getWindStyle(day.apres_midi.dir)"></span> {{ day.apres_midi.wind }}km/h</span>
                        <span :class="critereClass(day.apres_midi, 'rafales')"><span class="mdi mdi-weather-windy" title="Rafales"></span> {{ day.apres_midi.gust }}km/h</span>
                        <span :class="critereClass(day.apres_midi, 'uv')"><span class="mdi mdi-sun-wireless"></span> UV {{ day.apres_midi.uv }}</span>
                      </div>
                      <div class="ia-advice">{{ day.apres_midi.conseil }}</div>
                      
                      <div v-if="expandedPeriods[`${idx}-apres_midi`] && day.apres_midi.hourly" @click.stop>
                        <WeatherChart :hourlyData="day.apres_midi.hourly" :theme="theme" />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

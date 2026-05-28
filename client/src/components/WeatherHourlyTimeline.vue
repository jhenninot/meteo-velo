<template>
  <div class="weather-hourly-timeline" :class="{ 'theme-dark': theme === 'dark' }">
    <!-- Row 1: Time labels -->
    <div class="timeline-hours">
      <div v-for="(h, i) in hourlyData" :key="'hour-'+i" class="timeline-hour-cell">
        {{ formatHour(h.hour) }}
      </div>
    </div>

    <!-- Row 2: Chart Area (SVG) -->
    <div class="timeline-chart-wrapper">
      <svg :width="totalWidth" :height="chartHeight" class="timeline-svg">
        <!-- Vertical Grid Lines separating hours -->
        <line
          v-for="i in (hourlyData.length + 1)"
          :key="'grid-'+i"
          :x1="(i - 1) * columnWidth"
          y1="0"
          :x2="(i - 1) * columnWidth"
          :y2="chartHeight"
          class="grid-line"
        />

        <!-- Bottom baseline -->
        <line
          x1="0"
          :y1="chartHeight - 0.5"
          :x2="totalWidth"
          :y2="chartHeight - 0.5"
          class="grid-line-bottom"
        />

        <!-- Precipitation Bars -->
        <g v-for="(h, i) in hourlyData" :key="'bar-'+i">
          <rect
            v-if="h.precip > 0"
            :x="getColumnCenterX(i) - barWidth / 2"
            :y="chartHeight - getBarHeight(h.precip)"
            :width="barWidth"
            :height="getBarHeight(h.precip)"
            class="precip-bar"
            rx="1"
          />
        </g>

        <!-- Temperature Path (Smooth curve) -->
        <path :d="tempPath" fill="none" class="temp-line" />

        <!-- Temperature Points & Labels -->
        <g v-for="(h, i) in hourlyData" :key="'temp-pt-'+i">
          <circle
            :cx="getColumnCenterX(i)"
            :cy="getTempY(h.temp)"
            r="4.5"
            class="temp-point"
          />
          <text
            :x="getColumnCenterX(i)"
            :y="getTempY(h.temp) - 10"
            class="temp-label"
          >
            {{ h.temp }}°
          </text>
        </g>

        <!-- Precipitation Badges (Sitting on top of the bars) -->
        <g v-for="(h, i) in hourlyData" :key="'badge-'+i">
          <g v-if="h.precip > 0" class="precip-badge">
            <rect
              :x="getColumnCenterX(i) - 23"
              :y="chartHeight - getBarHeight(h.precip) - 28"
              width="46"
              height="24"
              rx="3"
            />
            <text
              :x="getColumnCenterX(i)"
              :y="chartHeight - getBarHeight(h.precip) - 17"
              class="precip-val"
            >
              {{ h.precip }} mm
            </text>
            <text
              :x="getColumnCenterX(i)"
              :y="chartHeight - getBarHeight(h.precip) - 6"
              class="precip-prob"
            >
              {{ h.rain }}%
            </text>
          </g>
        </g>
      </svg>
    </div>

    <!-- Row 3: Weather Icons -->
    <div class="timeline-icons">
      <div v-for="(h, i) in hourlyData" :key="'icon-'+i" class="timeline-icon-cell">
        <WeatherIcon :icon="getWeatherIcon(h, isNightHour(date, h.hour))" class="timeline-weather-icon" />
      </div>
    </div>

    <!-- Row 4: Wind Speed & Direction -->
    <div class="timeline-winds">
      <div v-for="(h, i) in hourlyData" :key="'wind-'+i" class="timeline-wind-cell">
        <span class="wind-arrow">{{ getWindArrow(h.dir) }}</span>
        <span class="wind-speed">{{ h.wind }} <span class="wind-unit">km/h</span></span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import WeatherIcon from './WeatherIcon.vue'

const props = defineProps({
  hourlyData: {
    type: Array,
    required: true
  },
  date: {
    type: String,
    required: true
  },
  theme: {
    type: String,
    default: 'light'
  }
})

// Dimensions
const columnWidth = 70
const chartHeight = 150
const barWidth = 34

const totalWidth = computed(() => props.hourlyData.length * columnWidth)

const getColumnCenterX = (index) => (index + 0.5) * columnWidth

// Hour formatting
const formatHour = (h) => `${String(h).padStart(2, '0')}:00`

// Temperature calculation
const minTemp = computed(() => {
  if (props.hourlyData.length === 0) return 0
  return Math.min(...props.hourlyData.map(h => h.temp))
})

const maxTemp = computed(() => {
  if (props.hourlyData.length === 0) return 0
  return Math.max(...props.hourlyData.map(h => h.temp))
})

const getTempY = (temp) => {
  const min = minTemp.value
  const max = maxTemp.value
  const range = max - min || 4
  const yMin = 28
  const yMax = 95
  const ratio = (temp - min) / range
  return yMax - ratio * (yMax - yMin)
}

// Points for the spline line
const points = computed(() => {
  return props.hourlyData.map((h, i) => [
    getColumnCenterX(i),
    getTempY(h.temp)
  ])
})

// Generate SVG smooth path using cubic bezier curve (spline)
const tempPath = computed(() => {
  const pts = points.value
  if (pts.length === 0) return ''
  return pts.reduce((acc, point, i, a) => {
    if (i === 0) return `M ${point[0]} ${point[1]}`
    
    const p0 = a[i - 2] || a[i - 1]
    const p1 = a[i - 1]
    const p2 = point
    const p3 = a[i + 1] || point
    
    // Smooth control points
    const cp1x = p1[0] + (p2[0] - p0[0]) / 6
    const cp1y = p1[1] + (p2[1] - p0[1]) / 6
    
    const cp2x = p2[0] - (p3[0] - p1[0]) / 6
    const cp2y = p2[1] - (p3[1] - p1[1]) / 6
    
    return `${acc} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`
  }, '')
})

// Precipitation bar heights mapping
const maxPrecip = computed(() => {
  if (props.hourlyData.length === 0) return 0
  return Math.max(...props.hourlyData.map(h => h.precip || 0))
})

const getBarHeight = (precip) => {
  if (!precip || precip <= 0) return 0
  const maxScale = Math.max(maxPrecip.value, 2.0)
  return (precip / maxScale) * 45 // max height 45px
}

// Wind arrow unicode mapping
const getWindArrow = (deg) => {
  if (deg === undefined || deg === null) return '↑'
  const index = Math.round((deg % 360) / 45) % 8
  const arrows = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖']
  return arrows[index]
}

// Night check helper
const isNightHour = (dateString, hour) => {
  if (!dateString) return hour < 6 || hour >= 22
  const month = new Date(dateString).getMonth()
  
  let sunrise = 7
  let sunset = 19
  
  if (month >= 4 && month <= 7) {
    sunrise = 6
    sunset = 22
  } else if (month === 3 || month === 8) {
    sunrise = 7
    sunset = 21
  } else if (month === 2 || month === 9) {
    sunrise = 7
    sunset = 20
  } else {
    sunrise = 8
    sunset = 18
  }
  
  return hour < sunrise || hour >= sunset
}

// Weather icon helper
const getWeatherIcon = (periodData, isNight = false) => {
  if (!periodData) return 'mdi-help-circle-outline'
  if (periodData.precip >= 2) return 'mdi-weather-pouring'
  if (periodData.precip > 0 || periodData.rain >= 50) return 'mdi-weather-rainy'
  if (periodData.wind > 35) return 'mdi-weather-windy'
  if (periodData.rain > 20) {
    return isNight ? 'mdi-weather-night-partly-cloudy' : 'mdi-weather-partly-cloudy'
  }
  return isNight ? 'mdi-weather-night' : 'mdi-weather-sunny'
}
</script>

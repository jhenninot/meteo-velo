<template>
  <span class="weather-icon-wrapper" :class="[iconClass]" :title="title">
    <!-- Sunny / Day Clear -->
    <svg v-if="condition === 'sunny'" viewBox="0 0 64 64" class="weather-svg">
      <defs>
        <linearGradient id="sun-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffb74d" />
          <stop offset="100%" stop-color="#f57c00" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="16" fill="url(#sun-grad)" class="sun-center" />
      <path d="M32,14 L32,8 M32,50 L32,56 M14,32 L8,32 M50,32 L56,32 M19.3,19.3 L15,15 M44.7,44.7 L49,49 M19.3,44.7 L15,49 M44.7,19.3 L49,15" stroke="url(#sun-grad)" stroke-width="3" stroke-linecap="round" class="sun-rays" />
    </svg>

    <!-- Clear Night -->
    <svg v-else-if="condition === 'night'" viewBox="0 0 64 64" class="weather-svg">
      <defs>
        <linearGradient id="moon-grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffe082" />
          <stop offset="100%" stop-color="#ffb300" />
        </linearGradient>
      </defs>
      <path d="M42,36 C30.5,36 21,26.5 21,15 C21,12.5 21.5,10 22.3,7.7 C14,9.8 8,17.2 8,26 C8,37.6 17.4,47 29,47 C37.8,47 45.2,41 47.3,32.7 C45,33.5 42.5,36 42,36 Z" fill="url(#moon-grad)" class="moon" />
      <g class="stars">
        <circle cx="48" cy="12" r="1.2" fill="#fff" class="star star-1" />
        <circle cx="16" cy="42" r="0.8" fill="#fff" class="star star-2" />
        <circle cx="45" cy="22" r="1" fill="#fff" class="star star-3" />
      </g>
    </svg>

    <!-- Partly Cloudy Day -->
    <svg v-else-if="condition === 'partly-cloudy'" viewBox="0 0 64 64" class="weather-svg">
      <defs>
        <linearGradient id="sun-grad-pc" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffb74d" />
          <stop offset="100%" stop-color="#f57c00" />
        </linearGradient>
        <linearGradient id="cloud-grad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#ffffff" />
          <stop offset="100%" stop-color="#cfd8dc" />
        </linearGradient>
      </defs>
      <g class="sun-back">
        <circle cx="26" cy="26" r="11" fill="url(#sun-grad-pc)" />
        <path d="M26,13 L26,8 M26,39 L26,44 M13,26 L8,26 M39,26 L44,26 M16.8,16.8 L13.3,13.3 M35.2,35.2 L38.7,38.7 M16.8,35.2 L13.3,38.7 M35.2,16.8 L38.7,13.3" stroke="url(#sun-grad-pc)" stroke-width="2" stroke-linecap="round" />
      </g>
      <path d="M46.5,33 C46.5,28.6 42.9,25 38.5,25 C37.8,25 37.1,25.1 36.5,25.3 C34.8,21.5 31,19 26.5,19 C20.7,19 16,23.7 16,29.5 C16,29.8 16,30.1 16,30.4 C12.6,31.2 10,34.3 10,38 C10,42.4 13.6,46 18,46 L45,46 C49.4,46 53,42.4 53,38 C53,34.1 50.1,30.9 46.5,33 Z" fill="url(#cloud-grad)" class="cloud-front" />
    </svg>

    <!-- Partly Cloudy Night -->
    <svg v-else-if="condition === 'partly-cloudy-night'" viewBox="0 0 64 64" class="weather-svg">
      <defs>
        <linearGradient id="moon-grad-pc" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ffe082" />
          <stop offset="100%" stop-color="#ffb300" />
        </linearGradient>
        <linearGradient id="cloud-grad-night" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#e2e8f0" />
          <stop offset="100%" stop-color="#94a3b8" />
        </linearGradient>
      </defs>
      <path d="M34,25.5 C25.3,25.5 18.2,18.4 18.2,9.7 C18.2,7.7 18.6,5.9 19.3,4.1 C13,5.8 8.4,11.5 8.4,18.2 C8.4,26.9 15.5,34 24.2,34 C30.9,34 36.6,29.4 38.3,23.1 C36.5,23.8 34.7,25.5 34,25.5 Z" fill="url(#moon-grad-pc)" class="moon-back" />
      <path d="M46.5,35 C46.5,30.6 42.9,27 38.5,27 C37.8,27 37.1,27.1 36.5,27.3 C34.8,23.5 31,21 26.5,21 C20.7,21 16,25.7 16,31.5 C16,31.8 16,32.1 16,32.4 C12.6,33.2 10,36.3 10,40 C10,44.4 13.6,48 18,48 L45,48 C49.4,48 53,44.4 53,40 C53,36.1 50.1,32.9 46.5,35 Z" fill="url(#cloud-grad-night)" class="cloud-front" />
    </svg>

    <!-- Rainy -->
    <svg v-else-if="condition === 'rainy'" viewBox="0 0 64 64" class="weather-svg">
      <defs>
        <linearGradient id="cloud-grad-rain" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#b0bec5" />
          <stop offset="100%" stop-color="#607d8b" />
        </linearGradient>
      </defs>
      <path d="M46.5,30 C46.5,25.6 42.9,22 38.5,22 C37.8,22 37.1,22.1 36.5,22.3 C34.8,18.5 31,16 26.5,16 C20.7,16 16,20.7 16,26.5 C16,26.8 16,27.1 16,27.4 C12.6,28.2 10,31.3 10,35 C10,39.4 13.6,43 18,43 L45,43 C49.4,43 53,39.4 53,35 C53,31.1 50.1,27.9 46.5,30 Z" fill="url(#cloud-grad-rain)" class="cloud-rain" />
      <g class="rain-drops" stroke="#42a5f5" stroke-width="2.5" stroke-linecap="round">
        <line x1="22" y1="46" x2="20" y2="52" class="drop drop-1" />
        <line x1="32" y1="46" x2="30" y2="52" class="drop drop-2" />
        <line x1="42" y1="46" x2="40" y2="52" class="drop drop-3" />
      </g>
    </svg>

    <!-- Pouring (Heavy Rain) -->
    <svg v-else-if="condition === 'pouring'" viewBox="0 0 64 64" class="weather-svg">
      <defs>
        <linearGradient id="cloud-grad-pouring" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#78909c" />
          <stop offset="100%" stop-color="#37474f" />
        </linearGradient>
      </defs>
      <path d="M46.5,30 C46.5,25.6 42.9,22 38.5,22 C37.8,22 37.1,22.1 36.5,22.3 C34.8,18.5 31,16 26.5,16 C20.7,16 16,20.7 16,26.5 C16,26.8 16,27.1 16,27.4 C12.6,28.2 10,31.3 10,35 C10,39.4 13.6,43 18,43 L45,43 C49.4,43 53,39.4 53,35 C53,31.1 50.1,27.9 46.5,30 Z" fill="url(#cloud-grad-pouring)" class="cloud-rain" />
      <g class="rain-drops pouring" stroke="#1976d2" stroke-width="3" stroke-linecap="round">
        <line x1="18" y1="46" x2="15" y2="54" class="drop pdrop-1" />
        <line x1="27" y1="46" x2="24" y2="54" class="drop pdrop-2" />
        <line x1="36" y1="46" x2="33" y2="54" class="drop pdrop-3" />
        <line x1="45" y1="46" x2="42" y2="54" class="drop pdrop-4" />
      </g>
    </svg>

    <!-- Windy -->
    <svg v-else-if="condition === 'windy'" viewBox="0 0 64 64" class="weather-svg">
      <g stroke="#78909c" stroke-width="3.5" stroke-linecap="round" fill="none" class="wind-lines">
        <path d="M12,22 L38,22 C42,22 44,24 44,26 C44,28 42,30 38,30 L34,30" class="wind-line line-1" />
        <path d="M8,32 L48,32 C52,32 54,30 54,28 C54,26 52,24 48,24 L44,24" class="wind-line line-2" />
        <path d="M16,42 L34,42 C38,42 40,44 40,46 C40,48 38,50 34,50 L30,50" class="wind-line line-3" />
      </g>
    </svg>

    <!-- Unknown / Help -->
    <svg v-else viewBox="0 0 64 64" class="weather-svg">
      <defs>
        <linearGradient id="cloud-grad-help" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#eceff1" />
          <stop offset="100%" stop-color="#b0bec5" />
        </linearGradient>
      </defs>
      <path d="M46.5,33 C46.5,28.6 42.9,25 38.5,25 C37.8,25 37.1,25.1 36.5,25.3 C34.8,21.5 31,19 26.5,19 C20.7,19 16,23.7 16,29.5 C16,29.8 16,30.1 16,30.4 C12.6,31.2 10,34.3 10,38 C10,42.4 13.6,46 18,46 L45,46 C49.4,46 53,42.4 53,38 C53,34.1 50.1,30.9 46.5,33 Z" fill="url(#cloud-grad-help)" class="cloud-unknown" />
      <text x="32" y="38" font-family="Arial, sans-serif" font-size="18" font-weight="bold" fill="#4caf50" text-anchor="middle" class="question-mark">?</text>
    </svg>
  </span>
</template>

<script setup>
import { computed } from 'vue'

const props = defineProps({
  icon: {
    type: String,
    required: true
  },
  title: {
    type: String,
    default: ''
  }
})

// Normaliser l'icône reçue (ex: 'mdi-weather-sunny') vers un identifiant simple de condition
const condition = computed(() => {
  if (!props.icon) return 'unknown'
  const name = props.icon.toLowerCase()
  if (name.includes('sunny')) return 'sunny'
  if (name.includes('night') && name.includes('cloudy')) return 'partly-cloudy-night'
  if (name.includes('night')) return 'night'
  if (name.includes('partly-cloudy') || name.includes('cloudy')) return 'partly-cloudy'
  if (name.includes('pouring')) return 'pouring'
  if (name.includes('rainy') || name.includes('rain')) return 'rainy'
  if (name.includes('windy') || name.includes('wind')) return 'windy'
  return 'unknown'
})

// Déduire une classe d'icône supplémentaire pour du style global si besoin
const iconClass = computed(() => `weather-${condition.value}`)
</script>

<style scoped>
.weather-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1em;
  height: 1em;
  vertical-align: middle;
  line-height: 1;
}

.weather-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
}

/* --- ANIMATIONS CSS --- */

.sun-rays {
  transform-origin: 32px 32px;
}
.sun-back {
  transform-origin: 26px 26px;
}
.sun-center {
  animation: pulse-subtle 4s ease-in-out infinite alternate;
  transform-origin: 32px 32px;
}

@keyframes spin-slow {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}

@keyframes pulse-subtle {
  0% { transform: scale(1); }
  100% { transform: scale(1.06); }
}

/* 2. Oscillation douce de la lune et étoiles scintillantes */
.moon {
  transform-origin: 30px 28px;
  animation: float-gentle 6s ease-in-out infinite alternate;
}
.moon-back {
  transform-origin: 24px 20px;
  animation: float-gentle 8s ease-in-out infinite alternate;
}
.star {
  animation: flash 3s infinite alternate;
}
.star-1 { animation-delay: 0s; }
.star-2 { animation-delay: 1s; }
.star-3 { animation-delay: 1.8s; }

@keyframes float-gentle {
  0% { transform: translateY(0) rotate(-1deg); }
  100% { transform: translateY(-1.5px) rotate(1.5deg); }
}

@keyframes flash {
  0%, 20% { opacity: 0.2; transform: scale(0.8); }
  80%, 100% { opacity: 1; transform: scale(1.2); }
}

/* 3. Flottement des nuages */
.cloud-front {
  transform-origin: 30px 32px;
  animation: float-cloud 5s ease-in-out infinite alternate;
}

@keyframes float-cloud {
  0% { transform: translateX(-1px) translateY(0); }
  100% { transform: translateX(1px) translateY(-1px); }
}

/* 4. Pluie animée (Gouttes d'eau qui tombent) */
.cloud-rain {
  animation: float-cloud 6s ease-in-out infinite alternate;
}
.rain-drops .drop {
  animation: drop-fall 1.5s linear infinite;
  opacity: 0;
}
.rain-drops .drop-1 { animation-delay: 0s; }
.rain-drops .drop-2 { animation-delay: 0.5s; }
.rain-drops .drop-3 { animation-delay: 1s; }

/* Pluie forte */
.rain-drops.pouring .drop {
  animation: drop-fall 0.8s linear infinite;
  opacity: 0;
}
.rain-drops.pouring .pdrop-1 { animation-delay: 0s; }
.rain-drops.pouring .pdrop-2 { animation-delay: 0.2s; }
.rain-drops.pouring .pdrop-3 { animation-delay: 0.4s; }
.rain-drops.pouring .pdrop-4 { animation-delay: 0.6s; }

@keyframes drop-fall {
  0% {
    transform: translate(2px, -8px);
    opacity: 0;
  }
  30% {
    opacity: 1;
  }
  80% {
    opacity: 0.8;
  }
  100% {
    transform: translate(-3px, 12px);
    opacity: 0;
  }
}

/* 5. Vent dynamique */
.wind-lines .wind-line {
  stroke-dasharray: 40;
  stroke-dashoffset: 40;
  animation: wind-blow 3s ease-in-out infinite;
}
.wind-lines .line-1 { animation-delay: 0s; }
.wind-lines .line-2 { animation-delay: 0.8s; }
.wind-lines .line-3 { animation-delay: 1.6s; }

@keyframes wind-blow {
  0% {
    stroke-dashoffset: 40;
    opacity: 0;
  }
  20% {
    opacity: 1;
  }
  80% {
    opacity: 1;
  }
  100% {
    stroke-dashoffset: -40;
    opacity: 0;
  }
}

/* 6. Nuage inconnu (Help) */
.cloud-unknown {
  animation: float-cloud 7s ease-in-out infinite alternate;
}
.question-mark {
  animation: pulse-subtle 2s ease-in-out infinite alternate;
  transform-origin: 32px 34px;
}
</style>

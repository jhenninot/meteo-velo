<template>
  <form @submit.prevent="handleSubmit" class="activity-form-content">
    <div class="input-group">
      <label>Libellé :</label>
      <input v-model="form.label" type="text" maxlength="80" placeholder="Ex: Vélo route, Gravel, Course à pied..." required />
    </div>
    
    <div class="input-group">
      <label>Icône MDI :</label>
      <div class="activity-icon-input-container">
        <div class="activity-icon-input">
          <span class="mdi activity-icon-preview" :class="form.icon || 'mdi-bike'"></span>
          <input
            v-model="form.icon"
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
      <textarea v-model="form.constraints" maxlength="4000" placeholder="Ex: Pas de vent supérieur à 20 km/h, pas de pluie, température minimale..."></textarea>
    </div>

    <!-- Limites météo numériques strictes -->
    <div class="weather-limits-section">
      <h5 class="weather-limits-title">Limites météo strictes (facultatif)</h5>
      <div class="weather-limits-grid">
        
        <div class="weather-limit-row">
          <div class="limit-label-group">
            <span class="mdi mdi-thermometer limit-icon"></span>
            <span class="limit-label-text">Température (°C)</span>
          </div>
          <div class="limit-inputs">
            <input type="number" step="any" v-model.number="form.tempMin" placeholder="Min" class="limit-input" />
            <span class="limit-separator">à</span>
            <input type="number" step="any" v-model.number="form.tempMax" placeholder="Max" class="limit-input" />
          </div>
        </div>

        <div class="weather-limit-row">
          <div class="limit-label-group">
            <span class="mdi mdi-navigation wind-icon-static limit-icon"></span>
            <span class="limit-label-text">Vent (km/h)</span>
          </div>
          <div class="limit-inputs">
            <input type="number" step="any" v-model.number="form.windMin" placeholder="Min" class="limit-input" />
            <span class="limit-separator">à</span>
            <input type="number" step="any" v-model.number="form.windMax" placeholder="Max" class="limit-input" />
          </div>
        </div>

        <div class="weather-limit-row">
          <div class="limit-label-group">
            <span class="mdi mdi-weather-windy limit-icon"></span>
            <span class="limit-label-text">Rafales (km/h)</span>
          </div>
          <div class="limit-inputs">
            <input type="number" step="any" v-model.number="form.gustMin" placeholder="Min" class="limit-input" />
            <span class="limit-separator">à</span>
            <input type="number" step="any" v-model.number="form.gustMax" placeholder="Max" class="limit-input" />
          </div>
        </div>

        <div class="weather-limit-row">
          <div class="limit-label-group">
            <span class="mdi mdi-weather-pouring limit-icon"></span>
            <span class="limit-label-text">Précipitations (mm)</span>
          </div>
          <div class="limit-inputs">
            <input type="number" step="any" v-model.number="form.precipMin" placeholder="Min" class="limit-input" />
            <span class="limit-separator">à</span>
            <input type="number" step="any" v-model.number="form.precipMax" placeholder="Max" class="limit-input" />
          </div>
        </div>

        <div class="weather-limit-row">
          <div class="limit-label-group">
            <span class="mdi mdi-sun-wireless limit-icon"></span>
            <span class="limit-label-text">Indice UV</span>
          </div>
          <div class="limit-inputs">
            <input type="number" step="any" v-model.number="form.uvMin" placeholder="Min" class="limit-input" />
            <span class="limit-separator">à</span>
            <input type="number" step="any" v-model.number="form.uvMax" placeholder="Max" class="limit-input" />
          </div>
        </div>

      </div>
    </div>

    <!-- Personnalisation des plages horaires -->
    <div class="weather-limits-section" style="margin-top: 20px;">
      <h5 class="weather-limits-title">Créneaux horaires d'analyse</h5>
      <div class="weather-limits-grid">
        
        <div class="weather-limit-row">
          <div class="limit-label-group">
            <span class="mdi mdi-clock-outline limit-icon"></span>
            <input type="text" v-model="form.slot1Name" placeholder="Nom créneau 1" class="slot-name-input" required maxlength="30" />
          </div>
          <div class="limit-inputs">
            <input type="number" min="0" max="23" v-model.number="form.slot1Start" placeholder="Début" class="limit-input" required />
            <span class="limit-separator">h à</span>
            <input type="number" min="0" max="23" v-model.number="form.slot1End" placeholder="Fin" class="limit-input" required />
            <span class="limit-separator">h</span>
          </div>
        </div>

        <div class="weather-limit-row">
          <div class="limit-label-group">
            <span class="mdi mdi-clock-outline limit-icon"></span>
            <input type="text" v-model="form.slot2Name" placeholder="Nom créneau 2" class="slot-name-input" required maxlength="30" />
          </div>
          <div class="limit-inputs">
            <input type="number" min="0" max="23" v-model.number="form.slot2Start" placeholder="Début" class="limit-input" required />
            <span class="limit-separator">h à</span>
            <input type="number" min="0" max="23" v-model.number="form.slot2End" placeholder="Fin" class="limit-input" required />
            <span class="limit-separator">h</span>
          </div>
        </div>

      </div>
    </div>

    <div class="activity-form-actions">
      <button type="submit" class="login-btn" :disabled="loading">
        {{ loading ? 'Enregistrement...' : (isEdit ? 'Modifier l’activité' : 'Ajouter l’activité') }}
      </button>
      <button type="button" class="secondary-btn" @click="handleCancel" :disabled="loading">
        Annuler
      </button>
    </div>
  </form>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { MDI_ICONS } from '../utils/mdi-icons.js'

const props = defineProps({
  initialData: {
    type: Object,
    default: () => null
  },
  loading: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['submit', 'cancel'])

const isEdit = computed(() => !!(props.initialData && (props.initialData._id || props.initialData.id)))

const getInitialForm = () => {
  if (props.initialData) {
    return {
      id: props.initialData._id || props.initialData.id || null,
      label: props.initialData.label || '',
      icon: props.initialData.icon || 'mdi-bike',
      constraints: props.initialData.constraints || '',

      windMin: props.initialData.windMin ?? null,
      windMax: props.initialData.windMax ?? null,
      gustMin: props.initialData.gustMin ?? null,
      gustMax: props.initialData.gustMax ?? null,
      tempMin: props.initialData.tempMin ?? null,
      tempMax: props.initialData.tempMax ?? null,
      precipMin: props.initialData.precipMin ?? null,
      precipMax: props.initialData.precipMax ?? null,
      uvMin: props.initialData.uvMin ?? null,
      uvMax: props.initialData.uvMax ?? null,
      slot1Name: props.initialData.slot1Name || 'Matin',
      slot1Start: props.initialData.slot1Start ?? 8,
      slot1End: props.initialData.slot1End ?? 12,
      slot2Name: props.initialData.slot2Name || 'Après-midi',
      slot2Start: props.initialData.slot2Start ?? 14,
      slot2End: props.initialData.slot2End ?? 19
    }
  }
  return {
    id: null,
    label: '',
    icon: 'mdi-bike',
    constraints: '',

    windMin: null,
    windMax: null,
    gustMin: null,
    gustMax: null,
    tempMin: null,
    tempMax: null,
    precipMin: null,
    precipMax: null,
    uvMin: null,
    uvMax: null,
    slot1Name: 'Matin',
    slot1Start: 8,
    slot1End: 12,
    slot2Name: 'Après-midi',
    slot2Start: 14,
    slot2End: 19
  }
}

const form = ref(getInitialForm())

watch(() => props.initialData, () => {
  form.value = getInitialForm()
}, { deep: true })

const showIconSuggestions = ref(false)
const focusedIconIndex = ref(0)

const normalizedQuery = computed(() => {
  return (form.value.icon || '')
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
  form.value.icon = iconName
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

const sanitizeNum = (val) => {
  if (val === undefined || val === null || val === '') return null;
  const num = Number(val);
  return isNaN(num) ? null : num;
}

const handleSubmit = () => {
  const payload = {
    label: form.value.label,
    icon: form.value.icon,
    constraints: form.value.constraints,

    windMin: sanitizeNum(form.value.windMin),
    windMax: sanitizeNum(form.value.windMax),
    gustMin: sanitizeNum(form.value.gustMin),
    gustMax: sanitizeNum(form.value.gustMax),
    tempMin: sanitizeNum(form.value.tempMin),
    tempMax: sanitizeNum(form.value.tempMax),
    precipMin: sanitizeNum(form.value.precipMin),
    precipMax: sanitizeNum(form.value.precipMax),
    uvMin: sanitizeNum(form.value.uvMin),
    uvMax: sanitizeNum(form.value.uvMax),
    slot1Name: typeof form.value.slot1Name === 'string' && form.value.slot1Name.trim() !== '' ? form.value.slot1Name.trim() : 'Matin',
    slot1Start: form.value.slot1Start !== null && form.value.slot1Start !== '' ? Number(form.value.slot1Start) : 8,
    slot1End: form.value.slot1End !== null && form.value.slot1End !== '' ? Number(form.value.slot1End) : 12,
    slot2Name: typeof form.value.slot2Name === 'string' && form.value.slot2Name.trim() !== '' ? form.value.slot2Name.trim() : 'Après-midi',
    slot2Start: form.value.slot2Start !== null && form.value.slot2Start !== '' ? Number(form.value.slot2Start) : 14,
    slot2End: form.value.slot2End !== null && form.value.slot2End !== '' ? Number(form.value.slot2End) : 19
  }
  emit('submit', payload, form.value.id)
}

const handleCancel = () => {
  emit('cancel')
}
</script>

<script setup>
import { ref } from 'vue'
import axios from 'axios'

const props = defineProps({
  apiBaseUrl: { type: String, required: true },
  isDark: { type: Boolean, default: false }
})

const emit = defineEmits(['close'])

// --- ÉTATS ---
const newUser = ref({ username: '', password: '', role: 'user' })
const adminMsg = ref({ text: '', type: '' })
const usersList = ref([])
const showNewUserPassword = ref(false)
const selectedModel = ref('gemini-3.1-flash-lite')
const selectedFallbackModel = ref('gemini-3.5-flash')
const cacheMaxAge = ref(60)
const settingsMsg = ref({ text: '', type: '' })
const settingsLoading = ref(false)
const availableModels = ref([
  { id: 'gemini-3.1-flash-lite', displayName: 'Gemini 3.1 Flash Lite (Rapide & Économe)' },
  { id: 'gemini-3.5-flash', displayName: 'Gemini 3.5 Flash (Plus Performant)' }
])
const modelsLoading = ref(false)

// --- MÉTHODES ---
const fetchUsers = async () => {
  try {
    const response = await axios.get(`${props.apiBaseUrl}/api/admin/users`)
    usersList.value = response.data
  } catch (err) { console.error("Erreur liste users") }
}

const createUser = async () => {
  adminMsg.value = { text: '', type: '' }
  try {
    await axios.post(`${props.apiBaseUrl}/api/admin/create-user`, newUser.value)
    adminMsg.value = { text: `Utilisateur ${newUser.value.username} créé avec succès !`, type: 'success' }
    newUser.value = { username: '', password: '', role: 'user' }
    await fetchUsers()
  } catch (err) {
    const errorMsg = err.response?.data?.error || "Erreur lors de la création."
    adminMsg.value = { text: errorMsg, type: 'error' }
  }
}

const deleteUser = async (id) => {
  if (!confirm("Supprimer cet utilisateur ?")) return
  try {
    await axios.delete(`${props.apiBaseUrl}/api/admin/users/${id}`)
    fetchUsers()
  } catch (err) { alert(err.response.data.error) }
}

const changePassword = async (id) => {
  const newPass = prompt("Nouveau mot de passe :")
  if (!newPass) return
  try {
    await axios.patch(`${props.apiBaseUrl}/api/admin/users/${id}/password`, { newPassword: newPass })
    alert("Mot de passe modifié !")
  } catch (err) { alert(err.response?.data?.error || "Erreur lors de la modification du mot de passe") }
}
const ensureSelectedModelInList = () => {
  if (selectedModel.value && !availableModels.value.some(m => m.id === selectedModel.value)) {
    availableModels.value.push({
      id: selectedModel.value,
      displayName: selectedModel.value
    })
  }
  if (selectedFallbackModel.value && !availableModels.value.some(m => m.id === selectedFallbackModel.value)) {
    availableModels.value.push({
      id: selectedFallbackModel.value,
      displayName: selectedFallbackModel.value
    })
  }
}

const fetchSettings = async () => {
  try {
    const response = await axios.get(`${props.apiBaseUrl}/api/admin/settings`)
    if (response.data) {
      selectedModel.value = response.data.gemini_model || 'gemini-3.1-flash-lite'
      selectedFallbackModel.value = response.data.gemini_fallback_model || 'gemini-3.5-flash'
      cacheMaxAge.value = parseInt(response.data.cache_max_age, 10) || 60
      ensureSelectedModelInList()
    }
  } catch (err) {
    console.error("Erreur de récupération des paramètres", err)
  }
}

const saveSettings = async () => {
  settingsMsg.value = { text: '', type: '' }
  settingsLoading.value = true
  try {
    await axios.post(`${props.apiBaseUrl}/api/admin/settings`, {
      gemini_model: selectedModel.value,
      gemini_fallback_model: selectedFallbackModel.value,
      cache_max_age: cacheMaxAge.value
    })
    settingsMsg.value = { text: "Paramètres système mis à jour avec succès !", type: 'success' }
  } catch (err) {
    settingsMsg.value = { text: err.response?.data?.error || "Erreur d'enregistrement.", type: 'error' }
  } finally {
    settingsLoading.value = false
  }
}

const fetchAvailableModels = async () => {
  modelsLoading.value = true
  try {
    const response = await axios.get(`${props.apiBaseUrl}/api/admin/models`)
    if (response.data && Array.isArray(response.data)) {
      availableModels.value = response.data
    }
    ensureSelectedModelInList()
  } catch (err) {
    console.error("Erreur lors de la récupération des modèles Gemini", err)
    ensureSelectedModelInList()
  } finally {
    modelsLoading.value = false
  }
}

// Charger la liste et les paramètres à la création du composant
fetchUsers()
fetchSettings()
fetchAvailableModels()
</script>

<template>
  <main class="admin-screen" :class="{ 'theme-dark': isDark }">
    <div class="admin-container">

      <div class="admin-box">
        <h2><span class="mdi mdi-account-plus"></span> Nouvel Utilisateur</h2>

        <div v-if="adminMsg.text" :class="['msg-banner', adminMsg.type]">
          {{ adminMsg.text }}
        </div>

        <div class="input-group">
          <label>Identifiant :</label>
          <input v-model="newUser.username" type="text" placeholder="ex: julie" />
        </div>

        <div class="input-group">
          <label>Mot de passe :</label>
          <div class="password-input-wrapper">
            <input v-model="newUser.password" :type="showNewUserPassword ? 'text' : 'password'" />
            <button type="button" class="password-toggle" @click="showNewUserPassword = !showNewUserPassword" :aria-label="showNewUserPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'">
              <span class="mdi" :class="showNewUserPassword ? 'mdi-eye-off' : 'mdi-eye'"></span>
            </button>
          </div>
          <p class="password-rules">Minimum 10 caractères, avec une majuscule, une minuscule, un chiffre et un caractère spécial.</p>
        </div>

        <div class="input-group">
          <label>Rôle :</label>
          <select v-model="newUser.role">
            <option value="user">Utilisateur standard</option>
            <option value="admin">Administrateur</option>
          </select>
        </div>

        <button @click="createUser" class="login-btn">Créer</button>
      </div>

      <div class="admin-box">
        <h2><span class="mdi mdi-cogs"></span> Configuration Système</h2>

        <div v-if="settingsMsg.text" :class="['msg-banner', settingsMsg.type]">
          {{ settingsMsg.text }}
        </div>

        <div class="input-group">
          <label>Modèle Gemini principal :</label>
          <select v-model="selectedModel" :disabled="settingsLoading || modelsLoading">
            <option v-for="model in availableModels" :key="model.id" :value="model.id">
              {{ model.displayName }}
            </option>
          </select>
        </div>

        <div class="input-group">
          <label>Modèle Gemini de secours (Fallback) :</label>
          <select v-model="selectedFallbackModel" :disabled="settingsLoading || modelsLoading">
            <option v-for="model in availableModels" :key="model.id" :value="model.id">
              {{ model.displayName }}
            </option>
          </select>
        </div>

        <div class="input-group">
          <label>Validité du cache météo (minutes) :</label>
          <input
            v-model.number="cacheMaxAge"
            type="number"
            min="1"
            max="43200"
            :disabled="settingsLoading"
            required
            placeholder="Ex: 60"
          />
        </div>

        <button @click="saveSettings" class="login-btn" :disabled="settingsLoading">
          {{ settingsLoading ? 'Enregistrement...' : 'Enregistrer' }}
        </button>
      </div>

      <div class="admin-box list-box">
        <h2><span class="mdi mdi-account-group"></span> Utilisateurs existants</h2>
        <table class="user-table">
          <thead>
            <tr>
              <th>Nom</th>
              <th>Rôle</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in usersList" :key="u._id">
              <td>{{ u.username }}</td>
              <td><span :class="['badge', u.role]">{{ u.role }}</span></td>
              <td class="actions">
                <button @click="changePassword(u._id)" title="Changer MDP">
                  <span class="mdi mdi-key-variant"></span>
                </button>
                <button @click="deleteUser(u._id)" class="del-btn" title="Supprimer">
                  <span class="mdi mdi-trash-can-outline"></span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  </main>
</template>

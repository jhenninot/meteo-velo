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
  } catch (err) { console.error(err) }
}

// Charger la liste à la création du composant
fetchUsers()
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
          <input v-model="newUser.password" type="password" />
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

<style scoped>
/* ÉCRAN ADMIN */
.admin-screen { display: flex; flex-direction: column; align-items: center; justify-content: center; margin-top: 40px; gap: 20px; }
.admin-container { display: flex; flex-wrap: wrap; gap: 20px; justify-content: center; width: 100%; }
.admin-box { background: var(--bg-surface-2); padding: 30px; border-radius: var(--radius-lg); box-shadow: var(--shadow-md); width: 100%; max-width: 400px; box-sizing: border-box; color: var(--text-primary); }
.admin-box.list-box { max-width: 400px; margin-top: 0; }
.login-btn { width: 100%; background: var(--color-primary); color: white; border: none; padding: 12px; border-radius: var(--radius-md); font-size: 1.1rem; cursor: pointer; margin-top: 10px; }

/* TABLE */
.user-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
.user-table th, .user-table td { padding: 10px; text-align: left; border-bottom: 1px solid var(--border-color); font-size: 0.95rem; }
.user-table th { font-weight: bold; color: var(--text-secondary); }

/* BADGES */
.badge { padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; font-weight: 600; text-transform: uppercase; }
.badge.admin { background: #e8f5e9; color: #2e7d32; }
.badge.user { background: #e3f2fd; color: #1565c0; }

/* ACTIONS */
.actions { display: flex; gap: 8px; justify-content: flex-start; }
.actions button { border: none; padding: 6px 10px; border-radius: var(--radius-sm); cursor: pointer; background: #f0f0f0; color: #333; display: inline-flex; align-items: center; justify-content: center; transition: all 0.2s; font-size: 0.9rem; }
.actions button:hover { background: #e0e0e0; color: var(--color-primary); }
.actions button.del-btn { background: #ffebee; color: var(--color-danger-dark); }
.actions button.del-btn:hover { background: #ffcdd2; color: #b71c1c; }

/* MODE NUIT */
.admin-screen.theme-dark .admin-box { background: var(--bg-surface); border: 1px solid var(--border-color); box-shadow: var(--shadow-md); }
.admin-screen.theme-dark .user-table th,
.admin-screen.theme-dark .user-table td { border-bottom-color: var(--border-color); }
.admin-screen.theme-dark .badge.admin { background: rgba(46, 125, 50, 0.2); color: #a5d6a7; }
.admin-screen.theme-dark .badge.user { background: rgba(21, 101, 192, 0.2); color: #90caf9; }
.admin-screen.theme-dark .actions button { background: #2d333c; color: var(--text-primary); }
.admin-screen.theme-dark .actions button:hover { background: var(--border-color); color: var(--color-primary-light); }
.admin-screen.theme-dark .actions button.del-btn { background: rgba(198, 40, 40, 0.2); color: var(--color-danger-light); }
.admin-screen.theme-dark .actions button.del-btn:hover { background: rgba(198, 40, 40, 0.35); color: #ff8a80; }
</style>

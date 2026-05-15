import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import 'dotenv/config';

// Import du modèle (on le redéfinit ici pour que le script soit autonome)
const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  preferences: { city: String, lat: Number, lon: Number, consignes: String }
});
const User = mongoose.model('User', userSchema);

async function createFirstAdmin() {
  const mongoUrl = process.env.MONGO_URL || 'mongodb://192.168.0.41:27017/meteo_velo';
  
  try {
    await mongoose.connect(mongoUrl);
    console.log("Connexion à MongoDB réussie...");

    // On vérifie si un admin existe déjà
    const adminExists = await User.findOne({ role: 'admin' });

    if (adminExists) {
      console.log(`Un administrateur existe déjà : ${adminExists.username}`);
    } else {
      // Configuration de ton compte admin
      const adminUsername = 'julien'; 
      const adminPassword = 'ton_mot_de_passe_secret'; // CHANGE-LE ICI !
      
      const hashedPassword = await bcrypt.hash(adminPassword, 10);
      
      const newAdmin = new User({
        username: adminUsername,
        password: hashedPassword,
        role: 'admin',
        preferences: {
            city: 'Marcq-en-Barœul',
            lat: 50.671,
            lon: 3.081,
            consignes: 'Pas de vent > 20km/h'
        }
      });

      await newAdmin.save();
      console.log(`-----------------------------------`);
      console.log(`Compte ADMIN créé avec succès !`);
      console.log(`Utilisateur : ${adminUsername}`);
      console.log(`Mot de passe : ${adminPassword}`);
      console.log(`-----------------------------------`);
    }
  } catch (error) {
    console.error("Erreur lors de la création de l'admin:", error);
  } finally {
    mongoose.connection.close();
  }
}

createFirstAdmin();
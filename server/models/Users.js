import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  preferences: {
    city: String,
    lat: Number,
    lon: Number,
    consignes: String,
    theme: { type: String, enum: ['light', 'dark', 'auto'], default: 'auto' },
    stravaFilters: { type: [String], default: [] },
    useAiAnalysis: { type: Boolean, default: false }
  },
  activities: {
    type: [{
      label: { type: String, required: true, trim: true, maxlength: 80 },
      icon: { type: String, default: 'mdi-bike', trim: true, maxlength: 60 },
      constraints: { type: String, default: '', trim: true, maxlength: 4000 },
      stravaSportType: { type: String, default: '', trim: true },
      windMin: { type: Number, default: null },
      windMax: { type: Number, default: null },
      gustMin: { type: Number, default: null },
      gustMax: { type: Number, default: null },
      tempMin: { type: Number, default: null },
      tempMax: { type: Number, default: null },
      precipMin: { type: Number, default: null },
      precipMax: { type: Number, default: null },
      uvMin: { type: Number, default: null },
      uvMax: { type: Number, default: null },
      slot1Name: { type: String, default: 'Matin' },
      slot1Start: { type: Number, default: 8 },
      slot1End: { type: Number, default: 12 },
      slot2Name: { type: String, default: 'Après-midi' },
      slot2Start: { type: Number, default: 14 },
      slot2End: { type: Number, default: 19 }
    }],
    default: () => [{
      label: "Course à pied",
      icon: "mdi-run",
      stravaSportType: "Run",
      tempMin: 10,
      tempMax: 28,
      precipMax: 0.1,
      constraints: ""
    }]
  },
  favorites: [{
    city: { type: String, required: true, trim: true },
    lat: { type: Number, required: true },
    lon: { type: Number, required: true }
  }],
  strava: {
    athleteId: Number,
    accessToken: String,
    refreshToken: String,
    expiresAt: Number, // Unix timestamp seconds
    athleteName: String,
    athleteProfile: String
  }
});

// Avoid OverwriteModelError if already compiled
export default mongoose.models.User || mongoose.model('User', userSchema);
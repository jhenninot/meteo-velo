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
    theme: { type: String, enum: ['light', 'dark'], default: 'light' }
  }
});

export default mongoose.model('User', userSchema);
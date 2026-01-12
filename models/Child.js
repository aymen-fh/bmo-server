const mongoose = require('mongoose');

const childSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Child name is required'],
    trim: true
  },
  age: {
    type: Number,
    required: true,
    min: 4,
    max: 5
  },
  gender: {
    type: String,
    enum: ['male', 'female'],
    required: true
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedSpecialist: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  specialistRequestStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected'],
    default: 'none'
  },
  dailyPlayDuration: {
    type: Number,
    default: 60 // minutes
  },
  sessionStructure: {
    playDuration: { type: Number, default: 15 },
    breakDuration: { type: Number, default: 10 },
    encouragementMessages: { type: Boolean, default: true },
    // Max attempts allowed per session (Child-Game expects this key)
    maxAttempts: { type: Number, default: 30 }
  },
  // Optional schedule to control WHEN the child can play.
  // Stored as local-time windows in HH:mm.
  playSchedule: {
    enabled: { type: Boolean, default: false },
    // 0=Sunday .. 6=Saturday
    allowedDays: [{ type: Number, min: 0, max: 6 }],
    windows: [{
      start: { type: String, trim: true }, // 'HH:mm'
      end: { type: String, trim: true }    // 'HH:mm'
    }],
    // If true, the game should block play outside schedule.
    enforce: { type: Boolean, default: true }
  },
  targetLetters: [{
    type: String,
    trim: true
  }],
  targetWords: [{
    type: String,
    trim: true
  }],
  difficultyLevel: {
    type: String,
    enum: ['beginner', 'intermediate', 'advanced'],
    default: 'beginner'
  },
  // Custom child ID for search
  childId: {
    type: String,
    unique: true,
    trim: true
  },

  // Default avatar selection (shared across apps by ID)
  // Example IDs: avatar_01, avatar_02, ...
  avatarId: {
    type: String,
    trim: true,
    default: null
  },
  active: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Pre-save hook to generate childId
childSchema.pre('save', async function (next) {
  if (this.isNew && !this.childId) {
    const count = await this.constructor.countDocuments();
    this.childId = `CH-${String(count + 1).padStart(4, '0')}`;
  }

  // Set a sensible default avatarId if not provided.
  if (this.isNew && !this.avatarId) {
    this.avatarId = this.gender === 'female' ? 'avatar_02' : 'avatar_01';
  }
  next();
});

module.exports = mongoose.model('Child', childSchema);

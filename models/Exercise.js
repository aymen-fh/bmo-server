const mongoose = require('mongoose');

const contentItemSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'] },
  image: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const exerciseSchema = new mongoose.Schema({
  child: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Child',
    required: true
  },
  kind: {
    type: String,
    enum: ['plan', 'content'],
    required: true
  },
  specialist: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Specialist'
  },
  // Content library stored as a single document per child (kind: 'content')
  contentWords: [contentItemSchema],
  contentLetters: [contentItemSchema],
  letters: [{
    letter: String,
    articulationPoint: String,
    vowels: [String],
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'] }
  }],
  words: [{
    word: String,
    translation: String,
    category: String,
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'] }
  }],

  // Session metadata (for kind: 'plan')
  sessionIndex: { type: Number },
  sessionName: { type: String, trim: true },

  // 🎯 PRIMARY SESSION SETTINGS - NO DEFAULTS
  // The specialist MUST specify these values explicitly
  targetDuration: {
    type: Number,
    required: function () { return this.kind === 'plan'; },
    min: 1
  },
  breakDuration: {
    type: Number,
    required: function () { return this.kind === 'plan'; },
    min: 0
  },
  maxAttempts: {
    type: Number,
    required: function () { return this.kind === 'plan'; },
    min: 1
  },

  // ⚠️ DEPRECATED FIELDS - Kept for backward compatibility
  // These will be removed in a future version
  playDuration: { type: Number },
  sessionDuration: { type: Number },
  totalDuration: { type: Number },

  // Session dates
  startDate: { type: Date },
  endDate: { type: Date },
  allowedDays: [Number], // 0=Sunday, 1=Monday, ...
  active: { type: Boolean, required: true }
}, {
  timestamps: true
});

// Enforce at most one content document per child
exerciseSchema.index(
  { child: 1 },
  { unique: true, partialFilterExpression: { kind: 'content' } }
);

module.exports = mongoose.model('Exercise', exerciseSchema);

const mongoose = require('mongoose');

const contentItemSchema = new mongoose.Schema({
  text: { type: String, required: true, trim: true },
  difficulty: { type: String, enum: ['easy', 'medium', 'hard'], default: 'easy' },
  image: { type: String, default: 'default-word.png' },
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
    default: 'plan'
  },
  specialist: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  // Content library stored as a single document per child (kind: 'content')
  // This replaces storing each word/letter as a separate document in the Word collection.
  contentWords: [contentItemSchema],
  contentLetters: [contentItemSchema],
  letters: [{
    letter: String,
    articulationPoint: String, // مخرج الحرف
    vowels: [String], // حركات: أَ، إِ، أُ، إْ
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'] }
  }],
  words: [{
    word: String,
    translation: String,
    category: String, // emotions, needs, actions
    difficulty: { type: String, enum: ['easy', 'medium', 'hard'] }
  }],
  // Numbered plan sessions: Session 1, Session 2, ...
  // Only meaningful for kind: 'plan'.
  sessionIndex: { type: Number, default: null },
  sessionName: { type: String, trim: true, default: null },
  targetDuration: Number, // minutes per day
  playDuration: Number, // minutes of play within session
  breakDuration: Number, // minutes of rest within session
  sessionDuration: Number, // minutes per session
  totalDuration: Number, // total minutes for full session
  maxAttempts: Number,
  startDate: { type: Date, default: Date.now },
  endDate: Date,
  active: { type: Boolean, default: true }
}, {
  timestamps: true
});

// Enforce at most one content document per child
exerciseSchema.index(
  { child: 1 },
  { unique: true, partialFilterExpression: { kind: 'content' } }
);

module.exports = mongoose.model('Exercise', exerciseSchema);

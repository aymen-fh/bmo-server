const mongoose = require('mongoose');

const attemptSchema = new mongoose.Schema({
  letter: String,
  word: String,
  vowel: String,
  // Speech analysis details (sent from Child-Game)
  recognizedText: String,
  referenceText: String,
  // Detailed scores (0-100). `score` is kept for backward compatibility.
  pronunciationScore: Number,
  accuracyScore: Number,
  fluencyScore: Number,
  completenessScore: Number,
  // e.g. 'local' | 'azure'
  analysisSource: String,
  success: Boolean,
  score: Number,
  timestamp: { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
  sessionDate: { type: Date, default: Date.now },
  duration: Number, // minutes
  // Link a played session to the active plan session (Exercise)
  planExerciseId: { type: mongoose.Schema.Types.ObjectId, ref: 'Exercise', default: null },
  planSessionIndex: { type: Number, default: null },
  planSessionName: { type: String, default: null },
  totalAttempts: { type: Number, default: 0 },
  successfulAttempts: { type: Number, default: 0 },
  failedAttempts: { type: Number, default: 0 },
  averageScore: { type: Number, default: 0 },
  attempts: [attemptSchema],
  robotFeedback: [{
    type: String,
    timestamp: Date
  }]
});

const progressSchema = new mongoose.Schema({
  child: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Child',
    required: true
  },
  sessions: [sessionSchema],
  overallStats: {
    totalSessions: { type: Number, default: 0 },
    totalPlayTime: { type: Number, default: 0 }, // minutes
    totalAttempts: { type: Number, default: 0 },
    successRate: { type: Number, default: 0 },
    averageScore: { type: Number, default: 0 },
    masteredLetters: [String],
    masteredWords: [String],
    challengingLetters: [String],
    challengingWords: [String]
  },
  lastSyncDate: { type: Date, default: Date.now }
}, {
  timestamps: true
});

// Method to calculate overall stats
progressSchema.methods.updateOverallStats = function() {
  const clamp01 = (n) => {
    const x = Number(n);
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(100, x));
  };

  const stats = this.overallStats;
  stats.totalSessions = this.sessions.length;
  stats.totalPlayTime = this.sessions.reduce((sum, s) => sum + (s.duration || 0), 0);
  stats.totalAttempts = this.sessions.reduce((sum, s) => sum + (s.totalAttempts || 0), 0);
  
  const successfulAttempts = this.sessions.reduce((sum, s) => sum + (s.successfulAttempts || 0), 0);
  stats.successRate = stats.totalAttempts > 0 ? clamp01((successfulAttempts / stats.totalAttempts) * 100) : 0;
  
  const totalScore = this.sessions.reduce((sum, s) => sum + (s.averageScore || 0), 0);
  stats.averageScore = this.sessions.length > 0 ? clamp01(totalScore / this.sessions.length) : 0;
  
  return this;
};

module.exports = mongoose.model('Progress', progressSchema);

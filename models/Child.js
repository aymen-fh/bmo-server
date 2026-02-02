const mongoose = require('mongoose');
const Counter = require('./Counter');

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
  birthDate: {
    type: Date
  },
  gender: {
    type: String,
    enum: ['male', 'female'],
    required: true
  },
  parent: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Parent',
    required: true
  },
  assignedSpecialist: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Specialist'
  },
  specialistRequestStatus: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected']
  },
  dailyPlayDuration: {
    type: Number // NO DEFAULT - must be set explicitly
  },
  // ⚠️ sessionStructure is DEPRECATED
  // Session settings should come from Exercise (kind: 'plan') documents
  // This is kept only as a fallback for children without active plans
  sessionStructure: {
    playDuration: { type: Number },
    breakDuration: { type: Number },
    encouragementMessages: { type: Boolean },
    maxAttempts: { type: Number }
  },
  // Optional schedule to control WHEN the child can play
  playSchedule: {
    enabled: { type: Boolean },
    allowedDays: [{ type: Number, min: 0, max: 6 }],
    windows: [{
      start: { type: String, trim: true },
      end: { type: String, trim: true }
    }],
    enforce: { type: Boolean }
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
    enum: ['beginner', 'intermediate', 'advanced']
  },
  // Custom child ID for search
  childId: {
    type: String,
    unique: true,
    trim: true
  },
  // Default avatar selection
  avatarId: {
    type: String,
    trim: true
  },
  active: {
    type: Boolean
  }
}, {
  timestamps: true
});

// Pre-save hook to generate childId
childSchema.pre('save', async function (next) {
  if (this.isNew && !this.childId) {
    let counter = await Counter.findById('childId');

    if (!counter) {
      const lastChild = await this.constructor
        .findOne({ childId: /^CH-\d+$/ })
        .sort({ childId: -1 })
        .select('childId')
        .lean();

      let startSeq = 0;
      if (lastChild?.childId) {
        const parsed = parseInt(lastChild.childId.split('-')[1], 10);
        if (!Number.isNaN(parsed)) startSeq = parsed;
      }

      await Counter.create({ _id: 'childId', seq: startSeq });
    }

    counter = await Counter.findByIdAndUpdate(
      'childId',
      { $inc: { seq: 1 } },
      { new: true }
    );

    this.childId = `CH-${String(counter.seq).padStart(4, '0')}`;
  }

  // Set avatarId based on gender if not provided
  if (this.isNew && !this.avatarId) {
    this.avatarId = this.gender === 'female' ? 'avatar_02' : 'avatar_01';
  }

  next();
});

module.exports = mongoose.model('Child', childSchema);

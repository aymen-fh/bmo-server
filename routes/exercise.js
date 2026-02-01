const express = require('express');
const router = express.Router();
const Exercise = require('../models/Exercise');
const Child = require('../models/Child');
const Specialist = require('../models/Specialist'); // Correct Model Reference
const Parent = require('../models/Parent'); // In case parents need read access
const { protect, authorize } = require('../middleware/auth');

// @route   POST /api/exercises
// @desc    Create exercise plan for child
// @access  Private (Specialist)
router.post('/', protect, authorize('specialist'), async (req, res) => {
  try {
    const { childId, letters, words, targetDuration, endDate, sessionName, breakDuration, maxAttempts } = req.body;

    // Validate required session settings
    if (targetDuration === null || targetDuration === undefined
      || breakDuration === null || breakDuration === undefined
      || maxAttempts === null || maxAttempts === undefined) {
      return res.status(400).json({
        success: false,
        message: 'يجب تحديد targetDuration و breakDuration و maxAttempts'
      });
    }

    const toNumber = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    }

    const child = await Child.findById(childId);

    if (!child) {
      return res.status(404).json({
        success: false,
        message: 'Child not found'
      });
    }

    if (!child.assignedSpecialist || child.assignedSpecialist.toString() !== req.user.id) {
      const specialist = await Specialist.findById(req.user.id).select('linkedParents');
      const linkedParents = specialist?.linkedParents || [];
      const parentId = child.parent?.toString();
      const isLinkedParentChild = parentId && linkedParents.map(String).includes(String(parentId));

      if (!isLinkedParentChild) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    }

    // Ensure only one active plan at a time (kind: 'plan')
    await Exercise.updateMany(
      { child: childId, kind: 'plan', active: true },
      { $set: { active: false } }
    );

    // Auto-increment session index (Session 1, Session 2, ...)
    const last = await Exercise.findOne({ child: childId, kind: 'plan' })
      .sort({ sessionIndex: -1, createdAt: -1 })
      .select('sessionIndex');

    const nextSessionIndex = (typeof last?.sessionIndex === 'number' ? last.sessionIndex : 0) + 1;

    const exercise = await Exercise.create({
      child: childId,
      specialist: req.user.id,
      kind: 'plan',
      sessionIndex: nextSessionIndex,
      sessionName: sessionName || `Session ${nextSessionIndex}`,
      letters,
      words,
      // 🎯 REQUIRED SESSION SETTINGS - NO DEFAULTS
      targetDuration: toNumber(targetDuration),
      breakDuration: toNumber(breakDuration),
      maxAttempts: toNumber(maxAttempts),
      endDate,
      active: true
    });

    // Update child's targets (store just the text for quick reference)
    if (Array.isArray(letters)) {
      child.targetLetters = letters
        .map(l => (l && typeof l === 'object') ? l.letter : l)
        .map(x => String(x || '').trim())
        .filter(Boolean);
    }
    if (Array.isArray(words)) {
      child.targetWords = words
        .map(w => (w && typeof w === 'object') ? w.word : w)
        .map(x => String(x || '').trim())
        .filter(Boolean);
    }
    await child.save();

    res.status(201).json({
      success: true,
      exercise
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/exercises/child/:childId
// @desc    Get exercises for a child
// @access  Private
router.get('/child/:childId', protect, async (req, res) => {
  try {
    const child = await Child.findById(req.params.childId);

    if (!child) {
      return res.status(404).json({
        success: false,
        message: 'Child not found'
      });
    }

    // Check authorization
    if (req.user.role === 'parent' && child.parent.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (req.user.role === 'specialist' && (!child.assignedSpecialist || child.assignedSpecialist.toString() !== req.user.id)) {
      const specialist = await Specialist.findById(req.user.id).select('linkedParents');
      const linkedParents = specialist?.linkedParents || [];
      const parentId = child.parent?.toString();
      const isLinkedParentChild = parentId && linkedParents.map(String).includes(String(parentId));
      if (!isLinkedParentChild) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    }

    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === '1'
      || String(req.query.includeInactive || '').toLowerCase() === 'true';

    const filter = { child: req.params.childId };
    if (!includeInactive) filter.active = true;

    const exercises = await Exercise.find(filter)
      .populate('specialist', 'name specialization')
      .sort('-createdAt');

    res.json({
      success: true,
      count: exercises.length,
      exercises
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   PUT /api/exercises/:id
// @desc    Update exercise plan
// @access  Private (Specialist)
router.put('/:id', protect, authorize('specialist'), async (req, res) => {
  console.log(`[PUT] /exercises/${req.params.id} - Body:`, JSON.stringify(req.body, null, 2));
  try {
    let exercise = await Exercise.findById(req.params.id);

    if (!exercise) {
      console.error(`[PUT] Exercise ${req.params.id} not found`);
      return res.status(404).json({
        success: false,
        message: 'Exercise not found'
      });
    }

    console.log(`[PUT] Found exercise, specialist: ${exercise.specialist}, user: ${req.user.id}`);

    if (exercise.specialist && exercise.specialist.toString() !== req.user.id) {
      // Allow updates if the child is assigned to this specialist or linked via parent
      const child = await Child.findById(exercise.child).select('assignedSpecialist parent');
      const isAssigned = child?.assignedSpecialist && child.assignedSpecialist.toString() === req.user.id;

      let isLinked = false;
      if (!isAssigned && child?.parent) {
        const specialist = await Specialist.findById(req.user.id).select('linkedParents');
        const linkedParents = specialist?.linkedParents || [];
        isLinked = linkedParents.map(String).includes(String(child.parent));
      }

      if (!isAssigned && !isLinked) {
        console.error(`[PUT] Authorization failed: exercise specialist ${exercise.specialist} != user ${req.user.id}`);
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }

      // Normalize ownership for legacy exercises
      exercise.specialist = req.user.id;
    }

    // Manual update to ensure validators (which rely on 'this') work correctly
    const {
      targetDuration, playDuration, breakDuration, maxAttempts,
      letters, words, allowedDays
    } = req.body;

    console.log(`[PUT] Updating exercise with:`, {
      targetDuration,
      playDuration,
      breakDuration,
      maxAttempts,
      lettersCount: letters?.length,
      wordsCount: words?.length,
      allowedDays
    });

    if (targetDuration !== undefined) exercise.targetDuration = targetDuration;
    if (playDuration !== undefined) exercise.playDuration = playDuration;
    if (breakDuration !== undefined) exercise.breakDuration = breakDuration;
    if (maxAttempts !== undefined) exercise.maxAttempts = maxAttempts;
    if (letters !== undefined) exercise.letters = letters;
    if (words !== undefined) exercise.words = words;
    if (allowedDays !== undefined) exercise.allowedDays = allowedDays;

    console.log(`[PUT] Saving exercise...`);
    const savedExercise = await exercise.save();
    console.log(`[PUT] Exercise saved successfully`);

    res.json({
      success: true,
      exercise: savedExercise
    });
  } catch (error) {
    console.error(`!!! Exercise Update Error (ID: ${req.params.id}):`, error.message);
    console.error('Error stack:', error.stack);

    // More detailed error response
    const errorResponse = {
      success: false,
      message: error.message
    };

    // Include validation errors if present
    if (error.name === 'ValidationError') {
      errorResponse.validationErrors = Object.keys(error.errors).map(key => ({
        field: key,
        message: error.errors[key].message
      }));
    }

    res.status(500).json(errorResponse);
  }
});

// @route   DELETE /api/exercises/:id
// @desc    Deactivate exercise plan
// @access  Private (Specialist)
router.delete('/:id', protect, authorize('specialist'), async (req, res) => {
  try {
    const exercise = await Exercise.findById(req.params.id);

    if (!exercise) {
      return res.status(404).json({
        success: false,
        message: 'Exercise not found'
      });
    }

    if (exercise.specialist.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    exercise.active = false;
    await exercise.save();

    res.json({
      success: true,
      message: 'Exercise deactivated'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/exercises/:id/reset
// @desc    Reset session progress (delete all progress sessions for this plan)
// @access  Private (Specialist)
router.post('/:id/reset', protect, authorize('specialist'), async (req, res) => {
  try {
    const Progress = require('../models/Progress');
    const exercise = await Exercise.findById(req.params.id);

    if (!exercise) {
      return res.status(404).json({
        success: false,
        message: 'Exercise not found'
      });
    }

    if (exercise.specialist.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Find progress document for the child
    const progress = await Progress.findOne({ child: exercise.child });

    if (progress && Array.isArray(progress.sessions)) {
      // Remove all sessions linked to this exercise plan
      const initialCount = progress.sessions.length;
      progress.sessions = progress.sessions.filter(session =>
        !session.planExerciseId || session.planExerciseId.toString() !== req.params.id
      );

      const deletedCount = initialCount - progress.sessions.length;
      await progress.save();

      return res.json({
        success: true,
        message: `تم إعادة تعيين الجلسة بنجاح. تم حذف ${deletedCount} سجل.`,
        deletedCount
      });
    }

    res.json({
      success: true,
      message: 'لم يتم العثور على بيانات تقدم لحذفها.',
      deletedCount: 0
    });
  } catch (error) {
    console.error('Reset Session Error:', error);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/exercises/letters/default
// @desc    Get default Arabic letters with articulation points
// @access  Public
router.get('/letters/default', async (req, res) => {
  try {
    const defaultLetters = [
      { letter: 'ب', articulationPoint: 'الشفتان', vowels: ['بَ', 'بِ', 'بُ', 'بْ'] },
      { letter: 'ت', articulationPoint: 'طرف اللسان مع أصول الثنايا العليا', vowels: ['تَ', 'تِ', 'تُ', 'تْ'] },
      { letter: 'ث', articulationPoint: 'طرف اللسان مع أطراف الثنايا العليا', vowels: ['ثَ', 'ثِ', 'ثُ', 'ثْ'] },
      { letter: 'ج', articulationPoint: 'وسط اللسان مع الحنك الصلب', vowels: ['جَ', 'جِ', 'جُ', 'جْ'] },
      { letter: 'ح', articulationPoint: 'وسط الحلق', vowels: ['حَ', 'حِ', 'حُ', 'حْ'] },
      { letter: 'خ', articulationPoint: 'أدنى الحلق', vowels: ['خَ', 'خِ', 'خُ', 'خْ'] },
      { letter: 'د', articulationPoint: 'طرف اللسان مع أصول الثنايا العليا', vowels: ['دَ', 'دِ', 'دُ', 'دْ'] },
      { letter: 'ذ', articulationPoint: 'طرف اللسان مع أطراف الثنايا العليا', vowels: ['ذَ', 'ذِ', 'ذُ', 'ذْ'] },
      { letter: 'ر', articulationPoint: 'طرف اللسان مع اللثة العليا', vowels: ['رَ', 'رِ', 'رُ', 'رْ'] },
      { letter: 'ز', articulationPoint: 'طرف اللسان مع اللثة العليا', vowels: ['زَ', 'زِ', 'زُ', 'زْ'] },
      { letter: 'س', articulationPoint: 'طرف اللسان مع اللثة العليا', vowels: ['سَ', 'سِ', 'سُ', 'سْ'] },
      { letter: 'ش', articulationPoint: 'وسط اللسان مع الحنك الصلب', vowels: ['شَ', 'شِ', 'شُ', 'شْ'] },
      { letter: 'ص', articulationPoint: 'طرف اللسان مع اللثة العليا', vowels: ['صَ', 'صِ', 'صُ', 'صْ'] },
      { letter: 'ض', articulationPoint: 'حافة اللسان مع الأضراس العليا', vowels: ['ضَ', 'ضِ', 'ضُ', 'ضْ'] },
      { letter: 'ط', articulationPoint: 'طرف اللسان مع أصول الثنايا العليا', vowels: ['طَ', 'طِ', 'طُ', 'طْ'] },
      { letter: 'ظ', articulationPoint: 'طرف اللسان مع أطراف الثنايا العليا', vowels: ['ظَ', 'ظِ', 'ظُ', 'ظْ'] },
      { letter: 'ع', articulationPoint: 'وسط الحلق', vowels: ['عَ', 'عِ', 'عُ', 'عْ'] },
      { letter: 'غ', articulationPoint: 'أدنى الحلق', vowels: ['غَ', 'غِ', 'غُ', 'غْ'] },
      { letter: 'ف', articulationPoint: 'الشفة السفلى مع الثنايا العليا', vowels: ['فَ', 'فِ', 'فُ', 'فْ'] },
      { letter: 'ق', articulationPoint: 'أقصى اللسان مع الحنك الرخو', vowels: ['قَ', 'قِ', 'قُ', 'قْ'] },
      { letter: 'ك', articulationPoint: 'أقصى اللسان مع الحنك الرخو', vowels: ['كَ', 'كِ', 'كُ', 'كْ'] },
      { letter: 'ل', articulationPoint: 'حافة اللسان مع اللثة العليا', vowels: ['لَ', 'لِ', 'لُ', 'لْ'] },
      { letter: 'م', articulationPoint: 'الشفتان', vowels: ['مَ', 'مِ', 'مُ', 'مْ'] },
      { letter: 'ن', articulationPoint: 'طرف اللسان مع اللثة العليا', vowels: ['نَ', 'نِ', 'نُ', 'نْ'] },
      { letter: 'ه', articulationPoint: 'أقصى الحلق', vowels: ['هَ', 'هِ', 'هُ', 'هْ'] },
      { letter: 'و', articulationPoint: 'الشفتان', vowels: ['وَ', 'وِ', 'وُ', 'وْ'] },
      { letter: 'ي', articulationPoint: 'وسط اللسان مع الحنك الصلب', vowels: ['يَ', 'يِ', 'يُ', 'يْ'] }
    ];

    res.json({
      success: true,
      letters: defaultLetters
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/exercises/words/default
// @desc    Get default Libyan dialect words
// @access  Public
router.get('/words/default', async (req, res) => {
  try {
    const defaultWords = [
      // Emotions
      { word: 'فرحان', translation: 'Happy', category: 'emotions' },
      { word: 'حزين', translation: 'Sad', category: 'emotions' },
      { word: 'خايف', translation: 'Scared', category: 'emotions' },
      { word: 'زعلان', translation: 'Upset', category: 'emotions' },

      // Basic needs
      { word: 'جعان', translation: 'Hungry', category: 'needs' },
      { word: 'عطشان', translation: 'Thirsty', category: 'needs' },
      { word: 'نعسان', translation: 'Sleepy', category: 'needs' },
      { word: 'تعبان', translation: 'Tired', category: 'needs' },

      // Actions
      { word: 'ماشي', translation: 'Walking', category: 'actions' },
      { word: 'راكض', translation: 'Running', category: 'actions' },
      { word: 'قاعد', translation: 'Sitting', category: 'actions' },
      { word: 'واقف', translation: 'Standing', category: 'actions' },

      // Family
      { word: 'بابا', translation: 'Dad', category: 'family' },
      { word: 'ماما', translation: 'Mom', category: 'family' },
      { word: 'خويا', translation: 'Brother', category: 'family' },
      { word: 'ختي', translation: 'Sister', category: 'family' }
    ];

    res.json({
      success: true,
      words: defaultWords
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

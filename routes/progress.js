const express = require('express');
const router = express.Router();
const Progress = require('../models/Progress');
const Child = require('../models/Child');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// @route   GET /api/progress/child/:childId
// @desc    Get progress for a child
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

    if (req.user.role === 'specialist') {
      const specialist = await User.findById(req.user.id);
      const linkedParents = (specialist.linkedParents || []).map(id => id.toString());
      const isAssigned = child.assignedSpecialist && child.assignedSpecialist.toString() === req.user.id;
      const isLinked = child.parent && linkedParents.includes(child.parent.toString());

      if (!isAssigned && !isLinked) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    }

    let progress = await Progress.findOne({ child: req.params.childId }).populate('child');

    if (!progress) {
      progress = await Progress.create({ child: req.params.childId });
    }

    res.json({
      success: true,
      progress
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/progress/session
// @desc    Add a new session
// @access  Private (used by child app)
router.post('/session', protect, async (req, res) => {
  try {
    const { childId, sessionData } = req.body;

    let progress = await Progress.findOne({ child: childId });

    if (!progress) {
      progress = await Progress.create({ child: childId });
    }

    progress.sessions.push(sessionData);
    progress.updateOverallStats();
    progress.lastSyncDate = new Date();

    await progress.save();

    res.json({
      success: true,
      progress
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/progress/sync
// @desc    Sync local progress data from child app
// @access  Private
router.post('/sync', protect, async (req, res) => {
  try {
    const { childId, sessions } = req.body;

    let progress = await Progress.findOne({ child: childId });

    if (!progress) {
      progress = await Progress.create({ child: childId });
    }

    // Add new sessions
    sessions.forEach(session => {
      progress.sessions.push(session);
    });

    progress.updateOverallStats();
    progress.lastSyncDate = new Date();

    await progress.save();

    // 🔔 Create Notification for Parent
    try {
      const child = await Child.findById(childId).select('name parent');
      if (child && child.parent) {
        const Notification = require('../models/Notification');
        await Notification.create({
          recipient: child.parent,
          type: 'success', // or 'info'
          title: 'جلسة جديدة مكتملة', // New Session Completed
          message: `أكمل طفلك ${child.name} جلسة تدريبية جديدة بنجاح!`, // Your child X completed a session
          data: {
            childId: child._id,
            progressId: progress._id
          }
        });
      }
    } catch (notifError) {
      console.error('❌ Failed to create notification:', notifError.message);
    }

    // 🚀 Real-time Update: Emit event to all connected clients (Portal & App)
    const io = req.app.get('io');
    if (io) {
      io.emit('progress_updated', {
        childId,
        message: 'New progress data synced',
        timestamp: new Date()
      });
      console.log(`📡 Emitted progress_updated for child ${childId}`);
    }

    res.json({
      success: true,
      message: 'Progress synced successfully',
      progress
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/progress/stats/:childId
// @desc    Get statistics summary for a child
// @access  Private
router.get('/stats/:childId', protect, async (req, res) => {
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

    if (req.user.role === 'specialist') {
      const specialist = await User.findById(req.user.id);
      const linkedParents = (specialist.linkedParents || []).map(id => id.toString());
      const isAssigned = child.assignedSpecialist && child.assignedSpecialist.toString() === req.user.id;
      const isLinked = child.parent && linkedParents.includes(child.parent.toString());

      if (!isAssigned && !isLinked) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    }

    const progress = await Progress.findOne({ child: req.params.childId });

    if (!progress) {
      return res.json({
        success: true,
        stats: {
          totalSessions: 0,
          totalPlayTime: 0,
          totalAttempts: 0,
          successRate: 0,
          averageScore: 0
        }
      });
    }

    res.json({
      success: true,
      stats: progress.overallStats
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/progress/sessions/:childId
// @desc    Get detailed sessions data for charts
// @access  Private
router.get('/sessions/:childId', protect, async (req, res) => {
  try {
    const clamp01 = (n) => {
      const x = Number(n);
      if (!Number.isFinite(x)) return 0;
      return Math.max(0, Math.min(100, x));
    };

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

    if (req.user.role === 'specialist') {
      const specialist = await User.findById(req.user.id);
      const linkedParents = (specialist.linkedParents || []).map(id => id.toString());
      const isAssigned = child.assignedSpecialist && child.assignedSpecialist.toString() === req.user.id;
      const isLinked = child.parent && linkedParents.includes(child.parent.toString());

      if (!isAssigned && !isLinked) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    }

    const progress = await Progress.findOne({ child: req.params.childId });

    if (!progress || !progress.sessions || progress.sessions.length === 0) {
      return res.json({
        success: true,
        sessions: []
      });
    }

    // Return last 30 sessions for charts
    const sessions = progress.sessions
      .slice(-30)
      .map(session => ({
        sessionDate: session.sessionDate,
        duration: session.duration || 0,
        planExerciseId: session.planExerciseId || null,
        planSessionIndex: typeof session.planSessionIndex === 'number' ? session.planSessionIndex : null,
        planSessionName: session.planSessionName || null,
        totalAttempts: session.totalAttempts || 0,
        successfulAttempts: session.successfulAttempts || 0,
        failedAttempts: session.failedAttempts || 0,
        averageScore: clamp01(session.averageScore || 0),
        successRate: session.totalAttempts > 0
          ? clamp01((session.successfulAttempts / session.totalAttempts) * 100)
          : 0
      }));

    res.json({
      success: true,
      sessions
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/progress/attempts/:childId
// @desc    Get recent attempts (flattened across sessions)
// @access  Private
router.get('/attempts/:childId', protect, async (req, res) => {
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

    if (req.user.role === 'specialist') {
      const specialist = await User.findById(req.user.id);
      const linkedParents = (specialist.linkedParents || []).map(id => id.toString());
      const isAssigned = child.assignedSpecialist && child.assignedSpecialist.toString() === req.user.id;
      const isLinked = child.parent && linkedParents.includes(child.parent.toString());

      if (!isAssigned && !isLinked) {
        return res.status(403).json({
          success: false,
          message: 'Not authorized'
        });
      }
    }

    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 200) : 50;

    const progress = await Progress.findOne({ child: req.params.childId }).lean();

    if (!progress || !progress.sessions || progress.sessions.length === 0) {
      return res.json({
        success: true,
        attempts: []
      });
    }

    const attempts = [];
    for (const session of progress.sessions) {
      const sessionDate = session.sessionDate;
      const sessionAttempts = Array.isArray(session.attempts) ? session.attempts : [];
      for (const a of sessionAttempts) {
        const target = a.word || a.letter || a.vowel || '';
        attempts.push({
          sessionDate,
          timestamp: a.timestamp,
          target,
          letter: a.letter,
          word: a.word,
          vowel: a.vowel,
          success: !!a.success,
          // prefer detailed field if provided; fall back to score
          score: typeof a.score === 'number' ? a.score : undefined,
          pronunciationScore: typeof a.pronunciationScore === 'number' ? a.pronunciationScore : undefined,
          accuracyScore: typeof a.accuracyScore === 'number' ? a.accuracyScore : undefined,
          fluencyScore: typeof a.fluencyScore === 'number' ? a.fluencyScore : undefined,
          completenessScore: typeof a.completenessScore === 'number' ? a.completenessScore : undefined,
          recognizedText: a.recognizedText,
          referenceText: a.referenceText,
          analysisSource: a.analysisSource,
        });
      }
    }

    attempts.sort((a, b) => {
      const ta = new Date(a.timestamp || 0).getTime();
      const tb = new Date(b.timestamp || 0).getTime();
      return tb - ta;
    });

    res.json({
      success: true,
      attempts: attempts.slice(0, limit)
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

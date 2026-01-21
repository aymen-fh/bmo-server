const express = require('express');
const router = express.Router();
const Child = require('../models/Child');
const User = require('../models/User');
const Progress = require('../models/Progress');
const { protect, authorize } = require('../middleware/auth');

// @route   POST /api/children
// @desc    Create new child profile
// @access  Private (Parent)
router.post('/', protect, async (req, res) => {
  try {
    console.log('👶 [CHILD ROUTE] POST /api/children called');
    console.log('👶 [CHILD ROUTE] User role:', req.user.role);
    console.log('👶 [CHILD ROUTE] User ID:', req.user.id);

    // Check if user is a parent
    if (req.user.role !== 'parent') {
      console.log('❌ [CHILD ROUTE] User is not a parent, denying access');
      return res.status(403).json({
        success: false,
        message: 'Only parents can create child profiles'
      });
    }

    console.log('✅ [CHILD ROUTE] User is parent, proceeding with child creation');
    const childData = {
      ...req.body,
      parent: req.user.id
    };

    console.log('👶 [CHILD ROUTE] Creating child with data:', childData);
    const child = await Child.create(childData);
    console.log('✅ [CHILD ROUTE] Child created successfully:', child._id);

    // Initialize progress tracking
    console.log('👶 [CHILD ROUTE] Initializing progress tracking...');
    await Progress.create({ child: child._id });
    console.log('✅ [CHILD ROUTE] Progress tracking initialized');

    res.status(201).json({
      success: true,
      child
    });
  } catch (error) {
    console.log('❌ [CHILD ROUTE] Error creating child:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/children
// @desc    Get all children for logged-in user
// @access  Private
router.get('/', protect, async (req, res) => {
  try {
    console.log('👶 [CHILD ROUTE] GET /api/children called');
    console.log('👶 [CHILD ROUTE] User role:', req.user.role);
    console.log('👶 [CHILD ROUTE] User ID:', req.user.id);

    let children;

    if (req.user.role === 'parent') {
      console.log('👶 [CHILD ROUTE] Fetching children for parent (no active filter)...');
      // جلب جميع الأطفال المرتبطين بالparent بدون فلترة active
      children = await Child.find({ parent: req.user.id })
        .populate('assignedSpecialist', 'name email specialization phone profilePhoto')
        .populate({
          path: 'assignedSpecialist',
          populate: { path: 'center', select: 'name nameEn' }
        });
      console.log('✅ [CHILD ROUTE] Found', children.length, 'children for parent');
    } else if (req.user.role === 'specialist') {
      console.log('👶 [CHILD ROUTE] Fetching children for specialist...');
      children = await Child.find({ assignedSpecialist: req.user.id }).populate('parent', 'name email phone profilePhoto');
      console.log('✅ [CHILD ROUTE] Found', children.length, 'children for specialist');
    } else {
      console.log('❌ [CHILD ROUTE] Unknown user role:', req.user.role);
      return res.status(403).json({
        success: false,
        message: 'Invalid user role'
      });
    }

    res.json({
      success: true,
      count: children.length,
      children
    });
  } catch (error) {
    console.log('❌ [CHILD ROUTE] Error fetching children:', error.message);
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/children/:id
// @desc    Get single child by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
  try {
    const child = await Child.findById(req.params.id)
      .populate('parent', 'name email phone photo')
      .populate({
        path: 'assignedSpecialist',
        select: 'name email phone profilePhoto specialization center',
        populate: {
          path: 'center',
          select: 'name nameEn'
        }
      });

    if (!child) {
      return res.status(404).json({
        success: false,
        message: 'Child not found'
      });
    }

    // Check authorization
    if (req.user.role === 'parent' && child.parent._id.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (req.user.role === 'specialist' && (!child.assignedSpecialist || child.assignedSpecialist._id.toString() !== req.user.id)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    res.json({
      success: true,
      child
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   PUT /api/children/:id
// @desc    Update child profile
// @access  Private
router.put('/:id', protect, async (req, res) => {
  try {
    let child = await Child.findById(req.params.id);

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
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    child = await Child.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    });

    res.json({
      success: true,
      child
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   DELETE /api/children/:id
// @desc    Delete child profile
// @access  Private (Parent)
router.delete('/:id', protect, authorize('parent'), async (req, res) => {
  try {
    const child = await Child.findById(req.params.id);

    if (!child) {
      return res.status(404).json({
        success: false,
        message: 'Child not found'
      });
    }

    if (child.parent.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await child.deleteOne();

    res.json({
      success: true,
      message: 'Child deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/children/:id/request-specialist
// @desc    Request specialist assignment
// @access  Private (Parent)
router.post('/:id/request-specialist', protect, authorize('parent'), async (req, res) => {
  try {
    const child = await Child.findById(req.params.id);

    if (!child) {
      return res.status(404).json({
        success: false,
        message: 'Child not found'
      });
    }

    if (child.parent.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    child.specialistRequestStatus = 'pending';
    await child.save();

    res.json({
      success: true,
      message: 'Specialist request submitted',
      child
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;

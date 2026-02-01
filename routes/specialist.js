const express = require('express');
const router = express.Router();
const Specialist = require('../models/Specialist');
const Parent = require('../models/Parent');
const Child = require('../models/Child');
const LinkRequest = require('../models/LinkRequest');
const { protect, authorize } = require('../middleware/auth');
const Notification = require('../models/Notification');

// @route   GET /api/specialists/pending-requests
// @desc    Get children with pending specialist requests
// @access  Private (Specialist)
router.get('/pending-requests', protect, authorize('specialist'), async (req, res) => {
  try {
    const children = await Child.find({ specialistRequestStatus: 'pending' })
      .populate('parent', 'name email phone profilePhoto');

    res.json({
      success: true,
      count: children.length,
      children
    });
  } catch (error) {
    if (error?.code === 11000 && (error?.keyPattern?.childId || error?.keyValue?.childId)) {
      return res.status(409).json({
        success: false,
        message: 'Duplicate child ID detected. Please try again.'
      });
    }

    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/specialists/accept-child/:childId
// @desc    Accept child assignment
// @access  Private (Specialist)
router.post('/accept-child/:childId', protect, authorize('specialist'), async (req, res) => {
  try {
    const child = await Child.findById(req.params.childId);

    if (!child) {
      return res.status(404).json({
        success: false,
        message: 'Child not found'
      });
    }

    if (child.specialistRequestStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'No pending request for this child'
      });
    }

    child.assignedSpecialist = req.user.id;
    child.specialistRequestStatus = 'approved';
    await child.save();

    // Add child to specialist's assigned children
    await Specialist.findByIdAndUpdate(req.user.id, {
      $addToSet: { assignedChildren: child._id }
    });

    res.json({
      success: true,
      message: 'Child assignment accepted',
      child
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/specialists/reject-child/:childId
// @desc    Reject child assignment
// @access  Private (Specialist)
router.post('/reject-child/:childId', protect, authorize('specialist'), async (req, res) => {
  try {
    const child = await Child.findById(req.params.childId);

    if (!child) {
      return res.status(404).json({
        success: false,
        message: 'Child not found'
      });
    }

    child.specialistRequestStatus = 'rejected';
    await child.save();

    res.json({
      success: true,
      message: 'Child assignment rejected',
      child
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/specialists/set-duration/:childId
// @desc    Set daily play duration for child
// @access  Private (Specialist)
router.post('/set-duration/:childId', protect, authorize('specialist'), async (req, res) => {
  try {
    const { dailyPlayDuration, sessionStructure, playSchedule } = req.body;

    const child = await Child.findById(req.params.childId);

    if (!child) {
      return res.status(404).json({
        success: false,
        message: 'Child not found'
      });
    }

    const isAssigned = child.assignedSpecialist && child.assignedSpecialist.toString() === req.user.id;

    if (!isAssigned) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (typeof dailyPlayDuration === 'number') {
      child.dailyPlayDuration = dailyPlayDuration;
    }

    if (sessionStructure && typeof sessionStructure === 'object') {
      child.sessionStructure = {
        ...(child.sessionStructure || {}),
        ...sessionStructure,
      };
    }

    if (playSchedule && typeof playSchedule === 'object') {
      child.playSchedule = {
        ...(child.playSchedule || {}),
        ...playSchedule,
      };
    }

    await child.save();

    // 🔔 Create Notification for Parent (if child has parent)
    try {
      if (child.parent) {
        const specialist = await Specialist.findById(req.user.id);
        const Notification = require('../models/Notification');
        await Notification.create({
          recipient: child.parent,
          type: 'info',
          title: 'تحديث الخطة العلاجية',
          message: `قام الأخصائي ${specialist.name} بتحديث إعدادات الجلسة لطفلك ${child.name}.`,
          data: {
            childId: child._id,
            specialistId: specialist._id
          }
        });
      }
    } catch (notifError) {
      console.error('❌ Failed to create notification:', notifError.message);
    }

    res.json({
      success: true,
      message: 'Settings updated successfully',
      child
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/specialists/search-parent
// @desc    Search for parents by email or name (partial match), or get all available parents
// @access  Private (Specialist)
router.get('/search-parent', protect, authorize('specialist'), async (req, res) => {
  try {
    const { email, query } = req.query;
    const specialist = await Specialist.findById(req.user.id);
    const linkedParentIds = specialist.linkedParents || [];

    let searchQuery = {
      _id: { $nin: linkedParentIds } // Exclude already linked parents
    };

    // If email is provided, search by exact or partial email
    if (email) {
      searchQuery.email = { $regex: email.toLowerCase(), $options: 'i' };
    }

    // If query is provided, search by name or email
    if (query) {
      searchQuery.$or = [
        { email: { $regex: query.toLowerCase(), $options: 'i' } },
        { name: { $regex: query, $options: 'i' } }
      ];
      delete searchQuery.email; // Remove email filter if using $or
    }

    const parents = await Parent.find(searchQuery)
      .select('_id name email phone profilePhoto')
      .limit(20); // Limit results

    res.json({
      success: true,
      count: parents.length,
      parents
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/specialists/link-parent
// @desc    Link a parent to the specialist
// @access  Private (Specialist)
router.post('/link-parent', protect, authorize('specialist'), async (req, res) => {
  try {
    const { parentId } = req.body;

    if (!parentId) {
      return res.status(400).json({
        success: false,
        message: 'Parent ID is required'
      });
    }

    const parent = await Parent.findById(parentId);

    if (!parent) {
      return res.status(404).json({
        success: false,
        message: 'Parent not found'
      });
    }

    // Check if already linked
    const specialist = await Specialist.findById(req.user.id);
    if (specialist.linkedParents && specialist.linkedParents.includes(parentId)) {
      return res.status(400).json({
        success: false,
        message: 'Parent already linked to this specialist'
      });
    }

    // Link parent to specialist
    await Specialist.findByIdAndUpdate(req.user.id, {
      $addToSet: { linkedParents: parentId }
    });

    // Update parent's linkedSpecialist
    await Parent.findByIdAndUpdate(parentId, {
      linkedSpecialist: req.user.id
    });

    res.json({
      success: true,
      message: 'Parent linked successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   DELETE /api/specialists/unlink-parent/:parentId
// @desc    Unlink a parent from the specialist
// @access  Private (Specialist)
router.delete('/unlink-parent/:parentId', protect, authorize('specialist'), async (req, res) => {
  try {
    const { parentId } = req.params;

    // Remove parent from specialist's linkedParents
    await Specialist.findByIdAndUpdate(req.user.id, {
      $pull: { linkedParents: parentId }
    });

    // Remove specialist from parent's linkedSpecialist
    await Parent.findByIdAndUpdate(parentId, {
      linkedSpecialist: null
    });

      // Unassign all children of this parent from the specialist
      await Child.updateMany(
        { parent: parentId, assignedSpecialist: req.user.id },
        { $set: { assignedSpecialist: null, specialistRequestStatus: 'none' } }
      );

    res.json({
      success: true,
      message: 'Parent unlinked successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/specialists/parents
// @desc    Get all linked parents for the specialist
// @access  Private (Specialist)
router.get('/parents', protect, authorize('specialist'), async (req, res) => {
  try {
    const specialist = await Specialist.findById(req.user.id)
      .populate({
        path: 'linkedParents',
        select: '_id name email phone profilePhoto'
      });

    res.json({
      success: true,
      parents: specialist.linkedParents || []
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/specialists/create-parent
// @desc    Create a new parent account by specialist
// @access  Private (Specialist)
router.post('/create-parent', protect, authorize('specialist'), async (req, res) => {
  try {
    const { name, email, password, phone } = req.body;

    // Validate required fields
    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email and password are required'
      });
    }

    // Check if user already exists in any collection
    const emailLower = email.toLowerCase();
    const [existingParent, existingSpecialist, existingAdmin] = await Promise.all([
      Parent.findOne({ email: emailLower }),
      Specialist.findOne({ email: emailLower }),
      require('../models/Admin').findOne({ email: emailLower })
    ]);

    if (existingParent || existingSpecialist || existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Create the parent account
    const parent = await Parent.create({
      name,
      email: emailLower,
      password,
      phone,
      emailVerified: true, // Auto-verify since specialist created it
      linkedSpecialist: req.user.id
    });

    // Add parent to specialist's linkedParents
    await Specialist.findByIdAndUpdate(req.user.id, {
      $addToSet: { linkedParents: parent._id }
    });

    res.status(201).json({
      success: true,
      parent: {
        id: parent._id,
        name: parent.name,
        email: parent.email,
        phone: parent.phone
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/specialists/create-child
// @desc    Create a child account for a parent
// @access  Private (Specialist)
router.post('/create-child', protect, authorize('specialist'), async (req, res) => {
  try {
    const { parentId, name, age, gender, targetLetters, targetWords, difficultyLevel } = req.body;

    // Validate required fields
    if (!parentId || !name || !age || !gender) {
      return res.status(400).json({
        success: false,
        message: 'Parent ID, name, age and gender are required'
      });
    }

    // Verify parent exists and is linked to specialist
    const specialist = await Specialist.findById(req.user.id);
    if (!specialist.linkedParents || !specialist.linkedParents.includes(parentId)) {
      return res.status(403).json({
        success: false,
        message: 'Parent is not linked to this specialist'
      });
    }

    // Get parent details for email
    const parent = await Parent.findById(parentId);

    // Create the child
    const child = await Child.create({
      name,
      age,
      gender,
      parent: parentId,
      assignedSpecialist: req.user.id,
      specialistRequestStatus: 'approved',
      targetLetters: targetLetters || [],
      targetWords: targetWords || [],
      difficultyLevel: difficultyLevel || 'beginner'
    });

    // Add child to specialist's assignedChildren
    await Specialist.findByIdAndUpdate(req.user.id, {
      $addToSet: { assignedChildren: child._id }
    });

    // Create referral record to track this specialist-parent linkage
    const Referral = require('../models/Referral');
    try {
      await Referral.create({
        parent: parentId,
        specialist: req.user.id,
        referralType: 'specialist_created',
        status: 'active',
        notes: `Child ${child.name} created by specialist for parent`
      });
      console.log(`📝 Referral record created for parent ${parentId} and specialist ${req.user.id}`);
    } catch (referralError) {
      console.error('❌ Failed to create referral record:', referralError.message);
      // Don't fail the request if referral creation fails
    }

    const Notification = require('../models/Notification'); // Ensure this is imported at top, but for now I'll use it here or add to top.

    // Create in-app notification for parent
    try {
      await Notification.create({
        recipient: parentId,
        type: 'child_assigned', // or 'success'
        title: 'New Child Profile Created',
        message: `A new profile for child ${child.name} has been created by specialist ${specialist.name}.`,
        data: {
          childId: child._id,
          specialistId: specialist._id
        }
      });
      console.log(`🔔 Notification created for parent ${parentId}`);
    } catch (notifError) {
      console.error('❌ Failed to create notification:', notifError.message);
    }

    res.status(201).json({
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

// @route   GET /api/specialists/my-children
// @desc    Get all children assigned to the specialist
// @access  Private (Specialist)
router.get('/my-children', protect, authorize('specialist'), async (req, res) => {
  try {
    const children = await Child.find({
      assignedSpecialist: req.user.id
    }).populate('parent', 'name email phone profilePhoto');

    res.json({
      success: true,
      count: children.length,
      children
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ========================================
// PARENT LINK REQUESTS HANDLING
// ========================================

// @route   GET /api/specialists/link-requests
// @desc    Get all link requests sent to the specialist
// @access  Private (Specialist)
router.get('/link-requests', protect, authorize('specialist'), async (req, res) => {
  try {
    const { status } = req.query;

    let query = { to: req.user.id };
    if (status) {
      query.status = status;
    }

    const requests = await LinkRequest.find(query)
      .populate('from', 'name email phone')
      .populate('child', 'name age gender')
      .sort('-createdAt');

    res.json({
      success: true,
      count: requests.length,
      requests
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/specialists/accept-link-request/:requestId
// @desc    Accept a link request from a parent
// @access  Private (Specialist)
router.post('/accept-link-request/:requestId', protect, authorize('specialist'), async (req, res) => {
  try {
    const request = await LinkRequest.findById(req.params.requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Check that request is for this specialist
    if (request.to.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Check if request is still pending
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Request is no longer pending'
      });
    }

    // Check if parent is already linked to another specialist
    const parent = await Parent.findById(request.from);
    if (parent.linkedSpecialist && parent.linkedSpecialist.toString() !== req.user.id) {
      return res.status(400).json({
        success: false,
        message: 'Parent is already linked to another specialist'
      });
    }

    // Update request status
    request.status = 'accepted';
    await request.save();

    // Link parent to specialist
    await Specialist.findByIdAndUpdate(req.user.id, {
      $addToSet: { linkedParents: request.from }
    });

    // Update parent's linkedSpecialist
    await Parent.findByIdAndUpdate(request.from, {
      linkedSpecialist: req.user.id
    });

    // If request includes a child, assign that child to this specialist
    if (request.child) {
      const child = await Child.findById(request.child);
      if (child) {
        child.assignedSpecialist = req.user.id;
        child.specialistRequestStatus = 'approved';
        await child.save();

        await Specialist.findByIdAndUpdate(req.user.id, {
          $addToSet: { assignedChildren: child._id }
        });
      }
    }

    // 🔔 Create Notification for Parent
    try {
      const specialist = await Specialist.findById(req.user.id);
      await Notification.create({
        recipient: request.from,
        type: 'success',
        title: 'تم قبول طلب الربط',
        message: `وافق الأخصائي ${specialist.name} على طلب الربط الخاص بك.`,
        data: {
          specialistId: specialist._id
        }
      });
    } catch (notifError) {
      console.error('❌ Failed to create notification:', notifError.message);
    }

    // Cancel any other pending requests from this parent
    await LinkRequest.updateMany(
      { from: request.from, status: 'pending', _id: { $ne: request._id } },
      { status: 'rejected' }
    );

    res.json({
      success: true,
      message: 'Link request accepted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   POST /api/specialists/reject-link-request/:requestId
// @desc    Reject a link request from a parent
// @access  Private (Specialist)
router.post('/reject-link-request/:requestId', protect, authorize('specialist'), async (req, res) => {
  try {
    const request = await LinkRequest.findById(req.params.requestId);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: 'Request not found'
      });
    }

    // Check that request is for this specialist
    if (request.to.toString() !== req.user.id) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    // Check if request is still pending
    if (request.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: 'Request is no longer pending'
      });
    }

    // Update request status
    request.status = 'rejected';
    await request.save();

    res.json({
      success: true,
      message: 'Link request rejected'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// @route   GET /api/specialists/pending-link-requests-count
// @desc    Get count of pending link requests (for badge notification)
// @access  Private (Specialist)
router.get('/pending-link-requests-count', protect, authorize('specialist'), async (req, res) => {
  try {
    const count = await LinkRequest.countDocuments({
      to: req.user.id,
      status: 'pending'
    });

    res.json({
      success: true,
      count
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

module.exports = router;


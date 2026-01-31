const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Specialist = require('../models/Specialist');
const Parent = require('../models/Parent');
const Center = require('../models/Center');
const LinkRequest = require('../models/LinkRequest');
const { protect, authorize } = require('../middleware/auth');

// Middleware to check admin has access to center
const checkCenterAccess = async (req, res, next) => {
    if (!req.user.center) {
        return res.status(403).json({
            success: false,
            message: 'لا يوجد مركز مرتبط بحسابك'
        });
    }

    const center = await Center.findById(req.user.center);
    if (!center || !center.admin || center.admin.toString() !== req.user.id) {
        return res.status(403).json({
            success: false,
            message: 'غير مصرح للوصول إلى هذا المركز'
        });
    }

    req.center = center;
    next();
};

// ========================================
// CENTER INFO
// ========================================

// @route   GET /api/admin/center
// @desc    Get admin's center details
// @access  Private (Admin)
router.get('/center', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const center = await Center.findById(req.user.center)
            .populate('specialists', 'name email phone specialization linkedParents assignedChildren');

        res.json({
            success: true,
            center
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ========================================
// SPECIALIST MANAGEMENT
// ========================================

// @route   GET /api/admin/specialists
// @desc    Get all specialists in the center
// @access  Private (Admin)
router.get('/specialists', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        // Optimized: Use lean() and avoid populating full objects just for counts
        const specialists = await User.find({
            center: req.user.center,
            role: 'specialist'
        })
            .select('name email phone specialization linkedParents assignedChildren profilePhoto staffId')
            .lean();

        res.json({
            success: true,
            count: specialists.length,
            specialists
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   POST /api/admin/create-specialist
// @desc    Create new specialist in the center
// @access  Private (Admin)
router.post('/create-specialist', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const { name, email, password, phone, specialization, licenseNumber } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'البريد الإلكتروني مستخدم بالفعل'
            });
        }

        // Create specialist
        const specialist = await User.create({
            name,
            email: email.toLowerCase(),
            password,
            phone,
            role: 'specialist',
            specialization,
            licenseNumber,
            center: req.user.center,
            createdBy: req.user.id,
            emailVerified: true
        });

        // Add specialist to center
        await Center.findByIdAndUpdate(req.user.center, {
            $addToSet: { specialists: specialist._id }
        });

        res.status(201).json({
            success: true,
            message: 'تم إنشاء حساب الأخصائي بنجاح',
            specialist: {
                id: specialist._id,
                name: specialist.name,
                email: specialist.email,
                phone: specialist.phone,
                specialization: specialist.specialization
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   PUT /api/admin/specialists/:id
// @desc    Update specialist
// @access  Private (Admin)
router.put('/specialists/:id', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const { name, phone, specialization, licenseNumber } = req.body;

        const specialist = await User.findById(req.params.id);

        if (!specialist || specialist.role !== 'specialist') {
            return res.status(404).json({
                success: false,
                message: 'الأخصائي غير موجود'
            });
        }

        // Verify specialist belongs to admin's center
        if (!specialist.center || specialist.center.toString() !== req.user.center.toString()) {
            return res.status(403).json({
                success: false,
                message: 'غير مصرح للوصول إلى هذا الأخصائي'
            });
        }

        if (name) specialist.name = name;
        if (phone !== undefined) specialist.phone = phone;
        if (specialization !== undefined) specialist.specialization = specialization;
        if (licenseNumber !== undefined) specialist.licenseNumber = licenseNumber;

        await specialist.save();

        res.json({
            success: true,
            message: 'تم تحديث الأخصائي بنجاح',
            specialist: {
                id: specialist._id,
                name: specialist.name,
                email: specialist.email,
                phone: specialist.phone,
                specialization: specialist.specialization
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   DELETE /api/admin/specialists/:id
// @desc    Remove specialist from center
// @access  Private (Admin)
router.delete('/specialists/:id', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const specialist = await User.findById(req.params.id);

        if (!specialist || specialist.role !== 'specialist') {
            return res.status(404).json({
                success: false,
                message: 'الأخصائي غير موجود'
            });
        }

        // Verify specialist belongs to admin's center
        if (!specialist.center || specialist.center.toString() !== req.user.center.toString()) {
            return res.status(403).json({
                success: false,
                message: 'غير مصرح للوصول إلى هذا الأخصائي'
            });
        }

        // Remove specialist from center
        await Center.findByIdAndUpdate(req.user.center, {
            $pull: { specialists: specialist._id }
        });

        // Clear center reference from specialist
        specialist.center = null;
        await specialist.save();

        res.json({
            success: true,
            message: 'تم إزالة الأخصائي من المركز بنجاح'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ========================================
// ADMIN - SPECIALIST FUNCTIONALITY
// (Admin can do everything a specialist can)
// ========================================

// @route   GET /api/admin/parents
// @desc    Get all parents in the center (linked to any specialist in the center)
// @access  Private (Admin)
router.get('/parents', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        // Get all specialists in the center
        const specialists = await User.find({
            center: req.user.center,
            role: 'specialist'
        }).select('_id');

        const specialistIds = specialists.map(s => s._id);
        // Include admin itself (admins can also act as specialists)
        specialistIds.push(req.user.id);

        // Get all parents linked to any specialist in the center
        const parents = await User.find({
            linkedSpecialist: { $in: specialistIds },
            role: 'parent'
        }).select('_id name email phone profilePhoto');

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

// @route   GET /api/admin/my-children
// @desc    Get all children in the center (assigned to any specialist in the center)
// @access  Private (Admin)
router.get('/my-children', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        // Get all specialists in the center
        const specialists = await User.find({
            center: req.user.center,
            role: 'specialist'
        }).select('_id');

        const specialistIds = specialists.map(s => s._id);
        // Include admin itself (admins can also act as specialists)
        specialistIds.push(req.user.id);

        // Get all children assigned to any specialist in the center
        const children = await Child.find({
            assignedSpecialist: { $in: specialistIds }
        })
            .populate('parent', 'name email phone profilePhoto')
            .populate('assignedSpecialist', 'name specialization');

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

// @route   GET /api/admin/link-requests
// @desc    Get all link requests sent to admin (as specialist)
// @access  Private (Admin)
router.get('/link-requests', protect, authorize('admin'), async (req, res) => {
    try {
        const { status } = req.query;

        let query = { to: req.user.id };
        if (status) {
            query.status = status;
        }

        const requests = await LinkRequest.find(query)
            .populate('from', 'name email phone')
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

// ========================================
// STATISTICS
// ========================================

// @route   GET /api/admin/stats
// @desc    Get center statistics
// @access  Private (Admin)
router.get('/stats', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        // Get all specialists in the center
        const specialists = await User.find({
            center: req.user.center,
            role: 'specialist'
        }).select('_id');

        const specialistIds = specialists.map(s => s._id);
        // Include admin itself (admins can also act as specialists)
        specialistIds.push(req.user.id);

        // Count all entities in the center
        const [specialistsCount, parentsCount, childrenCount] = await Promise.all([
            User.countDocuments({ center: req.user.center, role: 'specialist' }),
            User.countDocuments({ linkedSpecialist: { $in: specialistIds }, role: 'parent' }),
            Child.countDocuments({ assignedSpecialist: { $in: specialistIds } })
        ]);

        // Get recent specialists (Top 5)
        const recentSpecialists = await User.find({
            center: req.user.center,
            role: 'specialist'
        })
            .sort({ createdAt: -1 })
            .limit(5)
            .select('name email specialization profilePhoto staffId')
            .lean();

        res.json({
            success: true,
            stats: {
                centerSpecialists: specialistsCount,
                myParents: parentsCount,
                myChildren: childrenCount,
                centerChildren: childrenCount // Same as myChildren now (all center children)
            },
            recentSpecialists
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Specialist = require('../models/Specialist');
const Parent = require('../models/Parent');
const User = require('../models/User');
const Child = require('../models/Child'); // Added Child model
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

const updateCenterHandler = async (req, res) => {
    try {
        const { name, nameEn, address, phone, email, description, isActive } = req.body;

        const center = await Center.findById(req.user.center);
        if (!center) {
            return res.status(404).json({ success: false, message: 'المركز غير موجود' });
        }

        if (name !== undefined) center.name = name;
        if (nameEn !== undefined) center.nameEn = nameEn;
        if (address !== undefined) center.address = address;
        if (phone !== undefined) center.phone = phone;
        if (email !== undefined) center.email = email;
        if (description !== undefined) center.description = description;
        if (isActive !== undefined) center.isActive = isActive;

        await center.save();

        res.json({ success: true, message: 'تم تحديث بيانات المركز', center });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

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

// @route   PUT /api/admin/center
// @desc    Update admin's center details
// @access  Private (Admin)
router.put('/center', protect, authorize('admin'), checkCenterAccess, updateCenterHandler);

// @route   POST /api/admin/center
// @desc    Update admin's center details (POST fallback)
// @access  Private (Admin)
router.post('/center', protect, authorize('admin'), checkCenterAccess, updateCenterHandler);

// ========================================
// SPECIALIST MANAGEMENT
// ========================================

// @route   GET /api/admin/specialists
// @desc    Get all specialists in the center
// @access  Private (Admin)
router.get('/specialists', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const specialists = await Specialist.find({
            center: req.user.center
        })
            .populate('linkedParents', 'name email')
            .select('name email phone specialization linkedParents assignedChildren profilePhoto staffId createdAt')
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

// @route   GET /api/admin/specialists/:id
// @desc    Get single specialist details
// @access  Private (Admin)
router.get('/specialists/:id', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const specialist = await Specialist.findById(req.params.id)
            .populate('linkedParents', 'name email phone profilePhoto');

        if (!specialist || specialist.center.toString() !== req.user.center.toString()) {
            return res.status(404).json({
                success: false,
                message: 'الأخصائي غير موجود'
            });
        }

        // Support legacy data where specialists may exist in User collection
        const legacySpecialist = await User.findOne({
            role: 'specialist',
            $or: [
                { email: specialist.email },
                { staffId: specialist.staffId }
            ]
        }).select('_id linkedParents');

        const specialistIds = [specialist._id];
        if (legacySpecialist && String(legacySpecialist._id) !== String(specialist._id)) {
            specialistIds.push(legacySpecialist._id);
        }

        const linkedParentsFromSpecialist = (specialist.linkedParents || []).map(p => (p?._id || p));
        const linkedParentsFromLegacy = (legacySpecialist?.linkedParents || []).map(p => (p?._id || p));

        const parentIds = await Parent.find({
            linkedSpecialist: { $in: specialistIds }
        }).select('_id');

        const parentIdList = [
            ...parentIds.map(p => p._id),
            ...linkedParentsFromSpecialist,
            ...linkedParentsFromLegacy
        ];

        const assignedChildren = await Child.find({
            $or: [
                { assignedSpecialist: { $in: specialistIds } },
                { parent: { $in: parentIdList } }
            ]
        })
            .select('name age gender parent avatarId assignedSpecialist')
            .populate('parent', 'name email phone profilePhoto')
            .populate('assignedSpecialist', 'name email');

        const specialistData = specialist.toObject();
        specialistData.assignedChildren = assignedChildren || [];

        res.json({
            success: true,
            specialist: specialistData
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

        // Check if user already exists in ANY collection
        const emailLower = email.toLowerCase();
        const existingSpecialist = await Specialist.findOne({ email: emailLower });
        const existingParent = await Parent.findOne({ email: emailLower });
        const existingAdmin = await Admin.findOne({ email: emailLower });

        if (existingSpecialist || existingParent || existingAdmin) {
            return res.status(400).json({
                success: false,
                message: 'البريد الإلكتروني مستخدم بالفعل'
            });
        }

        // Create specialist
        const specialist = await Specialist.create({
            name,
            email: emailLower,
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

        const specialist = await Specialist.findById(req.params.id);

        if (!specialist) {
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
        const specialist = await Specialist.findById(req.params.id);

        if (!specialist) {
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
        specialist.center = undefined;
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
// LINKING / UNLINKING FUNCTIONALITY
// ========================================

// @route   POST /api/admin/specialists/:id/link-parent
// @desc    Link a parent to a specialist
// @access  Private (Admin)
router.post('/specialists/:id/link-parent', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const { parentId } = req.body;
        const specialistId = req.params.id;

        const specialist = await Specialist.findById(specialistId);
        if (!specialist) {
            return res.status(404).json({ success: false, message: 'الأخصائي غير موجود' });
        }

        if (String(specialist.center) !== String(req.user.center)) {
            return res.status(403).json({ success: false, message: 'غير مصرح للوصول' });
        }

        const parent = await Parent.findById(parentId);
        if (!parent) {
            return res.status(404).json({ success: false, message: 'ولي الأمر غير موجود' });
        }

        // Add to specialist's linkedParents
        await Specialist.findByIdAndUpdate(specialistId, {
            $addToSet: { linkedParents: parentId }
        });

        // Set parent's linkedSpecialist
        await Parent.findByIdAndUpdate(parentId, {
            linkedSpecialist: specialistId
        });

        res.json({ success: true, message: 'تم ربط ولي الأمر بالأخصائي' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/admin/specialists/:id/unlink-parent/:parentId
// @desc    Unlink a parent from a specialist
// @access  Private (Admin)
router.post('/specialists/:id/unlink-parent/:parentId', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const { id: specialistId, parentId } = req.params;

        const specialist = await Specialist.findById(specialistId);
        if (!specialist) {
            return res.status(404).json({ success: false, message: 'الأخصائي غير موجود' });
        }

        if (String(specialist.center) !== String(req.user.center)) {
            return res.status(403).json({ success: false, message: 'غير مصرح للوصول' });
        }

        // Prevent Unlinking if we are just calling DELETE endpoint semantics
        // Actually this is a POST to perform action

        await Specialist.findByIdAndUpdate(specialistId, {
            $pull: { linkedParents: parentId }
        });

        await Parent.findByIdAndUpdate(parentId, {
            linkedSpecialist: null
        });

        res.json({ success: true, message: 'تم إلغاء ربط ولي الأمر' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/admin/specialists/:id/link-child
// @desc    Assign a child to a specialist
// @access  Private (Admin)
router.post('/specialists/:id/link-child', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const { childId } = req.body;
        const specialistId = req.params.id;

        const specialist = await Specialist.findById(specialistId);
        if (!specialist || String(specialist.center) !== String(req.user.center)) {
            return res.status(403).json({ success: false, message: 'غير مصرح للوصول' });
        }

        const child = await Child.findById(childId);
        if (!child) {
            return res.status(404).json({ success: false, message: 'الطفل غير موجود' });
        }

        child.assignedSpecialist = specialistId;
        await child.save();

        res.json({ success: true, message: 'تم تعيين الطفل للأخصائي' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/admin/specialists/:id/unlink-child/:childId
// @desc    Unassign a child from a specialist
// @access  Private (Admin)
router.post('/specialists/:id/unlink-child/:childId', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const { id: specialistId, childId } = req.params;

        const specialist = await Specialist.findById(specialistId);
        if (!specialist || String(specialist.center) !== String(req.user.center)) {
            return res.status(403).json({ success: false, message: 'غير مصرح للوصول' });
        }

        const child = await Child.findById(childId);
        if (!child) return res.status(404).json({ success: false, message: 'الطفل غير موجود' });

        child.assignedSpecialist = undefined;
        await child.save();

        res.json({ success: true, message: 'تم إلغاء تعيين الطفل' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// ========================================
// ADMIN - SPECIALIST FUNCTIONALITY
// ========================================

// @route   GET /api/admin/parents
// @desc    Get all parents in the center
// @access  Private (Admin)
router.get('/parents', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const specialists = await Specialist.find({ center: req.user.center }).select('_id');
        const specialistIds = specialists.map(s => s._id);

        // Find parents linked to these specialists
        const parents = await Parent.find({
            linkedSpecialist: { $in: specialistIds }
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
// @desc    Get all children in the center
// @access  Private (Admin)
router.get('/my-children', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const specialists = await Specialist.find({ center: req.user.center }).select('_id linkedParents');
        const specialistIds = specialists.map(s => s._id);
        const linkedParentIds = new Set();
        specialists.forEach(s => {
            (s.linkedParents || []).forEach(p => linkedParentIds.add(p.toString()));
        });

        const children = await Child.find({
            $or: [
                { assignedSpecialist: { $in: specialistIds } },
                { parent: { $in: Array.from(linkedParentIds) } }
            ]
        })
            .populate({
                path: 'parent',
                select: 'name email phone profilePhoto linkedSpecialist',
                populate: { path: 'linkedSpecialist', select: 'name email' }
            })
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
// @desc    Get all link requests sent to admin (for center specialists)
// @access  Private (Admin)
router.get('/link-requests', protect, authorize('admin'), async (req, res) => {
    try {
        const { status } = req.query;

        // Admin sees requests addressed to them (to: req.user.id)
        let query = { to: req.user.id };
        if (status) query.status = status;

        const requests = await LinkRequest.find(query)
            .populate('from', 'name email phone') // 'from' is usually a Specialist
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
        const specialists = await Specialist.find({ center: req.user.center }).select('_id');
        const specialistIds = specialists.map(s => s._id);

        const [specialistsCount, parentsCount, childrenCount] = await Promise.all([
            Specialist.countDocuments({ center: req.user.center }),
            Parent.countDocuments({ linkedSpecialist: { $in: specialistIds } }),
            Child.countDocuments({ assignedSpecialist: { $in: specialistIds } })
        ]);

        const recentSpecialists = await Specialist.find({ center: req.user.center })
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
                centerChildren: childrenCount
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

// Search parents for specialist linkage
router.get('/specialists/:id/search-parents', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const { search } = req.query;
        if (!search) return res.json({ success: true, parents: [] });

        const searchRegex = new RegExp(search, 'i');

        // Find parents matching search who are NOT linked to any specialist yet
        // OR we can allow re-linking. Let's assume re-linking is allowed but warn.
        // Usually, we only want available parents.

        const parents = await Parent.find({
            $or: [{ name: searchRegex }, { email: searchRegex }]
        })
            .select('name email phone linkedSpecialist')
            .limit(10);

        res.json({ success: true, parents });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// DASHBOARD STATS
// ========================================

// @route   GET /api/admin/stats
// @desc    Get dashboard statistics for admin
// @access  Private (Admin)
router.get('/stats', protect, authorize('admin'), async (req, res) => {
    try {
        let stats = {
            specialists: 0,
            parents: 0,
            children: 0,
            centerSpecialists: 0,
            myParents: 0,
            centerChildren: 0,
            myChildren: 0
        };
        let recentSpecialists = [];

        if (req.user.center) {
            // Count specialists in center
            const specialistsCount = await Specialist.countDocuments({ center: req.user.center });
            stats.specialists = specialistsCount;
            stats.centerSpecialists = specialistsCount;

            // Get recent specialists
            recentSpecialists = await Specialist.find({ center: req.user.center })
                .select('name email createdAt profilePhoto')
                .sort('-createdAt')
                .limit(5)
                .lean();

            // Count all children assigned to specialists in this center
            const centerSpecialists = await Specialist.find({ center: req.user.center }).select('_id');
            const specialistIds = centerSpecialists.map(s => s._id);
            const childrenCount = await Child.countDocuments({
                assignedSpecialist: { $in: specialistIds }
            });
            stats.children = childrenCount;
            stats.centerChildren = childrenCount;

            // Count parents linked to specialists in this center
            const allSpecialists = await Specialist.find({ center: req.user.center }).select('linkedParents');
            const parentIdsSet = new Set();
            allSpecialists.forEach(s => {
                if (s.linkedParents && Array.isArray(s.linkedParents)) {
                    s.linkedParents.forEach(p => parentIdsSet.add(p.toString()));
                }
            });
            stats.parents = parentIdsSet.size;
            stats.myParents = parentIdsSet.size;
        }

        res.json({
            success: true,
            stats,
            recentSpecialists
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   GET /api/admin/parents
// @desc    Get all parents linked to specialists in this center
// @access  Private (Admin)
router.get('/parents', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        // Get all specialists in center
        const specialists = await Specialist.find({ center: req.user.center }).select('linkedParents');

        // Collect all unique parent IDs
        const parentIdsSet = new Set();
        specialists.forEach(s => {
            if (s.linkedParents && Array.isArray(s.linkedParents)) {
                s.linkedParents.forEach(p => parentIdsSet.add(p.toString()));
            }
        });

        // Fetch parent details
        const parents = await Parent.find({ _id: { $in: Array.from(parentIdsSet) } })
            .select('name email phone profilePhoto linkedSpecialist')
            .populate('linkedSpecialist', 'name email')
            .lean();

        res.json({
            success: true,
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
// @desc    Get all children assigned to specialists in this center
// @access  Private (Admin)
router.get('/my-children', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        // Get all specialists in center (and their linked parents)
        const specialists = await Specialist.find({ center: req.user.center }).select('_id linkedParents');
        const specialistIds = specialists.map(s => s._id);
        const linkedParentIds = new Set();
        specialists.forEach(s => {
            (s.linkedParents || []).forEach(p => linkedParentIds.add(p.toString()));
        });

        // Find all children assigned to specialists OR whose parents are linked to center specialists
        const children = await Child.find({
            $or: [
                { assignedSpecialist: { $in: specialistIds } },
                { parent: { $in: Array.from(linkedParentIds) } }
            ]
        })
            .populate({
                path: 'parent',
                select: 'name email phone profilePhoto linkedSpecialist',
                populate: { path: 'linkedSpecialist', select: 'name email' }
            })
            .populate('assignedSpecialist', 'name email')
            .lean();

        res.json({
            success: true,
            children
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   GET /api/admin/specialists/:id/search-parents
// @desc    Search for parents to link to a specialist
// @access  Private (Admin)
router.get('/specialists/:id/search-parents', protect, authorize('admin'), checkCenterAccess, async (req, res) => {
    try {
        const { query } = req.query;
        const specialist = await Specialist.findById(req.params.id);

        if (!specialist || specialist.center.toString() !== req.user.center.toString()) {
            return res.status(404).json({
                success: false,
                message: 'الأخصائي غير موجود'
            });
        }

        // Get already linked parent IDs
        const linkedParentIds = specialist.linkedParents || [];

        // Build search query
        let searchQuery = {
            _id: { $nin: linkedParentIds }
        };

        if (query) {
            searchQuery.$or = [
                { email: { $regex: query.toLowerCase(), $options: 'i' } },
                { name: { $regex: query, $options: 'i' } }
            ];
        }

        const parents = await Parent.find(searchQuery)
            .select('_id name email phone profilePhoto')
            .limit(20)
            .lean();

        res.json({
            success: true,
            parents
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   GET /api/centers/:id
// @desc    Get center details by ID
// @access  Private (Admin)
router.get('/centers/:id', protect, authorize('admin'), async (req, res) => {
    try {
        const center = await Center.findById(req.params.id)
            .populate('admin', 'name email phone')
            .populate('specialists', 'name email specialization');

        if (!center) {
            return res.status(404).json({
                success: false,
                message: 'المركز غير موجود'
            });
        }

        // Verify admin has access to this center
        if (req.user.center && req.user.center.toString() !== center._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'غير مرخص بالوصول لهذا المركز'
            });
        }

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

module.exports = router;

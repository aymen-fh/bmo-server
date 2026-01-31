const express = require('express');
const router = express.Router();
const Admin = require('../models/Admin');
const Specialist = require('../models/Specialist');
const Parent = require('../models/Parent');
const Center = require('../models/Center');
const { protect, authorize } = require('../middleware/auth');

// ========================================
// CENTER MANAGEMENT
// ========================================

// @route   GET /api/superadmin/centers
// @desc    Get all centers
// @access  Private (Superadmin)
router.get('/centers', protect, authorize('superadmin'), async (req, res) => {
    try {
        const centers = await Center.find()
            .populate('admin', 'name email phone')
            .populate('createdBy', 'name')
            .sort('-createdAt');

        res.json({
            success: true,
            count: centers.length,
            centers
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   GET /api/superadmin/centers/:id
// @desc    Get single center details
// @access  Private (Superadmin)
router.get('/centers/:id', protect, authorize('superadmin'), async (req, res) => {
    try {
        const center = await Center.findById(req.params.id)
            .populate('admin', 'name email phone')
            .populate('specialists', 'name email phone specialization')
            .populate('createdBy', 'name');

        if (!center) {
            return res.status(404).json({
                success: false,
                message: 'المركز غير موجود'
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

// @route   POST /api/superadmin/centers
// @desc    Create new center
// @access  Private (Superadmin)
router.post('/centers', protect, authorize('superadmin'), async (req, res) => {
    try {
        const { name, nameEn, address, phone, email, description } = req.body;

        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'اسم المركز مطلوب'
            });
        }

        const center = await Center.create({
            name,
            nameEn,
            address,
            phone,
            email,
            description,
            createdBy: req.user.id
        });

        res.status(201).json({
            success: true,
            message: 'تم إنشاء المركز بنجاح',
            center
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   PUT /api/superadmin/centers/:id
// @desc    Update center
// @access  Private (Superadmin)
router.put('/centers/:id', protect, authorize('superadmin'), async (req, res) => {
    try {
        const { name, nameEn, address, phone, email, description, isActive } = req.body;

        const center = await Center.findById(req.params.id);

        if (!center) {
            return res.status(404).json({
                success: false,
                message: 'المركز غير موجود'
            });
        }

        if (name) center.name = name;
        if (nameEn !== undefined) center.nameEn = nameEn;
        if (address !== undefined) center.address = address;
        if (phone !== undefined) center.phone = phone;
        if (email !== undefined) center.email = email;
        if (description !== undefined) center.description = description;
        if (isActive !== undefined) center.isActive = isActive;

        await center.save();

        res.json({
            success: true,
            message: 'تم تحديث المركز بنجاح',
            center
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   DELETE /api/superadmin/centers/:id
// @desc    Delete center
// @access  Private (Superadmin)
router.delete('/centers/:id', protect, authorize('superadmin'), async (req, res) => {
    try {
        const center = await Center.findById(req.params.id);

        if (!center) {
            return res.status(404).json({
                success: false,
                message: 'المركز غير موجود'
            });
        }

        // Remove center reference from admin and specialists
        if (center.admin) {
            await Admin.findByIdAndUpdate(center.admin, { center: null });
        }

        for (const specialistId of center.specialists) {
            await Specialist.findByIdAndUpdate(specialistId, { center: null });
        }

        await Center.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'تم حذف المركز بنجاح'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// ========================================
// ADMIN MANAGEMENT
// ========================================

// @route   GET /api/superadmin/admins
// @desc    Get all admins
// @access  Private (Superadmin)
router.get('/admins', protect, authorize('superadmin'), async (req, res) => {
    try {
        const admins = await Admin.find()
            .populate('center', 'name')
            .select('-password')
            .sort('-createdAt');

        res.json({
            success: true,
            count: admins.length,
            admins
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   POST /api/superadmin/create-admin
// @desc    Create new admin for a center
// @access  Private (Superadmin)
router.post('/create-admin', protect, authorize('superadmin'), async (req, res) => {
    try {
        const { name, email, password, phone, centerId } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                success: false,
                message: 'الاسم والبريد الإلكتروني وكلمة المرور مطلوبة'
            });
        }

        // Check if user already exists
        const existingUser = await Admin.findOne({ email: email.toLowerCase() })
            || await Specialist.findOne({ email: email.toLowerCase() })
            || await Parent.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                message: 'البريد الإلكتروني مستخدم بالفعل'
            });
        }

        // Verify center exists if provided
        let center = null;
        if (centerId) {
            center = await Center.findById(centerId);
            if (!center) {
                return res.status(404).json({
                    success: false,
                    message: 'المركز غير موجود'
                });
            }
        }

        // Create admin
        const admin = await Admin.create({
            name,
            email: email.toLowerCase(),
            password,
            phone,
            center: centerId || null,
            createdBy: req.user.id,
            emailVerified: true
        });

        // Assign admin to center
        if (center) {
            center.admin = admin._id;
            await center.save();
        }

        res.status(201).json({
            success: true,
            message: 'تم إنشاء حساب المدير بنجاح',
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                phone: admin.phone,
                center: center ? { id: center._id, name: center.name } : null
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   PUT /api/superadmin/admins/:id
// @desc    Update admin
// @access  Private (Superadmin)
router.put('/admins/:id', protect, authorize('superadmin'), async (req, res) => {
    try {
        const { name, phone, centerId } = req.body;

        const admin = await Admin.findById(req.params.id);

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'المدير غير موجود'
            });
        }

        if (name) admin.name = name;
        if (phone !== undefined) admin.phone = phone;

        // Handle center change
        if (centerId !== undefined) {
            // Remove from old center
            if (admin.center) {
                await Center.findByIdAndUpdate(admin.center, { admin: null });
            }

            if (centerId) {
                const newCenter = await Center.findById(centerId);
                if (!newCenter) {
                    return res.status(404).json({
                        success: false,
                        message: 'المركز غير موجود'
                    });
                }
                admin.center = centerId;
                newCenter.admin = admin._id;
                await newCenter.save();
            } else {
                admin.center = null;
            }
        }

        await admin.save();

        res.json({
            success: true,
            message: 'تم تحديث المدير بنجاح',
            admin: {
                id: admin._id,
                name: admin.name,
                email: admin.email,
                phone: admin.phone
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   DELETE /api/superadmin/admins/:id
// @desc    Delete admin
// @access  Private (Superadmin)
router.delete('/admins/:id', protect, authorize('superadmin'), async (req, res) => {
    try {
        const admin = await Admin.findById(req.params.id);

        if (!admin) {
            return res.status(404).json({
                success: false,
                message: 'المدير غير موجود'
            });
        }

        // Remove admin from center
        if (admin.center) {
            await Center.findByIdAndUpdate(admin.center, { admin: null });
        }

        await Admin.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'تم حذف المدير بنجاح'
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

// @route   GET /api/superadmin/stats
// @desc    Get dashboard statistics
// @access  Private (Superadmin)
router.get('/stats', protect, authorize('superadmin'), async (req, res) => {
    try {
        const [centersCount, adminsCount, specialistsCount, parentsCount] = await Promise.all([
            Center.countDocuments(),
            Admin.countDocuments(),
            Specialist.countDocuments(),
            Parent.countDocuments()
        ]);

        res.json({
            success: true,
            stats: {
                centers: centersCount,
                admins: adminsCount,
                specialists: specialistsCount,
                parents: parentsCount
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;

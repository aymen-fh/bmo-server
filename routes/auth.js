const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const Parent = require('../models/Parent');
const Specialist = require('../models/Specialist');
const Admin = require('../models/Admin');
const { protect } = require('../middleware/auth');
const { sendVerificationEmail, sendPasswordResetEmail } = require('../services/emailService');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Ensure uploads directory exists
const uploadDir = 'uploads';
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer Config
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only images are allowed!'));
    }
});


// Generate JWT token with Role
const generateToken = (id, role) => {
    return jwt.sign({ id, role }, process.env.JWT_SECRET, {
        expiresIn: process.env.JWT_EXPIRE
    });
};

// @route   POST /api/auth/register
// @desc    Register new user (parent or specialist)
// @access  Public
router.post('/register', async (req, res) => {
    try {
        const { name, email, password, role, phone, specialization, licenseNumber } = req.body;

        const emailLower = email.toLowerCase();

        // Check if user exists in ANY collection
        const existingParent = await Parent.findOne({ email: emailLower });
        const existingSpecialist = await Specialist.findOne({ email: emailLower });
        const existingAdmin = await Admin.findOne({ email: emailLower });

        if (existingParent || existingSpecialist || existingAdmin) {
            return res.status(400).json({
                success: false,
                message: 'User already exists'
            });
        }

        // Generate 6-digit verification code
        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        let user;

        // Create user based on role
        if (role === 'parent') {
            user = await Parent.create({
                name,
                email: emailLower,
                password,
                role: 'parent',
                phone,
                verificationToken: verificationCode
            });
        } else if (role === 'specialist') {
            user = await Specialist.create({
                name,
                email: emailLower,
                password,
                role: 'specialist',
                phone,
                specialization,
                licenseNumber,
                verificationToken: verificationCode
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Invalid role for registration'
            });
        }

        // Send verification email
        try {
            await sendVerificationEmail(user.email, verificationCode);
            console.log('✅ Verification email sent successfully to:', user.email);
        } catch (emailError) {
            console.error('❌ Email sending failed during registration:', emailError.message);
        }

        const token = generateToken(user._id, user.role);

        res.status(201).json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                emailVerified: user.emailVerified
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   POST /api/auth/login
// @desc    Login user (searches all collections)
// @access  Public
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: 'Please provide email and password'
            });
        }

        const emailLower = email.toLowerCase();

        // Strategy: Search in all collections
        // 1. Try Parent
        let user = await Parent.findOne({ email: emailLower }).select('+password');
        let role = 'parent';

        // 2. Try Specialist
        if (!user) {
            user = await Specialist.findOne({ email: emailLower }).select('+password');
            role = 'specialist';
        }

        // 3. Try Admin
        if (!user) {
            user = await Admin.findOne({ email: emailLower }).select('+password');
            role = user ? user.role : 'admin'; // admin or superadmin
        }

        if (!user || !(await user.comparePassword(password))) {
            return res.status(401).json({
                success: false,
                message: 'Invalid credentials'
            });
        }

        const token = generateToken(user._id, role);

        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: role
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   GET /api/auth/me
// @desc    Get current user
// @access  Private
router.get('/me', protect, async (req, res) => {
    try {
        // req.user is already fetched by 'protect' middleware from the correct collection
        // Just need to populate if necessary
        let user = req.user;

        if (user.role === 'parent') {
            user = await Parent.findById(user._id).populate('assignedChildren');
        } else if (user.role === 'specialist') {
            user = await Specialist.findById(user._id).populate('center');
        } else if (user.role === 'admin' || user.role === 'superadmin') {
            user = await Admin.findById(user._id).populate('center');
        }

        res.json({
            success: true,
            user
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   PUT /api/auth/profile
// @desc    Update user profile
// @access  Private
router.put('/profile', protect, upload.single('photo'), async (req, res) => {
    try {
        const { name, email, phone } = req.body;

        // Use req.user (already fetched)
        let user = req.user;

        // Check uniqueness if email changed
        if (email && email !== user.email) {
            const existsP = await Parent.findOne({ email });
            const existsS = await Specialist.findOne({ email });
            const existsA = await Admin.findOne({ email });

            if (existsP || existsS || existsA) {
                return res.status(400).json({
                    success: false,
                    message: 'Email already in use'
                });
            }
            user.email = email;
            user.emailVerified = false;
        }

        if (name) user.name = name;
        if (phone !== undefined) user.phone = phone;

        if (req.file) {
            user.profilePhoto = req.file.path.replace(/\\/g, "/");
        }

        await user.save();

        res.json({
            success: true,
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                phone: user.phone,
                emailVerified: user.emailVerified,
                profilePhoto: user.profilePhoto
            }
        });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   PUT /api/auth/change-password
// @desc    Change user password
// @access  Private
router.put('/change-password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Please provide current and new password'
            });
        }

        // Must re-fetch with password selected
        let user;
        if (req.user.role === 'parent') user = await Parent.findById(req.user.id).select('+password');
        else if (req.user.role === 'specialist') user = await Specialist.findById(req.user.id).select('+password');
        else user = await Admin.findById(req.user.id).select('+password');

        if (!(await user.comparePassword(currentPassword))) {
            return res.status(400).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        user.password = newPassword;
        await user.save();

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Helper to find user by email across all collections
async function findUserByEmail(email) {
    let user = await Parent.findOne({ email });
    if (user) return user;
    user = await Specialist.findOne({ email });
    if (user) return user;
    user = await Admin.findOne({ email });
    return user;
}

// @route   POST /api/auth/forgot-password
// @desc    Send password reset email with 6-digit code
// @access  Public
router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ message: 'Please provide email' });

        const user = await findUserByEmail(email);

        if (!user) {
            return res.json({
                success: true,
                message: 'If an account with that email exists, a password reset code has been sent'
            });
        }

        const resetCode = Math.floor(100000 + Math.random() * 900000).toString();
        user.resetPasswordToken = resetCode;
        user.resetPasswordExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

        await user.save();

        try {
            await sendPasswordResetEmail(user.email, resetCode);
        } catch (emailError) {
            console.error('❌ Email sending failed:', emailError.message);
            user.resetPasswordToken = undefined;
            user.resetPasswordExpire = undefined;
            await user.save();
            return res.status(500).json({ success: false, message: 'Email could not be sent' });
        }

        res.json({ success: true, message: 'Password reset code sent to your email' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/auth/verify-reset-token
// @desc    Verify if the 6-digit password reset token is valid
// @access  Public
router.post('/verify-reset-token', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ message: 'Reset token is required' });

        // Search in all collections for this token
        let user = await Parent.findOne({ resetPasswordToken: token, resetPasswordExpire: { $gt: Date.now() } });
        if (!user) user = await Specialist.findOne({ resetPasswordToken: token, resetPasswordExpire: { $gt: Date.now() } });
        if (!user) user = await Admin.findOne({ resetPasswordToken: token, resetPasswordExpire: { $gt: Date.now() } });

        if (!user) {
            return res.status(400).json({ success: false, message: 'Invalid or expired code.' });
        }

        res.json({ success: true, message: 'Token verified successfully.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   PUT /api/auth/reset-password
// @desc    Reset password with 6-digit code
// @access  Public
router.put('/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ message: 'Please provide code and new password' });

        let user = await Parent.findOne({ resetPasswordToken: token, resetPasswordExpire: { $gt: Date.now() } });
        if (!user) user = await Specialist.findOne({ resetPasswordToken: token, resetPasswordExpire: { $gt: Date.now() } });
        if (!user) user = await Admin.findOne({ resetPasswordToken: token, resetPasswordExpire: { $gt: Date.now() } });

        if (!user) return res.status(400).json({ success: false, message: 'Invalid or expired code' });

        user.password = newPassword;
        user.resetPasswordToken = undefined;
        user.resetPasswordExpire = undefined;
        await user.save();

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/auth/verify-email
// @desc    Verify email address
// @access  Public
router.post('/verify-email', async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ message: 'Verification token is required' });

        let user = await Parent.findOne({ verificationToken: token });
        if (!user) user = await Specialist.findOne({ verificationToken: token });
        if (!user) user = await Admin.findOne({ verificationToken: token });

        if (!user) return res.status(400).json({ success: false, message: 'Invalid verification token' });

        user.emailVerified = true;
        user.verificationToken = undefined;
        await user.save();

        res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/auth/resend-verification
// @desc    Resend verification email
// @access  Private
router.post('/resend-verification', protect, async (req, res) => {
    try {
        const user = req.user; // Already fetched by middleware

        if (user.emailVerified) {
            return res.status(400).json({
                success: false,
                message: 'Email already verified'
            });
        }

        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        user.verificationToken = verificationCode;
        await user.save();

        try {
            await sendVerificationEmail(user.email, verificationCode);
        } catch (emailError) {
            console.error('❌ Email sending failed:', emailError.message);
            return res.status(500).json({ success: false, message: 'Email could not be sent' });
        }

        res.json({ success: true, message: 'Verification email sent' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   POST /api/auth/refresh-token
// @desc    Refresh JWT token
// @access  Private
router.post('/refresh-token', protect, async (req, res) => {
    try {
        const user = req.user;
        const token = generateToken(user._id, user.role);

        res.json({
            success: true,
            token
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   GET /api/auth/my-specialist
// @desc    Get linked specialist for the current parent
// @access  Private (Parent only)
router.get('/my-specialist', protect, async (req, res) => {
    try {
        if (req.user.role !== 'parent') {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // We need to populate linkedSpecialist, so re-fetch from Parent model
        const user = await Parent.findById(req.user.id).populate({
            path: 'linkedSpecialist',
            select: 'name email phone specialization profilePhoto center',
            populate: {
                path: 'center',
                select: 'name_ar name_en'
            }
        });

        if (!user || !user.linkedSpecialist) {
            return res.status(404).json({
                success: false,
                message: 'No specialist linked to this account'
            });
        }

        res.json({
            success: true,
            specialist: user.linkedSpecialist
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = router;

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const adminSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: 6,
        select: false
    },
    role: {
        type: String,
        enum: ['admin', 'superadmin'],
        default: 'admin'
    },
    phone: {
        type: String,
        trim: true
    },
    center: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Center',
        default: null
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    profilePhoto: {
        type: String,
        default: null
    },
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpire: Date,

    // Custom ID
    staffId: {
        type: String,
        unique: true,
        sparse: true,
        trim: true
    }
}, {
    timestamps: true
});

// Password hashing
adminSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 12);
    }

    // Generate staffId (AD-xxxx)
    if (this.isNew && !this.staffId) {
        const count = await this.constructor.countDocuments();
        this.staffId = `AD-${String(count + 1).padStart(4, '0')}`;
    }
    next();
});

adminSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Admin', adminSchema);

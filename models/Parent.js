const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const parentSchema = new mongoose.Schema({
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
        enum: ['parent'],
        default: 'parent'
    },
    phone: {
        type: String,
        trim: true
    },
    emailVerified: {
        type: Boolean,
        default: false
    },
    profilePhoto: {
        type: String,
        default: null
    },
    bio: {
        type: String,
        trim: true,
        maxlength: 500
    },
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpire: Date,

    // Parent specific fields
    assignedChildren: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Child'
    }],
    linkedSpecialist: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Specialist',
        default: null
    },

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
parentSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 12);
    }

    // Generate staffId (PT-xxxx)
    if (this.isNew && !this.staffId) {
        const count = await this.constructor.countDocuments();
        this.staffId = `PT-${String(count + 1).padStart(4, '0')}`;
    }
    next();
});

parentSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Parent', parentSchema);

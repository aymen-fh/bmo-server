const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const specialistSchema = new mongoose.Schema({
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
        enum: ['specialist'],
        default: 'specialist'
    },
    phone: {
        type: String,
        trim: true
    },
    specialization: {
        type: String,
        trim: true
    },
    licenseNumber: {
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
    bio: {
        type: String,
        trim: true,
        maxlength: 500
    },
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpire: Date,

    // Specialist specific fields
    linkedParents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Parent'
    }],

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
specialistSchema.pre('save', async function (next) {
    if (this.isModified('password')) {
        this.password = await bcrypt.hash(this.password, 12);
    }

    // Generate staffId (SP-xxxx)
    if (this.isNew && !this.staffId) {
        const count = await this.constructor.countDocuments();
        this.staffId = `SP-${String(count + 1).padStart(4, '0')}`;
    }
    next();
});

specialistSchema.methods.comparePassword = async function (candidatePassword) {
    return await bcrypt.compare(candidatePassword, this.password);
};

module.exports = mongoose.model('Specialist', specialistSchema);

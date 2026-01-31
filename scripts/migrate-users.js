require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Parent = require('../models/Parent');
const Specialist = require('../models/Specialist');
const Admin = require('../models/Admin');

/**
 * Migration Script: Split Users into separate collections
 * Uses insertMany to skip pre-save hooks (preserving password hashes)
 */

async function migrateUsers() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!MONGODB_URI) throw new Error('MONGODB_URI not found');

        await mongoose.connect(MONGODB_URI);
        console.log('🔌 Connected to MongoDB');

        console.log('🚀 Starting User Migration...');

        // IMPORTANT: Reset User model queries to include password
        const users = await User.find({}).select('+password');
        console.log(`Found ${users.length} total users to migrate`);

        // STEP 1: Clear corrupted collections to start fresh
        // (Since this is a migration fix, we wipe the target collections)
        await Parent.deleteMany({});
        await Specialist.deleteMany({});
        await Admin.deleteMany({});
        console.log('🧹 Cleared existing Parent/Specialist/Admin collections.');

        // arrays for bulk insert
        const parents = [];
        const specialists = [];
        const admins = [];

        for (const user of users) {
            const userData = user.toObject();
            delete userData.__v;

            if (userData.role === 'parent') {
                parents.push(userData);
            } else if (userData.role === 'specialist') {
                specialists.push(userData);
            } else if (['admin', 'superadmin'].includes(userData.role)) {
                admins.push(userData);
            }
        }

        if (parents.length > 0) {
            await Parent.insertMany(parents);
            console.log(`✅ Bulk Migrated ${parents.length} Parents`);
        }
        if (specialists.length > 0) {
            await Specialist.insertMany(specialists);
            console.log(`✅ Bulk Migrated ${specialists.length} Specialists`);
        }
        if (admins.length > 0) {
            await Admin.insertMany(admins);
            console.log(`✅ Bulk Migrated ${admins.length} Admins`);
        }

        console.log('\n✅ Migration completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrateUsers();

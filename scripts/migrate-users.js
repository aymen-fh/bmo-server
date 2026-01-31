require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');
const Parent = require('../models/Parent');
const Specialist = require('../models/Specialist');
const Admin = require('../models/Admin');

/**
 * Migration Script: Split Users into separate collections
 */

async function migrateUsers() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(MONGODB_URI);
        console.log('🔌 Connected to MongoDB');

        console.log('🚀 Starting User Migration...');

        // IMPORTANT: Reset User model queries to include password
        const users = await User.find({}).select('+password');
        console.log(`Found ${users.length} total users to migrate`);

        let parentsCount = 0;
        let specialistsCount = 0;
        let adminsCount = 0;

        for (const user of users) {
            const userData = user.toObject();
            delete userData.__v; // Remove version key

            // We MUST keep the same _id to maintain relationships
            // Mongoose automatically casts string _id to ObjectId, but since it's already an ObjectId in userData, it's fine.

            try {
                if (userData.role === 'parent') {
                    // Check if already exists to avoid duplicates if re-run
                    const exists = await Parent.findById(userData._id);
                    if (!exists) {
                        await Parent.create(userData);
                        parentsCount++;
                        console.log(`   ✅ Migrated Parent: ${userData.name}`);
                    } else {
                        console.log(`   ℹ️  Skipped Parent (exists): ${userData.name}`);
                    }
                }
                else if (userData.role === 'specialist') {
                    const exists = await Specialist.findById(userData._id);
                    if (!exists) {
                        await Specialist.create(userData);
                        specialistsCount++;
                        console.log(`   ✅ Migrated Specialist: ${userData.name}`);
                    } else {
                        console.log(`   ℹ️  Skipped Specialist (exists): ${userData.name}`);
                    }
                }
                else if (['admin', 'superadmin'].includes(userData.role)) {
                    const exists = await Admin.findById(userData._id);
                    if (!exists) {
                        await Admin.create(userData);
                        adminsCount++;
                        console.log(`   ✅ Migrated Admin: ${userData.name}`);
                    } else {
                        console.log(`   ℹ️  Skipped Admin (exists): ${userData.name}`);
                    }
                }
            } catch (err) {
                console.error(`   ❌ Failed to migrate ${userData.name} (${userData.role}):`, err.message);
            }
        }

        console.log('\n📊 Migration Summary:');
        console.log(`   Parents: ${parentsCount}`);
        console.log(`   Specialists: ${specialistsCount}`);
        console.log(`   Admins: ${adminsCount}`);
        console.log('\n✅ Migration completed successfully!');

        // IMPORTANT: We do NOT delete the old 'users' collection yet.
        // We keep it as a backup until we verify everything works.

        process.exit(0);

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrateUsers();

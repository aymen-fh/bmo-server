require('dotenv').config();
const mongoose = require('mongoose');
const Exercise = require('../models/Exercise');
const Child = require('../models/Child');

/**
 * Database Cleanup Script
 * 
 * Purpose:
 * 1. Remove exercisessessions collection (if empty)
 * 2. Consolidate session duration fields in exercises
 * 3. Ensure all exercises have required session settings
 */

async function cleanupDatabase() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!MONGODB_URI) {
            throw new Error('MONGODB_URI not found in environment variables');
        }

        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('🧹 Starting database cleanup...\n');

        // ==== STEP 1: Check and drop exercisessessions collection ====
        console.log('1️⃣ Checking exercisessessions collection...');
        const collections = await mongoose.connection.db.listCollections().toArray();
        const hasExerciseSessions = collections.some(col =>
            col.name === 'exercisessessions'
        );

        if (hasExerciseSessions) {
            const count = await mongoose.connection.db
                .collection('exercisessessions')
                .countDocuments();

            if (count === 0) {
                await mongoose.connection.db.dropCollection('exercisessessions');
                console.log('   ✅ Dropped empty exercisessessions collection\n');
            } else {
                console.log(`   ⚠️  exercisessessions has ${count} documents`);
                console.log('   ℹ️  Please review these documents before deleting\n');
            }
        } else {
            console.log('   ℹ️  exercisessessions collection does not exist\n');
        }

        // ==== STEP 2: Consolidate exercise duration fields ====
        console.log('2️⃣ Consolidating exercise session fields...');
        const exercises = await Exercise.find({ kind: 'plan' });
        let updatedCount = 0;

        for (const ex of exercises) {
            let updated = false;

            // Consolidate targetDuration
            if (!ex.targetDuration) {
                ex.targetDuration = ex.playDuration || ex.sessionDuration || 15;
                updated = true;
            }

            // Ensure breakDuration exists
            if (ex.breakDuration === null || ex.breakDuration === undefined) {
                ex.breakDuration = 5;
                updated = true;
            }

            // Ensure maxAttempts exists
            if (!ex.maxAttempts) {
                ex.maxAttempts = 20;
                updated = true;
            }

            if (updated) {
                await ex.save();
                updatedCount++;
                console.log(`   ✅ Updated: ${ex.sessionName || ex._id}`);
                console.log(`      targetDuration: ${ex.targetDuration}, breakDuration: ${ex.breakDuration}, maxAttempts: ${ex.maxAttempts}`);
            }
        }

        console.log(`   Processed ${exercises.length} exercises (${updatedCount} updated)\n`);

        // ==== STEP 3: Report on children without session settings ====
        console.log('3️⃣ Checking children records...');
        const children = await Child.find({});
        let childrenWithoutSettings = 0;

        for (const child of children) {
            const hasStructure = child.sessionStructure && (
                child.sessionStructure.playDuration ||
                child.sessionStructure.breakDuration ||
                child.sessionStructure.maxAttempts
            );

            if (!hasStructure) {
                childrenWithoutSettings++;
                console.log(`   ⚠️  Child ${child.name} (${child._id}) has no sessionStructure`);
            }
        }

        if (childrenWithoutSettings === 0) {
            console.log(`   ✅ All ${children.length} children checked\n`);
        } else {
            console.log(`   ⚠️  ${childrenWithoutSettings} children without sessionStructure\n`);
        }

        // ==== SUMMARY ====
        console.log('\n📊 Cleanup Summary:');
        console.log('================================');
        console.log(`✅ Exercises processed: ${exercises.length}`);
        console.log(`✅ Exercises updated: ${updatedCount}`);
        console.log(`✅ Children checked: ${children.length}`);
        console.log(`⚠️  Children without settings: ${childrenWithoutSettings}`);
        console.log('================================\n');

        console.log('✅ Database cleanup completed successfully!');
        process.exit(0);

    } catch (error) {
        console.error('\n❌ Database cleanup failed:', error);
        process.exit(1);
    }
}

// Run cleanup
cleanupDatabase();

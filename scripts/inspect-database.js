require('dotenv').config();
const mongoose = require('mongoose');

/**
 * Database Inspector Script
 * 
 * Purpose: Review all collections in the database and provide detailed report
 */

async function inspectDatabase() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!MONGODB_URI) {
            throw new Error('MONGODB_URI not found in environment variables');
        }

        console.log('🔌 Connecting to MongoDB...');
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        console.log('📊 Database Inspection Report');
        console.log('='.repeat(80));
        console.log();

        // Get all collections
        const collections = await mongoose.connection.db.listCollections().toArray();

        console.log(`Total Collections: ${collections.length}\n`);
        console.log('Collections List:');
        collections.forEach((col, index) => {
            console.log(`  ${index + 1}. ${col.name}`);
        });
        console.log('\n' + '='.repeat(80) + '\n');

        // Inspect each collection
        for (const col of collections) {
            const collectionName = col.name;
            const collection = mongoose.connection.db.collection(collectionName);

            console.log(`📂 Collection: ${collectionName}`);
            console.log('-'.repeat(80));

            // Count documents
            const count = await collection.countDocuments();
            console.log(`   Documents: ${count}`);

            if (count > 0) {
                // Get sample document
                const sample = await collection.findOne({});

                // Show sample structure (keys only)
                if (sample) {
                    console.log(`   Sample Keys: ${Object.keys(sample).join(', ')}`);

                    // Check for common issues
                    const issues = [];

                    // Check for documents with missing required fields (based on common patterns)
                    if (collectionName === 'exercises') {
                        const missingSettings = await collection.countDocuments({
                            kind: 'plan',
                            $or: [
                                { targetDuration: { $exists: false } },
                                { breakDuration: { $exists: false } },
                                { maxAttempts: { $exists: false } }
                            ]
                        });
                        if (missingSettings > 0) {
                            issues.push(`⚠️  ${missingSettings} plan(s) missing session settings`);
                        }

                        // Check for deprecated fields still in use
                        const withDeprecated = await collection.countDocuments({
                            $or: [
                                { playDuration: { $exists: true } },
                                { sessionDuration: { $exists: true } },
                                { totalDuration: { $exists: true } }
                            ]
                        });
                        if (withDeprecated > 0) {
                            issues.push(`ℹ️  ${withDeprecated} exercise(s) with deprecated fields`);
                        }
                    }

                    if (collectionName === 'exercisessessions') {
                        issues.push('⚠️  This collection should be empty or removed');
                    }

                    if (collectionName === 'children') {
                        const withoutSpecialist = await collection.countDocuments({
                            assignedSpecialist: { $exists: false }
                        });
                        if (withoutSpecialist > 0) {
                            issues.push(`ℹ️  ${withoutSpecialist} child(ren) without assigned specialist`);
                        }
                    }

                    // Display issues if any
                    if (issues.length > 0) {
                        console.log(`   Issues:`);
                        issues.forEach(issue => console.log(`     ${issue}`));
                    }

                    // Show a compact sample document
                    console.log(`   Sample Document:`);
                    const compactSample = {};
                    Object.keys(sample).slice(0, 8).forEach(key => {
                        const value = sample[key];
                        if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
                            compactSample[key] = '{...}';
                        } else if (Array.isArray(value)) {
                            compactSample[key] = `[${value.length} items]`;
                        } else if (typeof value === 'string' && value.length > 30) {
                            compactSample[key] = value.substring(0, 27) + '...';
                        } else {
                            compactSample[key] = value;
                        }
                    });
                    console.log(`     ${JSON.stringify(compactSample, null, 2).split('\n').map(l => '     ' + l).join('\n').trim()}`);
                }
            } else {
                console.log(`   ⚠️  Empty collection`);
            }

            console.log();
        }

        // Summary
        console.log('='.repeat(80));
        console.log('\n📋 Summary\n');

        const stats = {};
        for (const col of collections) {
            const count = await mongoose.connection.db.collection(col.name).countDocuments();
            stats[col.name] = count;
        }

        // Show in table format
        console.log('Collection Name          | Count');
        console.log('-'.repeat(50));
        Object.entries(stats)
            .sort((a, b) => b[1] - a[1])
            .forEach(([name, count]) => {
                const paddedName = name.padEnd(24);
                const status = count === 0 ? '⚠️  EMPTY' : count.toString();
                console.log(`${paddedName} | ${status}`);
            });

        console.log('\n' + '='.repeat(80));
        console.log('\n✅ Database inspection completed!\n');

        process.exit(0);

    } catch (error) {
        console.error('\n❌ Database inspection failed:', error);
        process.exit(1);
    }
}

// Run inspection
inspectDatabase();

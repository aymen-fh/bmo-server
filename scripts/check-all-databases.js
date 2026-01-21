/**
 * سكريبت لعرض معلومات الاتصال وجميع الـ databases
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function checkDatabases() {
    try {
        console.log('🔗 Connection String:', MONGODB_URI?.replace(/:[^:]*@/, ':****@')); // Hide password

        await mongoose.connect(MONGODB_URI);
        console.log('\n✅ متصل بقاعدة البيانات');

        const db = mongoose.connection.db;
        console.log(`\n📁 Database الحالي: ${db.databaseName}\n`);

        // List all databases
        const adminDb = db.admin();
        const { databases } = await adminDb.listDatabases();

        console.log('📋 جميع Databases المتوفرة:');
        console.log('='.repeat(60));

        for (const database of databases) {
            console.log(`\n📦 ${database.name} (${(database.sizeOnDisk / 1024 / 1024).toFixed(2)} MB)`);

            // Connect to each database and list its collections
            const testDb = mongoose.connection.client.db(database.name);
            const collections = await testDb.listCollections().toArray();

            for (const collection of collections) {
                const count = await testDb.collection(collection.name).countDocuments();
                console.log(`   └─ ${collection.name}: ${count} documents`);
            }
        }

        console.log('\n' + '='.repeat(60));

    } catch (error) {
        console.error('❌ خطأ:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('\n✅ تم قطع الاتصال');
        process.exit(0);
    }
}

checkDatabases();

/**
 * سكريبت للتحقق من جميع collections في MongoDB
 */

require('dotenv').config();
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;

async function checkAllCollections() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ متصل بقاعدة البيانات\n');

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();

        console.log('📋 Collections الموجودة في قاعدة البيانات:');
        console.log('='.repeat(60));

        for (const collection of collections) {
            const collectionName = collection.name;
            const count = await db.collection(collectionName).countDocuments();
            console.log(`\n📦 ${collectionName}: ${count} documents`);

            // عرض أول document كمثال
            if (count > 0) {
                const sample = await db.collection(collectionName).findOne();
                console.log('   عينة من البيانات:', JSON.stringify(sample, null, 2).substring(0, 200) + '...');
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

checkAllCollections();

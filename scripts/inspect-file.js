require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');

async function inspectDatabase() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(MONGODB_URI);

        let report = '📊 تقرير فحص قاعدة البيانات\n';
        report += '==================================================\n\n';

        const collections = await mongoose.connection.db.listCollections().toArray();
        report += `عدد المجموعات: ${collections.length}\n\n`;

        report += '📋 قائمة المجموعات:\n';

        // Sort collections by name
        collections.sort((a, b) => a.name.localeCompare(b.name));

        for (const col of collections) {
            const count = await mongoose.connection.db.collection(col.name).countDocuments();
            const status = count === 0 ? '⚠️ فارغة' : `✅ ${count} سجل`;
            report += `- ${col.name.padEnd(20)} : ${status}\n`;

            // Special checks
            if (col.name === 'exercisessessions') {
                report += '  ❌ تنبيه: هذه المجموعة يجب أن تكون محذوفة!\n';
            }
        }

        report += '\n==================================================\n';
        report += '✅ تم الفحص بنجاح\n';

        fs.writeFileSync('db-report.txt', report);
        console.log('Report written to db-report.txt');

        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

inspectDatabase();

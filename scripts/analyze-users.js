require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

async function analyzeUsers() {
    try {
        const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(MONGODB_URI);

        console.log('📊 Analyzing Users Collection...\n');

        const total = await User.countDocuments();
        console.log(`Total Users: ${total}`);

        const roles = await User.distinct('role');
        console.log(`Roles found: ${roles.join(', ')}\n`);

        for (const role of roles) {
            const count = await User.countDocuments({ role });
            console.log(`- ${role}: ${count}`);
        }

        console.log('\n✅ User Analysis Complete');
        process.exit(0);
    } catch (error) {
        console.error(error);
        process.exit(1);
    }
}

analyzeUsers();

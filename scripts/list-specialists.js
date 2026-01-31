const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Specialist = require('../models/Specialist');
const User = require('../models/User');

const path = require('path');
dotenv.config({ path: path.join(__dirname, '../.env') });

const connectDB = async () => {
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) throw new Error('MONGODB_URI not found in .env');
        await mongoose.connect(uri);
        console.log('MongoDB Connected');

        console.log('\n--- Specialist Accounts ---');
        const specialists = await Specialist.find({});
        if (specialists.length === 0) {
            console.log('No specialists found.');
        } else {
            specialists.forEach(s => {
                console.log(`Email: ${s.email} | Name: ${s.name} | ID: ${s._id}`);
            });
        }

        console.log('\n--- User Accounts (Role: specialist) ---');
        const users = await User.find({ role: 'specialist' });
        if (users.length === 0) {
            console.log('No Users with role specialist found.');
        } else {
            users.forEach(u => {
                console.log(`Email: ${u.email} | Name: ${u.name} | ID: ${u._id}`);
            });
        }

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

connectDB();

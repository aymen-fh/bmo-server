const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Specialist = require('../models/Specialist');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const createSpecialist = async () => {
    try {
        const uri = process.env.MONGODB_URI;
        if (!uri) throw new Error('MONGODB_URI not found');
        await mongoose.connect(uri);
        console.log('MongoDB Connected');

        const email = 'specialist@bmo.com';
        const password = 'password123';

        // Check availability
        const exists = await Specialist.findOne({ email });
        if (exists) {
            console.log(`Specialist already exists: ${email}`);
        } else {
            const specialist = await Specialist.create({
                name: 'Test Specialist',
                email,
                password, // Model will hash this
                role: 'specialist',
                specialization: 'Speech Therapy',
                emailVerified: true
            });
            console.log(`\n✅ Created Specialist:\nEmail: ${specialist.email}\nPassword: ${password}\nID: ${specialist._id}`);
        }

        process.exit();
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
};

createSpecialist();

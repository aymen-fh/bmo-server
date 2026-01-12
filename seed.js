const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./models/User');
const Child = require('./models/Child');
const Exercise = require('./models/Exercise');
const Progress = require('./models/Progress');
const Center = require('./models/Center');
const Referral = require('./models/Referral');

// ⚠️ تمت إزالة require('dotenv').config() و mongoose.connect/close

const seedDatabase = async () => {
  try {
    // 💡 يتم افتراض أن الاتصال بـ MongoDB قد تم بالفعل بواسطة server.js

    // 🔑 Check if forced seeding is enabled
    const forceSeed = process.env.FORCE_SEED === 'true';

    // Check if data already exists - BUT we still want to ensure Admin/Superadmin exist
    const existingUsersCount = await User.countDocuments();
    if (existingUsersCount > 0 && !forceSeed) {
      console.log('📊 Database already has data. Checking for Admin/Superadmin accounts...');
    }

    if (forceSeed && existingUsersCount > 0) {
      console.log('⚠️ FORCE_SEED is enabled. Clearing existing data...');
      // Clear existing data only if forced
      await User.deleteMany({});
      await Child.deleteMany({});
      await Exercise.deleteMany({});
      await Progress.deleteMany({});
      await Center.deleteMany({});
      console.log('🧹 Cleared existing data');
    }

    // ========================================
    // CREATE SUPERADMIN (1)
    // ========================================
    const superadminData = {
      name: 'مدير النظام',
      nameEn: 'System Manager',
      email: 'superadmin@bmo.com',
      role: 'superadmin',
      phone: '+966500000000',
      emailVerified: true
    };

    let superadmin = await User.findOne({ email: superadminData.email });
    if (!superadmin) {
      superadminData.password = 'admin123';
      superadmin = await User.create(superadminData);
      console.log('👑 Created Super Admin: superadmin@bmo.com');
    } else {
      console.log('👑 Super Admin already exists.');
    }

    // ========================================
    // CREATE SAMPLE CENTER
    // ========================================
    let center = await Center.findOne({ email: 'center@bmo.com' });
    if (!center) {
      const centerData = {
        name: 'مركز النطق والتخاطب',
        nameEn: 'Speech Therapy Center',
        address: 'الرياض، المملكة العربية السعودية',
        phone: '+966501234567',
        email: 'center@bmo.com',
        description: 'مركز متخصص في علاج اضطرابات النطق والتخاطب للأطفال',
        createdBy: superadmin._id,
        centerId: 'CT-0001' // Add centerId
      };
      center = await Center.create(centerData);
      console.log('🏥 Created sample center [CT-0001]');
    }

    // ========================================
    // CREATE ADMINS (2)
    // ========================================
    const adminsList = [
      { name: 'مدير المركز 1', email: 'admin@bmo.com', phone: '+966502345678' },
      { name: 'مدير المركز 2', email: 'admin2@bmo.com', phone: '+966502345679' }
    ];

    let centerAdmin = null;

    for (let i = 0; i < adminsList.length; i++) {
      const ad = adminsList[i];
      let adminUser = await User.findOne({ email: ad.email });
      if (!adminUser) {
        const adminData = {
          name: ad.name,
          nameEn: 'Center Manager',
          email: ad.email,
          password: 'admin123',
          role: 'admin',
          phone: ad.phone,
          center: center._id,
          createdBy: superadmin._id,
          emailVerified: true,
          staffId: `AD-${String(i + 1).padStart(4, '0')}` // Add staffId
        };
        adminUser = await User.create(adminData);
        console.log(`👔 Created Admin: ${ad.email} [${adminUser.staffId}]`);
      } else {
        console.log(`👔 Admin ${ad.email} already exists.`);
      }
      if (!centerAdmin) centerAdmin = adminUser; // Keep first one as main center admin if needed
    }

    // Ensure center has an admin linked
    if (centerAdmin && !center.admin) {
      center.admin = centerAdmin._id;
      await center.save();
    }

    // ========================================
    // CREATE SPECIALISTS (4)
    // ========================================
    const specialistsList = [
      { name: 'د. أحمد (نطق)', email: 'doc1@bmo.com', spec: 'Speech Therapy' },
      { name: 'د. سارة (سلوك)', email: 'doc2@bmo.com', spec: 'Behavioral Therapy' }
    ];

    const specialistsCreated = [];
    for (let i = 0; i < specialistsList.length; i++) {
      const sp = specialistsList[i];
      let existing = await User.findOne({ email: sp.email });
      if (!existing) {
        const spData = {
          name: sp.name,
          email: sp.email,
          password: 'password123',
          role: 'specialist',
          phone: '+96650' + Math.floor(Math.random() * 10000000),
          specialization: sp.spec,
          licenseNumber: 'L-' + Math.floor(Math.random() * 10000),
          center: center._id,
          createdBy: centerAdmin ? centerAdmin._id : superadmin._id,
          emailVerified: true,
          staffId: `SP-${String(i + 1).padStart(4, '0')}` // Add staffId
        };
        existing = await User.create(spData);
        console.log(`🥼 Created Specialist: ${sp.email} [${existing.staffId}]`);
      }
      specialistsCreated.push(existing);
    }

    // Add specialists to center
    center.specialists = specialistsCreated.map(s => s._id);
    await center.save();

    // ========================================
    // CREATE PARENTS (6)
    // ========================================
    const parentsList = [
      { name: 'محمد علي', email: 'parent1@bmo.com' },
      { name: 'فاطمة حسن', email: 'parent2@bmo.com' },
      { name: 'سعيد عبد الله', email: 'parent3@bmo.com' },
      { name: 'نورة محمد', email: 'parent4@bmo.com' }
    ];

    const parentsCreated = [];
    for (let i = 0; i < parentsList.length; i++) {
      const p = parentsList[i];
      let existing = await User.findOne({ email: p.email });
      if (!existing) {
        const pData = {
          name: p.name,
          email: p.email,
          password: 'password123',
          role: 'parent',
          phone: '+96650' + Math.floor(Math.random() * 10000000),
          emailVerified: true,
          staffId: `PT-${String(i + 1).padStart(4, '0')}` // Add staffId
        };
        existing = await User.create(pData);
        console.log(`👨‍👩‍👧‍👦 Created Parent: ${p.email} [${existing.staffId}]`);
      }
      parentsCreated.push(existing);
    }

    // ========================================
    // LINK PARENTS TO SPECIALISTS (Updated)
    // ========================================
    async function ensureReferral({ parentId, specialistId, referralType, status, notes }) {
      await Referral.updateOne(
        { parent: parentId, specialist: specialistId, referralType },
        {
          $setOnInsert: {
            status: status || 'active',
            notes: notes || '',
            referralDate: new Date(),
          },
        },
        { upsert: true }
      );
    }

    if (specialistsCreated.length > 0 && parentsCreated.length > 0) {
      // Assign first 2 parents to first specialist
      const sp1 = specialistsCreated[0];
      const p1 = parentsCreated[0];
      const p2 = parentsCreated[1];

      if (sp1 && p1 && p2) {
        sp1.linkedParents = [p1._id, p2._id];
        await sp1.save();

        p1.linkedSpecialist = sp1._id;
        await p1.save();
        p2.linkedSpecialist = sp1._id;
        await p2.save();
        console.log(`🔗 Linked Parents ${p1.email}, ${p2.email} to Specialist ${sp1.email}`);

        // Create referral records for these linkages
        await ensureReferral({
          parentId: p1._id,
          specialistId: sp1._id,
          referralType: 'admin_assigned',
          status: 'active',
          notes: 'Initial seed data linkage'
        });
        await ensureReferral({
          parentId: p2._id,
          specialistId: sp1._id,
          referralType: 'admin_assigned',
          status: 'active',
          notes: 'Initial seed data linkage'
        });
        console.log(`📝 Created referral records for ${p1.email} and ${p2.email}`);
      }

      // Assign next 2 parents to second specialist (if available)
      if (specialistsCreated.length > 1 && parentsCreated.length > 3) {
        const sp2 = specialistsCreated[1];
        const p3 = parentsCreated[2];
        const p4 = parentsCreated[3];

        if (sp2 && p3 && p4) {
          sp2.linkedParents = [p3._id, p4._id];
          await sp2.save();

          p3.linkedSpecialist = sp2._id;
          await p3.save();
          p4.linkedSpecialist = sp2._id;
          await p4.save();
          console.log(`🔗 Linked Parents ${p3.email}, ${p4.email} to Specialist ${sp2.email}`);

          // Create referral records for these linkages
          await ensureReferral({
            parentId: p3._id,
            specialistId: sp2._id,
            referralType: 'admin_assigned',
            status: 'active',
            notes: 'Initial seed data linkage'
          });
          await ensureReferral({
            parentId: p4._id,
            specialistId: sp2._id,
            referralType: 'admin_assigned',
            status: 'active',
            notes: 'Initial seed data linkage'
          });
          console.log(`📝 Created referral records for ${p3.email} and ${p4.email}`);
        }
      }
    }

    console.log('🎉 Database seeded successfully!');
    // لا يوجد إغلاق للاتصال هنا
  } catch (error) {
    console.error('❌ Error seeding database:', error);
  }
};

// 🔑 تصدير الدالة ليتم استدعاؤها من server.js
module.exports = seedDatabase;
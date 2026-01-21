/**
 * سكريبت للتحقق من بيانات المراكز والأخصائيين
 * يساعد على تشخيص مشاكل عدم ظهور البيانات للـ Admin
 */

require('dotenv').config();
const mongoose = require('mongoose');

// الاتصال بقاعدة البيانات
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/bmo-care';

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ متصل بقاعدة البيانات');
        runDiagnostics();
    })
    .catch(err => {
        console.error('❌ خطأ في الاتصال:', err.message);
        process.exit(1);
    });

// تعريف الـ Schemas
const userSchema = new mongoose.Schema({}, { strict: false });
const centerSchema = new mongoose.Schema({}, { strict: false });
const childSchema = new mongoose.Schema({}, { strict: false });

const User = mongoose.model('User', userSchema);
const Center = mongoose.model('Center', centerSchema);
const Child = mongoose.model('Child', childSchema);

async function runDiagnostics() {
    try {
        console.log('\n' + '='.repeat(60));
        console.log('🔍 تشخيص بيانات النظام');
        console.log('='.repeat(60) + '\n');

        // 1. عرض المراكز
        const centers = await Center.find().lean();
        console.log('📊 المراكز في النظام:');
        console.log('─'.repeat(60));

        if (centers.length === 0) {
            console.log('⚠️  لا توجد مراكز في النظام!');
        } else {
            for (const center of centers) {
                console.log(`\n🏢 ${center.name || 'مركز بدون اسم'}`);
                console.log(`   ID: ${center._id}`);
                console.log(`   Admin: ${center.admin || 'غير محدد'}`);
                console.log(`   عدد الأخصائيين المسجلين: ${center.specialists?.length || 0}`);
            }
        }

        // 2. عرض المستخدمين حسب الدور
        console.log('\n' + '═'.repeat(60));
        console.log('👥 المستخدمون حسب الدور:');
        console.log('─'.repeat(60));

        const admins = await User.find({ role: 'admin' }).lean();
        console.log(`\n👔 Admins: ${admins.length}`);
        for (const admin of admins) {
            console.log(`   • ${admin.name} (${admin.email})`);
            console.log(`     المركز: ${admin.center || '❌ غير مرتبط بمركز'}`);
        }

        const specialists = await User.find({ role: 'specialist' }).lean();
        console.log(`\n👨‍⚕️ Specialists: ${specialists.length}`);
        for (const spec of specialists) {
            console.log(`   • ${spec.name} (${spec.email})`);
            console.log(`     المركز: ${spec.center || '❌ غير مرتبط بمركز'}`);
            console.log(`     الآباء المرتبطين: ${spec.linkedParents?.length || 0}`);
        }

        const parents = await User.find({ role: 'parent' }).lean();
        console.log(`\n👨‍👩‍👧 Parents: ${parents.length}`);
        for (const parent of parents) {
            console.log(`   • ${parent.name} (${parent.email})`);
            console.log(`     الأخصائي: ${parent.linkedSpecialist || '❌ غير مرتبط'}`);
        }

        // 3. عرض الأطفال
        const children = await Child.find().populate('parent').populate('assignedSpecialist').lean();
        console.log(`\n👶 الأطفال: ${children.length}`);
        for (const child of children) {
            console.log(`   • ${child.name}`);
            console.log(`     ولي الأمر: ${child.parent?.name || 'غير محدد'}`);
            console.log(`     الأخصائي: ${child.assignedSpecialist?.name || '❌ غير مُسند'}`);
        }

        // 4. التحقق من المشاكل
        console.log('\n' + '═'.repeat(60));
        console.log('⚠️  المشاكل المحتملة:');
        console.log('─'.repeat(60) + '\n');

        let issueFound = false;

        // مشكلة 1: Admins بدون مركز
        const adminsWithoutCenter = admins.filter(a => !a.center);
        if (adminsWithoutCenter.length > 0) {
            console.log(`❌ ${adminsWithoutCenter.length} admin(s) غير مرتبط بمركز:`);
            adminsWithoutCenter.forEach(a => console.log(`   • ${a.name} (${a.email})`));
            issueFound = true;
        }

        // مشكلة 2: Specialists بدون مركز
        const specialistsWithoutCenter = specialists.filter(s => !s.center);
        if (specialistsWithoutCenter.length > 0) {
            console.log(`❌ ${specialistsWithoutCenter.length} specialist(s) غير مرتبط بمركز:`);
            specialistsWithoutCenter.forEach(s => console.log(`   • ${s.name} (${s.email})`));
            issueFound = true;
        }

        // مشكلة 3: Parents بدون أخصائي
        const parentsWithoutSpecialist = parents.filter(p => !p.linkedSpecialist);
        if (parentsWithoutSpecialist.length > 0) {
            console.log(`❌ ${parentsWithoutSpecialist.length} parent(s) غير مرتبط بأخصائي:`);
            parentsWithoutSpecialist.forEach(p => console.log(`   • ${p.name} (${p.email})`));
            issueFound = true;
        }

        // مشكلة 4: Children بدون أخصائي
        const childrenWithoutSpecialist = children.filter(c => !c.assignedSpecialist);
        if (childrenWithoutSpecialist.length > 0) {
            console.log(`❌ ${childrenWithoutSpecialist.length} طفل/أطفال غير مُسند لأخصائي:`);
            childrenWithoutSpecialist.forEach(c => console.log(`   • ${c.name}`));
            issueFound = true;
        }

        if (!issueFound) {
            console.log('✅ لم يتم العثور على مشاكل في البيانات!');
        }

        // 5. توصيات للإصلاح
        if (issueFound) {
            console.log('\n' + '═'.repeat(60));
            console.log('💡 التوصيات للإصلاح:');
            console.log('─'.repeat(60) + '\n');

            if (adminsWithoutCenter.length > 0) {
                console.log('1. ربط Admins بالمراكز:');
                console.log('   يمكنك استخدام MongoDB Compass أو mongosh لتحديث حقل center');
                console.log('   مثال: db.users.updateOne({_id: ObjectId("admin_id")}, {$set: {center: ObjectId("center_id")}})');
            }

            if (specialistsWithoutCenter.length > 0) {
                console.log('\n2. ربط Specialists بالمراكز:');
                console.log('   نفس الطريقة أعلاه');
            }

            if (parentsWithoutSpecialist.length > 0) {
                console.log('\n3. ربط Parents بالأخصائيين:');
                console.log('   استخدم واجهة Specialist Portal للبحث عن الأهالي وربطهم');
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('✅ انتهى التشخيص');
        console.log('='.repeat(60) + '\n');

    } catch (error) {
        console.error('❌ خطأ:', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('تم قطع الاتصال بقاعدة البيانات');
        process.exit(0);
    }
}

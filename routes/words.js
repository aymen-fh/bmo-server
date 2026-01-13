const express = require('express');
const router = express.Router();
const Exercise = require('../models/Exercise');
const { protect } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

async function getOrCreateContentDoc(childId) {
    return Exercise.findOneAndUpdate(
        { child: childId, kind: 'content' },
        { $setOnInsert: { child: childId, kind: 'content', active: true } },
        { new: true, upsert: true, runValidators: true }
    );
}

function asLegacyWordItem(item, contentType, childId) {
    return {
        _id: item._id,
        text: item.text,
        contentType,
        difficulty: item.difficulty,
        image: item.image,
        child: childId,
        createdBy: item.createdBy,
        createdAt: item.createdAt
    };
}

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Storage config
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'word-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
        if (mimetype && extname) return cb(null, true);
        cb(new Error('Images only!'));
    }
});

// @route   POST /api/words
// @desc    Create a new word or letter
// @access  Private
// دعم ربط كل كلمة/حرف بجلسة خطة (plan session) عبر sessionId اختياري
router.post('/', protect, upload.single('image'), async (req, res) => {
    try {
        const { text, contentType, difficulty, childId, sessionId } = req.body;

        if (!text || !childId) {
            return res.status(400).json({
                success: false,
                message: 'Text and Child ID are required'
            });
        }

        let imagePath = 'default-word.png';
        if (req.file) {
            imagePath = `/uploads/${req.file.filename}`;
        }

        const type = contentType || 'word';
        if (!['word', 'letter'].includes(type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid contentType'
            });
        }

        const trimmed = text.trim();
        // إذا sessionId موجود: أضف للكلمات/الحروف الخاصة بالجلسة (Exercise.kind=plan)
        if (sessionId) {
            const plan = await Exercise.findOne({ _id: sessionId, kind: 'plan', child: childId });
            if (!plan) {
                return res.status(404).json({ success: false, message: 'Plan session not found' });
            }
            const arr = type === 'word' ? plan.words : plan.letters;
            const exists = arr.some(i => (i.word || i.letter) === trimmed);
            if (exists) {
                return res.status(400).json({ success: false, message: `${type === 'word' ? 'Word' : 'Letter'} already exists in this session` });
            }
            if (type === 'word') {
                arr.push({ word: trimmed, difficulty: difficulty || 'easy', image: imagePath });
            } else {
                arr.push({ letter: trimmed, difficulty: difficulty || 'easy', image: imagePath });
            }
            await plan.save();
            return res.status(201).json({ success: true });
        }

        // إذا لم يوجد sessionId: أضف للمحتوى العام (contentWords/contentLetters)
        const doc = await getOrCreateContentDoc(childId);
        const targetArr = type === 'word' ? doc.contentWords : doc.contentLetters;
        const exists = targetArr.some(i => i.text === trimmed);
        if (exists) {
            return res.status(400).json({
                success: false,
                message: `${type === 'word' ? 'Word' : 'Letter'} already exists for this child`
            });
        }
        const created = targetArr.create({
            text: trimmed,
            difficulty: difficulty || 'easy',
            image: imagePath,
            createdBy: req.user.id
        });
        targetArr.push(created);
        await doc.save();
        const word = asLegacyWordItem(created, type, childId);
        res.status(201).json({ success: true, word });
    } catch (error) {
        console.error('Error creating word:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// @route   DELETE /api/words/:id
// @desc    Delete a word
// @access  Private
router.delete('/:id', protect, async (req, res) => {
    try {
        const contentId = req.params.id;
        const doc = await Exercise.findOne({
            kind: 'content',
            $or: [
                { 'contentWords._id': contentId },
                { 'contentLetters._id': contentId }
            ]
        });

        if (!doc) {
            return res.status(404).json({
                success: false,
                message: 'Word not found'
            });
        }

        const wordItem = doc.contentWords?.id(contentId);
        const letterItem = doc.contentLetters?.id(contentId);

        if (wordItem) wordItem.deleteOne();
        if (letterItem) letterItem.deleteOne();

        await doc.save();

        res.json({
            success: true,
            message: 'Word deleted',
            childId: doc.child // Return childId to help frontend redirect
        });
    } catch (error) {
        console.error('Error deleting word:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// Get words for a specific child
// دعم جلب محتوى Session محددة (عبر sessionId) أو المحتوى العام فقط
router.get('/child/:childId', protect, async (req, res) => {
    try {
        const { childId } = req.params;
        const { difficulty, contentType, sessionId } = req.query;

        const difficultyOk = (item) => !difficulty || item.difficulty === difficulty;

        let localWords = [];
        let localLetters = [];

        if (sessionId) {
            // جلب محتوى جلسة خطة محددة (plan)
            const plan = await Exercise.findOne({ _id: sessionId, kind: 'plan', child: childId });
            if (plan) {
                if (!contentType || contentType === 'word') {
                    localWords = (plan.words || [])
                        .filter(difficultyOk)
                        .map(i => ({ _id: i._id, text: i.word, contentType: 'word', difficulty: i.difficulty, image: i.image, child: childId, createdAt: i.createdAt }));
                }
                if (!contentType || contentType === 'letter') {
                    localLetters = (plan.letters || [])
                        .filter(difficultyOk)
                        .map(i => ({ _id: i._id, text: i.letter, contentType: 'letter', difficulty: i.difficulty, image: i.image, child: childId, createdAt: i.createdAt }));
                }
            }
        } else {
            // جلب المحتوى العام (contentWords/contentLetters)
            const doc = await Exercise.findOne({ child: childId, kind: 'content' });
            if (!contentType || contentType === 'word') {
                localWords = (doc?.contentWords || [])
                    .filter(difficultyOk)
                    .map(i => asLegacyWordItem(i, 'word', childId))
                    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            }
            if (!contentType || contentType === 'letter') {
                localLetters = (doc?.contentLetters || [])
                    .filter(difficultyOk)
                    .map(i => asLegacyWordItem(i, 'letter', childId))
                    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            }
        }

        res.json({
            success: true,
            words: localWords,
            letters: localLetters
        });
    } catch (error) {
        console.error('Error fetching words:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching words'
        });
    }
});

// Get all words (for admin/specialist)
router.get('/', protect, async (req, res) => {
    try {
        const docs = await Exercise.find({ kind: 'content' })
            .populate('child', 'name')
            .sort('-updatedAt');

        const words = [];
        for (const doc of docs) {
            const childRef = doc.child?._id ? doc.child._id : doc.child;

            for (const item of (doc.contentWords || [])) {
                const mapped = asLegacyWordItem(item, 'word', childRef);
                mapped.child = doc.child;
                words.push(mapped);
            }
            for (const item of (doc.contentLetters || [])) {
                const mapped = asLegacyWordItem(item, 'letter', childRef);
                mapped.child = doc.child;
                words.push(mapped);
            }
        }

        words.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

        res.json({
            success: true,
            words
        });
    } catch (error) {
        console.error('Error fetching words:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching words'
        });
    }
});

module.exports = router;

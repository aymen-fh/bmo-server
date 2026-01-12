const express = require('express');
const router = express.Router();
const Exercise = require('../models/Exercise');
const Child = require('../models/Child');
const User = require('../models/User');
const Progress = require('../models/Progress');
const { protect } = require('../middleware/auth');
const LinkRequest = require('../models/LinkRequest');

async function getOrCreateContentDoc(childId) {
    return Exercise.findOneAndUpdate(
        { child: childId, kind: 'content' },
        { $setOnInsert: { child: childId, kind: 'content', active: true } },
        { new: true, upsert: true, runValidators: true }
    );
}

function asLegacyContentItem(item, contentType, childId) {
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

// @route   GET /api/specialist/dashboard
// @desc    Get specialist dashboard stats
// @access  Private (Specialist)
router.get('/dashboard', protect, async (req, res) => {
    try {
        const specialistId = req.user.id;

        const [childrenCount, linkRequestsCount, linkedParentsCount, assignedChildrenIds] = await Promise.all([
            Child.countDocuments({ assignedSpecialist: specialistId }),
            LinkRequest.countDocuments({ to: specialistId, status: 'pending' }),
            User.findById(specialistId).then(user => user.linkedParents ? user.linkedParents.length : 0),
            Child.find({ assignedSpecialist: specialistId }).select('_id').lean()
        ]);

        const childIds = (assignedChildrenIds || []).map(c => c._id);
        let sessionsCount = 0;
        if (childIds.length > 0) {
            const sessionsAgg = await Progress.aggregate([
                { $match: { child: { $in: childIds } } },
                { $project: { sessionCount: { $size: { $ifNull: ['$sessions', []] } } } },
                { $group: { _id: null, total: { $sum: '$sessionCount' } } }
            ]);
            sessionsCount = sessionsAgg && sessionsAgg.length > 0 ? sessionsAgg[0].total : 0;
        }

        // Get recent 5 children
        let recentChildren = [];
        try {
            // Get children as plain objects
            recentChildren = await Child.find({ assignedSpecialist: specialistId })
                .sort('-createdAt')
                .limit(5)
                .lean();

            // Manually populate parents to avoid Schema reference issues
            const parentIds = recentChildren
                .map(c => c.parent)
                .filter(id => id); // Filter out null/undefined

            if (parentIds.length > 0) {
                const parents = await User.find({ _id: { $in: parentIds } })
                    .select('name email phone profilePhoto staffId')
                    .lean();

                // Create a map for faster lookup
                const parentMap = {};
                parents.forEach(p => {
                    parentMap[p._id.toString()] = p;
                });

                // Attach parent objects to children
                recentChildren.forEach(child => {
                    if (child.parent && parentMap[child.parent.toString()]) {
                        child.parent = parentMap[child.parent.toString()];
                    }
                });
            }
        } catch (err) {
            console.error('Error fetching recent children:', err);
            // Don't fail the whole dashboard
        }

        res.json({
            success: true,
            stats: {
                children: childrenCount,
                pendingRequests: linkRequestsCount,
                parents: linkedParentsCount,
                sessions: sessionsCount
            },
            recentChildren
        });
    } catch (error) {
        console.error('Dashboard Stats Error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching dashboard stats'
        });
    }
});

// @route   GET /api/specialist/words
// @desc    Get specialist words management page data
// @access  Private (Specialist)
router.get('/words', protect, async (req, res) => {
    try {
        const { childId, contentType, difficulty } = req.query;

        // If childId is provided, get content for that child
        if (childId) {
            // Verify the child is assigned to this specialist
            const child = await Child.findById(childId);
            if (!child || child.assignedSpecialist.toString() !== req.user.id) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized to access this child'
                });
            }

            const doc = await Exercise.findOne({ child: childId, kind: 'content' });
            const difficultyOk = (item) => !difficulty || !['easy', 'medium', 'hard'].includes(difficulty) || item.difficulty === difficulty;

            // Get content based on type
            let words = [];
            let letters = [];

            if (!contentType || contentType === 'word') {
                words = (doc?.contentWords || [])
                    .filter(difficultyOk)
                    .map(i => asLegacyContentItem(i, 'word', childId))
                    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            }
            if (!contentType || contentType === 'letter') {
                letters = (doc?.contentLetters || [])
                    .filter(difficultyOk)
                    .map(i => asLegacyContentItem(i, 'letter', childId))
                    .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
            }

            res.json({
                success: true,
                mode: 'manage_child',
                child: {
                    _id: child._id,
                    name: child.name,
                    age: child.age,
                    avatarId: child.avatarId
                },
                words,
                letters,
                contentType: contentType || 'word',
                difficulty
            });
        } else {
            // Get all children assigned to this specialist
            const children = await Child.find({ assignedSpecialist: req.user.id })
                .populate('parent', 'name')
                .select('_id name age parent avatarId');

            res.json({
                success: true,
                mode: 'select_child',
                children
            });
        }
    } catch (error) {
        console.error('Error in specialist words route:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching data'
        });
    }
});

// @route   POST /api/specialist/content/add
// @desc    Add new content (word or letter) for a child
// @access  Private (Specialist)
router.post('/content/add', protect, async (req, res) => {
    try {
        const { text, contentType, difficulty, childId } = req.body;

        // Validate required fields
        if (!text || !contentType || !childId) {
            return res.status(400).json({
                success: false,
                message: 'Text, content type, and child ID are required'
            });
        }

        // Validate content type
        if (!['word', 'letter'].includes(contentType)) {
            return res.status(400).json({
                success: false,
                message: 'Content type must be either "word" or "letter"'
            });
        }

        // Verify the child is assigned to this specialist
        const child = await Child.findById(childId);
        if (!child || child.assignedSpecialist.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to add content for this child'
            });
        }

        // Validate difficulty
        if (difficulty && !['easy', 'medium', 'hard'].includes(difficulty)) {
            return res.status(400).json({
                success: false,
                message: 'Difficulty must be easy, medium, or hard'
            });
        }

        // Validate text length based on content type
        if (contentType === 'letter' && text.length > 2) {
            return res.status(400).json({
                success: false,
                message: 'Letter with vowel must not exceed 2 characters'
            });
        }

        if (contentType === 'word' && text.length > 20) {
            return res.status(400).json({
                success: false,
                message: 'Word must not exceed 20 characters'
            });
        }

        const trimmed = text.trim();
        const doc = await getOrCreateContentDoc(childId);
        const targetArr = contentType === 'word' ? doc.contentWords : doc.contentLetters;

        const exists = targetArr.some(i => i.text === trimmed);
        if (exists) {
            return res.status(400).json({
                success: false,
                message: `${contentType === 'word' ? 'Word' : 'Letter'} already exists for this child`
            });
        }

        const created = targetArr.create({
            text: trimmed,
            difficulty: difficulty || 'easy',
            createdBy: req.user.id
        });
        targetArr.push(created);
        await doc.save();

        const content = asLegacyContentItem(created, contentType, childId);

        res.status(201).json({
            success: true,
            message: `${contentType === 'word' ? 'Word' : 'Letter'} added successfully`,
            content
        });
    } catch (error) {
        console.error('Error adding content:', error);
        res.status(500).json({
            success: false,
            message: 'Error adding content'
        });
    }
});

// @route   POST /api/specialist/content/delete/:contentId
// @desc    Delete content by ID
// @access  Private (Specialist)
router.post('/content/delete/:contentId', protect, async (req, res) => {
    try {
        const { contentId } = req.params;

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
                message: 'Content not found'
            });
        }

        // Verify the content belongs to a child assigned to this specialist
        const child = await Child.findById(doc.child);
        if (!child || child.assignedSpecialist.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete this content'
            });
        }

        const wordItem = doc.contentWords?.id(contentId);
        const letterItem = doc.contentLetters?.id(contentId);

        if (wordItem) wordItem.deleteOne();
        if (letterItem) letterItem.deleteOne();

        await doc.save();

        res.json({
            success: true,
            message: 'Content deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting content:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting content'
        });
    }
});

module.exports = router;
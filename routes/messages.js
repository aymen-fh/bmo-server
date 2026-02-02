const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const User = require('../models/User');
const DeviceToken = require('../models/DeviceToken');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const { sendToTokens } = require('../services/pushService');

// @route   POST /api/messages
// @desc    Send a new message
// @access  Private
router.post('/', protect, async (req, res) => {
    try {
        const { receiverId, content } = req.body;

        if (!receiverId || !content) {
            return res.status(400).json({
                success: false,
                message: 'Receiver ID and content are required'
            });
        }

        // Check if receiver exists
        const receiver = await User.findById(receiverId);
        if (!receiver) {
            return res.status(404).json({
                success: false,
                message: 'Receiver not found'
            });
        }

        // Create the message
        const message = await Message.create({
            sender: req.user.id,
            receiver: receiverId,
            content: content.trim()
        });

        // Populate sender info
        await message.populate('sender', 'name email role');
        await message.populate('receiver', 'name email role');

        // Emit realtime event
        const io = req.app.get('io');
        if (io) {
            io.to(req.user.id.toString()).emit('new_message', message);
            io.to(receiverId.toString()).emit('new_message', message);
        }

        // Send push notification to receiver devices (best-effort, non-blocking)
        setImmediate(async () => {
            try {
                const tokensDocs = await DeviceToken.find({ user: receiverId }).select('token');
                const tokens = tokensDocs.map(d => d.token).filter(Boolean);

                if (tokens.length > 0) {
                    const senderName = message.sender?.name || 'رسالة جديدة';
                    const body = message.content || 'لديك رسالة جديدة';

                    await sendToTokens({
                        tokens,
                        notification: {
                            title: senderName,
                            body,
                        },
                        data: {
                            type: 'chat',
                            senderId: message.sender?._id?.toString() || req.user.id.toString(),
                            senderName: senderName.toString(),
                            content: (message.content || '').toString(),
                        },
                    });
                }
            } catch (pushError) {
                console.warn('⚠️ Push send failed:', pushError?.message || pushError);
            }
        });

        res.status(201).json({
            success: true,
            message
        });
    } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   GET /api/messages/unread/count
// @desc    Get count of all unread messages
// @access  Private
router.get('/unread/count', protect, async (req, res) => {
    try {
        const count = await Message.countDocuments({
            receiver: req.user.id,
            isRead: false
        });

        res.json({
            success: true,
            unreadCount: count
        });
    } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   GET /api/messages/conversations
// @desc    Get all conversations for current user
// @access  Private
router.get('/conversations', protect, async (req, res) => {
    try {
        const userId = req.user.id;

        // Get all unique users that the current user has exchanged messages with
        const sentMessages = await Message.aggregate([
            { $match: { sender: new mongoose.Types.ObjectId(userId) } },
            { $group: { _id: '$receiver' } }
        ]);

        const receivedMessages = await Message.aggregate([
            { $match: { receiver: new mongoose.Types.ObjectId(userId) } },
            { $group: { _id: '$sender' } }
        ]);

        // Combine and get unique user IDs
        const userIds = [...new Set([
            ...sentMessages.map(m => m._id.toString()),
            ...receivedMessages.map(m => m._id.toString())
        ])];

        // Get conversations with details
        const conversations = await Promise.all(userIds.map(async (otherUserId) => {
            const otherUser = await User.findById(otherUserId)
                .select('name email role profilePhoto');

            if (!otherUser) return null;

            // Get the last message between the two users
            const lastMessage = await Message.findOne({
                $or: [
                    { sender: userId, receiver: otherUserId },
                    { sender: otherUserId, receiver: userId }
                ]
            }).sort({ createdAt: -1 });

            // Count unread messages from this user
            const unreadCount = await Message.countDocuments({
                sender: otherUserId,
                receiver: userId,
                isRead: false
            });

            return {
                user: otherUser,
                lastMessage: lastMessage ? {
                    content: lastMessage.content,
                    createdAt: lastMessage.createdAt,
                    isFromMe: lastMessage.sender.toString() === userId
                } : null,
                unreadCount
            };
        }));

        // Filter out null values and sort by last message time
        const validConversations = conversations
            .filter(c => c !== null)
            .sort((a, b) => {
                if (!a.lastMessage) return 1;
                if (!b.lastMessage) return -1;
                return new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt);
            });

        res.json({
            success: true,
            count: validConversations.length,
            conversations: validConversations
        });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   GET /api/messages/:userId
// @desc    Get messages between current user and another user
// @access  Private
router.get('/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUserId = req.user.id;
        const { page = 1, limit = 50 } = req.query;

        // Check if user exists
        const otherUser = await User.findById(userId);
        if (!otherUser) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Get messages between the two users
        const messages = await Message.find({
            $or: [
                { sender: currentUserId, receiver: userId },
                { sender: userId, receiver: currentUserId }
            ]
        })
            .sort({ createdAt: 1 })
            .skip((page - 1) * limit)
            .limit(parseInt(limit))
            .populate('sender', 'name email role')
            .populate('receiver', 'name email role');

        // Mark received messages as read
        await Message.updateMany(
            {
                sender: userId,
                receiver: currentUserId,
                isRead: false
            },
            {
                isRead: true,
                readAt: new Date()
            }
        );

        res.json({
            success: true,
            count: messages.length,
            messages
        });
    } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   PUT /api/messages/:messageId/read
// @desc    Mark a message as read
// @access  Private
router.put('/:messageId/read', protect, async (req, res) => {
    try {
        const { messageId } = req.params;

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Only the receiver can mark the message as read
        if (message.receiver.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        message.isRead = true;
        message.readAt = new Date();
        await message.save();

        res.json({
            success: true,
            message
        });
    } catch (error) {
        console.error('Error marking message as read:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   DELETE /api/messages/:messageId
// @desc    Delete a message
// @access  Private
router.delete('/:messageId', protect, async (req, res) => {
    try {
        const { messageId } = req.params;

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Only the sender can delete the message
        if (message.sender.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        const io = req.app.get('io');
        if (io) {
            io.to(message.sender.toString()).emit('message_deleted', { messageId });
            io.to(message.receiver.toString()).emit('message_deleted', { messageId });
        }

        await message.deleteOne();

        res.json({
            success: true,
            message: 'Message deleted'
        });
    } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   PUT /api/messages/:messageId
// @desc    Edit a message
// @access  Private
router.put('/:messageId', protect, async (req, res) => {
    try {
        const { messageId } = req.params;
        const { content } = req.body;

        if (!content) {
            return res.status(400).json({
                success: false,
                message: 'Content is required'
            });
        }

        const message = await Message.findById(messageId);

        if (!message) {
            return res.status(404).json({
                success: false,
                message: 'Message not found'
            });
        }

        // Only the sender can edit the message
        if (message.sender.toString() !== req.user.id) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized'
            });
        }

        message.content = content.trim();
        message.isEdited = true; // Add this field to schema if needed, or just rely on updatedAt vs createdAt
        await message.save();

        await message.populate('sender', 'name email role');
        await message.populate('receiver', 'name email role');

        const io = req.app.get('io');
        if (io) {
            io.to(message.sender._id.toString()).emit('message_edited', message);
            io.to(message.receiver._id.toString()).emit('message_edited', message);
        }

        res.json({
            success: true,
            message
        });
    } catch (error) {
        console.error('Error editing message:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// @route   DELETE /api/messages/conversations/:userId
// @desc    Delete entire conversation with a user
// @access  Private
router.delete('/conversations/:userId', protect, async (req, res) => {
    try {
        const { userId } = req.params;
        const currentUserId = req.user.id;

        // Delete all messages between current user and specified user
        await Message.deleteMany({
            $or: [
                { sender: currentUserId, receiver: userId },
                { sender: userId, receiver: currentUserId }
            ]
        });

        res.json({
            success: true,
            message: 'Conversation deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting conversation:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

module.exports = router;

const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const Restaurant = require("../models/Restaurant");

const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

async function getParticipantRole(conversation, userId) {
    const restaurant = await Restaurant.findById(conversation.restaurantId).select("owner");
    if (!restaurant?.owner) return null;
    if (String(conversation.userId) === String(userId)) return "customer";
    if (String(restaurant.owner) === String(userId)) return "owner";
    return null;
}

// POST /api/messages/conversations
exports.createConversation = async (req, res) => {
    try {
        const { restaurantId } = req.body;
        if (!isObjectId(restaurantId)) return res.status(400).json({ message: "A valid restaurantId is required." });

        const restaurant = await Restaurant.findById(restaurantId).select("owner name");
        if (!restaurant) return res.status(404).json({ message: "Restaurant not found." });
        if (!restaurant.owner) return res.status(409).json({ message: "This restaurant does not have an owner available for messages." });
        if (String(restaurant.owner) === String(req.user.id)) return res.status(400).json({ message: "You cannot start a conversation with your own restaurant." });

        const conversation = await Conversation.findOneAndUpdate(
            { userId: req.user.id, restaurantId },
            { $setOnInsert: { userId: req.user.id, restaurantId, lastMessage: "", lastMessageAt: new Date() } },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );
        return res.status(201).json({ conversation });
    } catch (error) {
        // A concurrent first request may hit the unique compound index.
        if (error?.code === 11000) {
            const conversation = await Conversation.findOne({ userId: req.user.id, restaurantId: req.body.restaurantId });
            return res.status(200).json({ conversation });
        }
        console.error("Create conversation error:", error);
        return res.status(500).json({ message: "Unable to create conversation." });
    }
};

// POST /api/messages/send
exports.sendMessage = async (req, res) => {
    try {
        const { conversationId, content } = req.body;
        if (!isObjectId(conversationId) || !String(content || "").trim()) {
            return res.status(400).json({ message: "conversationId and message content are required." });
        }
        const conversation = await Conversation.findById(conversationId);
        if (!conversation?.isActive) return res.status(404).json({ message: "Conversation not found." });
        const senderRole = await getParticipantRole(conversation, req.user.id);
        if (!senderRole) return res.status(403).json({ message: "You are not a participant in this conversation." });

        const message = await Message.create({
            conversationId: conversation._id,
            sender: req.user.id,
            senderRole,
            content: String(content).trim(),
        });
        conversation.lastMessage = message.content;
        conversation.lastMessageAt = message.createdAt;
        await conversation.save();
        return res.status(201).json({ message });
    } catch (error) {
        console.error("Send message error:", error);
        return res.status(500).json({ message: "Unable to send message." });
    }
};

// GET /api/messages/:conversationId
exports.getMessages = async (req, res) => {
    try {
        const { conversationId } = req.params;
        if (!isObjectId(conversationId)) return res.status(400).json({ message: "A valid conversationId is required." });
        const conversation = await Conversation.findById(conversationId);
        if (!conversation) return res.status(404).json({ message: "Conversation not found." });
        if (!await getParticipantRole(conversation, req.user.id)) return res.status(403).json({ message: "You are not a participant in this conversation." });

        const messages = await Message.find({ conversationId }).sort({ createdAt: 1 }).populate("sender", "username avatar");
        await Message.updateMany({ conversationId, sender: { $ne: req.user.id }, isRead: false }, { $set: { isRead: true } });
        return res.json({ conversationId, messages });
    } catch (error) {
        console.error("Get messages error:", error);
        return res.status(500).json({ message: "Unable to load messages." });
    }
};

// GET /api/messages/mine
exports.getMyConversations = async (req, res) => {
    try {
        const ownedRestaurantIds = await Restaurant.find({ owner: req.user.id }).distinct("_id");
        const conversations = await Conversation.find({
            $or: [{ userId: req.user.id }, { restaurantId: { $in: ownedRestaurantIds } }],
        })
            .populate("userId", "username avatar")
            .populate({
                path: "restaurantId",
                select: "name image address owner",
                populate: { path: "owner", select: "username avatar" },
            })
            .sort({ lastMessageAt: -1 });
        const conversationIds = conversations.map((conversation) => conversation._id);
        const unreadCounts = await Message.aggregate([
            {
                $match: {
                    conversationId: { $in: conversationIds },
                    sender: { $ne: new mongoose.Types.ObjectId(req.user.id) },
                    isRead: false,
                },
            },
            { $group: { _id: "$conversationId", count: { $sum: 1 } } },
        ]);
        const unreadByConversation = new Map(unreadCounts.map((item) => [String(item._id), item.count]));
        const result = conversations.map((conversation) => ({
            ...conversation.toObject(),
            unreadCount: unreadByConversation.get(String(conversation._id)) || 0,
        }));
        return res.json({
            conversations: result,
            unreadCount: result.reduce((total, conversation) => total + conversation.unreadCount, 0),
        });
    } catch (error) {
        console.error("Get conversations error:", error);
        return res.status(500).json({ message: "Unable to load conversations." });
    }
};

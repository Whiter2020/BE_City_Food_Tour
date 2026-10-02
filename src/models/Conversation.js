const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
    {
        // Customer who started the conversation.
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        restaurantId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Restaurant",
            required: true,
        },
        lastMessage: { type: String, default: "" },
        lastMessageAt: { type: Date, default: Date.now },
        isActive: { type: Boolean, default: true },
    },
    { timestamps: true }
);

// One customer has one thread with one restaurant.
conversationSchema.index({ userId: 1, restaurantId: 1 }, { unique: true });

module.exports = mongoose.model("Conversation", conversationSchema);

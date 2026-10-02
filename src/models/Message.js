const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Conversation",
            required: true,
        },
        // Always filled from the authenticated account, never supplied by the client.
        sender: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true,
        },
        senderRole: {
            type: String,
            enum: ["customer", "owner"],
            required: true,
        },
        content: { type: String, required: true, trim: true, maxlength: 2000 },
        isRead: { type: Boolean, default: false },
        messageType: { type: String, enum: ["text"], default: "text" },
    },
    { timestamps: true }
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

module.exports = mongoose.model("Message", messageSchema);

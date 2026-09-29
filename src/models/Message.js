const mongoose = require("mongoose");


const messageSchema = new mongoose.Schema(
  {
    conversationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
    },

    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    senderType: {
      type: String,
      enum: ["user", "restaurant"],
      required: true,
    },

    content: {
      type: String,
      required: true,
      trim: true,
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    messageType: {
      type: String,
      enum: ["text", "image"],
      default: "text",
    },
  },
  
  {
    timestamps: true,
  }
);

messageSchema.index({
  conversationId: 1,
  createdAt: 1,
});



module.exports = mongoose.model(
  "Message",
  messageSchema
);
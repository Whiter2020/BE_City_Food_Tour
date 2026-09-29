const mongoose = require("mongoose");

const conversationSchema = new mongoose.Schema(
  {
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

    lastMessage: {
      type: String,
      default: "",
    },

    lastMessageAt: {
      type: Date,
      default: Date.now,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);


// Tránh tạo duplicate conversation giữa 1 user và 1 restaurant
conversationSchema.index(
  {
    userId: 1,
    restaurantId: 1,
  },
  {
    unique: true,
  }
);


module.exports = mongoose.model(
  "Conversation",
  conversationSchema
);
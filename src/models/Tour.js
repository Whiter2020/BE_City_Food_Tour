const mongoose = require("mongoose");

const tourSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    restaurants: [
      {
        restaurant: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Restaurant",
          required: true,
        },
        order: {
          type: Number, // thứ tự trong tour
          required: true,
        },
        estimatedTime: {
          type: Number, // phút
          default: 0,
        },
        estimatedCost: {
          type: Number,
          default: 0,
        },
      },
    ],
    totalDistance: {
      type: Number, // km
      default: 0,
    },
    totalTime: {
      type: Number, // phút
      default: 0,
    },
    estimatedTotalCost: {
      type: Number,
      default: 0,
    },
    isOptimized: {
      type: Boolean,
      default: false,
    },
    isPublic: {
      type: Boolean,
      default: false,
    },
    description: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Tour", tourSchema);
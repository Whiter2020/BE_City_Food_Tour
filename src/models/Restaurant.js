const mongoose = require("mongoose");

// Subdocument: Dish
const dishSchema = new mongoose.Schema(
    {
        id: Number,
        name: String,
        price: String,
        image: String,
        isSignature: { type: Boolean, default: false }, // new field
    },
    { _id: false }
);

// New Review subdocument schema
const reviewSchema = new mongoose.Schema(
    {
        id: Number,
        user: String,
        avatar: String,
        rating: Number,
        date: String,
        text: String,
    },
    { _id: false }
);


const restaurantSchema = new mongoose.Schema(
    {
        // id theo thứ tự trong DB (1,2,3,...)
        id: { type: Number, unique: true },

        name: { type: String, required: true },
        address: String,
        district: String,
        rating: { type: Number, default: 0 },

        priceRange: {
            type: String,
            enum: ["$", "$$", "$$$", "$$$$", "$$$$$"],
            default: "$$",
        },
        
        budget: {
            type: Number,
            default: 0
        },

        image: String,
        description: String,
        phone: String,



        lat: { type: Number, default: null },
        lng: { type: Number, default: null },

        tags: {
            type: [String],
            default: ["Any"]
        },

        openingTime: String,   // "09:00"
        closingTime: String,   // "22:00"

        // New fields
        amenities: { type: [String], default: [] },
        reviewCount: { type: Number, default: 0 },
        reviews: { type: [reviewSchema], default: [] },

        dishes: { type: [dishSchema], default: [] },

    },
    { timestamps: true }
);

module.exports = mongoose.model("Restaurant", restaurantSchema);

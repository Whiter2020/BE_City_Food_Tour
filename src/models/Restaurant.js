const mongoose = require("mongoose");
const CUISINE_ENUM = ["Any", "Vietnamese", "Street Food", "Drinks", "Seafood", "Hotpot & BBQ"];

// Subdocument: Dish
const dishSchema = new mongoose.Schema(
    {
        id: Number,
        name: String,
        price: String,
        image: String,
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
        image: String,
        description: String,
        phone: String,



        lat: { type: Number, default: null },
        lng: { type: Number, default: null },

        tags: {
            type: [String],
            enum: CUISINE_ENUM,
            default: ["Any"]
        },

        openingTime: String,   // "09:00"
        closingTime: String,   // "22:00"

        dishes: { type: [dishSchema], default: [] },

    },
    { timestamps: true }
);

module.exports = mongoose.model("Restaurant", restaurantSchema);

const mongoose = require("mongoose");

const restaurantRequestSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        name: {
            type: String,
            required: true,
            trim: true
        },


        address: {
            type: String,
            required: true,
            trim: true
        },

        streetAddress: { type: String, trim: true, default: "" },
        ward: { type: String, trim: true, default: "" },
        city: { type: String, trim: true, default: "" },
        country: { type: String, trim: true, default: "" },
        district: { type: String, trim: true, default: "" },
        districtCode: { type: String, trim: true, default: "" },
        cityCode: { type: String, trim: true, default: "" },
        lat: { type: Number, default: null },
        lng: { type: Number, default: null },

        openingTime: { type: String, trim: true, default: "" },
        closingTime: { type: String, trim: true, default: "" },
        dishes: {
            type: [{
                name: { type: String, trim: true, required: true },
                price: { type: String, trim: true, default: "" },
                image: { type: String, trim: true, default: "" },
            }],
            default: [],
        },


        cuisine: {
            type: String,
            trim: true,
            default: ""
        },

        tags: {
            type: [String],
            default: []
        },

        amenities: {
            type: [String],
            default: []
        },


        image: {
            type: String,
            default: null
        },


        description: {
            type: String,
            default: null
        },

        status: {
            type: String,
            enum: [
                "Pending",
                "Approved",
                "Rejected"
            ],
            default: "Pending"
        },

        adminNote: {
            type: String,
            default: null
        }

    },
    {
        timestamps: true
    }
);


module.exports = mongoose.model(
    "RestaurantRequest",
    restaurantRequestSchema
);

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


        cuisine: {
            type: String,
            required: true,
            trim: true
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
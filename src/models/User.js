const mongoose = require("mongoose");


const userSchema = new mongoose.Schema(
    {

        // ID số dùng cho frontend nếu cần
        id: {
            type: Number,
            unique: true,
            sparse: true
        },


        // ==========================
        // AUTH INFORMATION
        // ==========================

        email: {
            type: String,
            required: true,
            unique: true,
            trim: true,
            lowercase: true
        },

        username: {
            type: String,
            trim: true
        },

        password: {
            type: String,
            required: true
        },


        role: {
            type: String,
            enum: ["admin", "user"],
            default: "user"
        },


        isLocked: {
            type: Boolean,
            default: false
        },


        // ==========================
        // PROFILE
        // ==========================

        phone: {
            type: String,
            trim: true,
            default: null
        },


        avatar: {
            type: String,
            default: null
        },


        // ==========================
        // PERSONALIZATION
        // ==========================


        // User chọn sở thích món ăn
        // Ví dụ:
        // ["Vietnamese","Seafood"]
        taste_profile: {
            type: [String],
            default: ["Any"]
        },



        // ==========================
        // FAVORITE RESTAURANTS
        // ==========================

        // Giữ lại để frontend hiện danh sách yêu thích
        favorites: {
            type: [Number],
            default: []
        },



        // ==========================
        // USER BEHAVIOR HISTORY
        // Dùng cho Recommendation System
        // ==========================


        // Lịch sử tìm kiếm
        search_history: [
            {
                keyword: {
                    type: String,
                    trim: true
                },

                createdAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ],



        // Nhà hàng user từng xem
        viewed_restaurants: [
            {
                restaurant_id: {
                    type: Number
                },

                viewedAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ],



        // Nhà hàng user thích
        // Recommendation sẽ dùng dữ liệu này
        liked_restaurants: [
            {
                restaurant_id: {
                    type: Number
                },

                likedAt: {
                    type: Date,
                    default: Date.now
                }
            }
        ],



        // ==========================
        // RESTAURANT OWNER
        // ==========================

        isRestaurantOwner: {
            type: Boolean,
            default: false
        }

    },


    {
        timestamps: true
    }

);




// ==========================
// Auto Increment User ID
// ==========================

userSchema.pre("save", async function () {

    if (!this.isNew || this.id != null) {
        return;
    }


    const lastUser =
        await this.constructor
            .findOne()
            .sort({ id: -1 })
            .lean();



    this.id =
        lastUser
            ? lastUser.id + 1
            : 1;

});



module.exports = mongoose.model(
    "User",
    userSchema
);
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
    {
        id: { type: Number, unique: true, sparse: true },

        email: { type: String, required: true, unique: true, trim: true, lowercase: true },
        username: { type: String, trim: true },
        password: { type: String, required: true },

        role: { type: String, enum: ["admin", "user"], default: "user" },
        isLocked: { type: Boolean, default: false },

        phone: { type: String, trim: true, default: null },

        avatar: { type: String, default: null },

        taste_profile: { type: [String], default: ["Any"] },
        favorites: { type: [Number], default: [] },
    },
    { timestamps: true }
);

// Auto-increment user.id
userSchema.pre("save", async function () {
    if (!this.isNew || this.id != null) return;

    const lastUser = await this.constructor.findOne().sort({ id: -1 }).lean();
    this.id = lastUser ? lastUser.id + 1 : 1;
});

module.exports = mongoose.model("User", userSchema);

const User = require("../models/User");

exports.getAllUsers = async (req, res) => {
    try {
        const users = await User.find().select("email username role createdAt isLocked");
        res.json(users);
    } catch (err) {
        console.error("Error fetching users:", err);
        res.status(500).json({ message: "Error fetching users" });
    }
};

exports.deleteUser = async (req, res) => {
    try {
        await User.findByIdAndDelete(req.params.id);
        res.json({ message: "User deleted" });
    } catch (err) {
        console.error("Error deleting user:", err);
        res.status(500).json({ message: "Error deleting user" });
    }
};

exports.lockUser = async (req, res) => {
    try {
        const updated = await User.findByIdAndUpdate(
            req.params.id,
            { isLocked: true },
            { new: true }
        ).select("email username role createdAt isLocked");

        if (!updated) return res.status(404).json({ message: "User not found" });

        res.json(updated);
    } catch (err) {
        console.error("Error locking user:", err);
        res.status(500).json({ message: "Error locking user" });
    }
};

exports.unlockUser = async (req, res) => {
    try {
        const updated = await User.findByIdAndUpdate(
            req.params.id,
            { isLocked: false },
            { new: true }
        ).select("email username role createdAt isLocked");

        if (!updated) return res.status(404).json({ message: "User not found" });

        res.json(updated);
    } catch (err) {
        console.error("Error unlocking user:", err);
        res.status(500).json({ message: "Error unlocking user" });
    }
};

//  GET /api/users/me
exports.getMe = async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await User.findById(userId).select(
            "email username phone avatar favorites taste_profile role createdAt"
        );

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
    } catch (err) {
        console.error("Error getMe:", err);
        res.status(500).json({ message: "Error get profile" });
    }
};

exports.addFavorite = async (req, res) => {
    try {
        const userId = req.user.id;
        const rid = Number(req.body.rid);

        if (Number.isNaN(rid)) {
            return res.status(400).json({ message: "Invalid restaurant id" });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            {
                $addToSet: { favorites: rid }, // ❗ không cho trùng
            },
            { new: true }
        ).select("favorites");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
    } catch (err) {
        console.error("Error addFavorite:", err);
        res.status(500).json({ message: "Error adding favorite" });
    }
};
exports.removeFavorite = async (req, res) => {
    try {
        const userId = req.user.id;
        const rid = Number(req.params.rid);

        if (Number.isNaN(rid)) {
            return res.status(400).json({ message: "Invalid restaurant id" });
        }

        const user = await User.findByIdAndUpdate(
            userId,
            {
                $pull: { favorites: rid }, // ❗ xóa 1 phần tử trong mảng
            },
            { new: true }
        ).select("favorites");

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        res.json(user);
    } catch (err) {
        console.error("Error removeFavorite:", err);
        res.status(500).json({ message: "Error removing favorite" });
    }
};

// PUT /api/users/me
exports.updateMe = async (req, res) => {
    try {
        const userId = req.user.id;

        // ✅ thêm taste_profile ở đây
        const { username, phone, avatar, taste_profile } = req.body;

        const updated = await User.findByIdAndUpdate(
            userId,
            {
                ...(username !== undefined ? { username } : {}),
                ...(phone !== undefined ? { phone } : {}),
                ...(avatar !== undefined ? { avatar } : {}),

                // ✅ CHỖ NÀY – lưu taste_profile vào DB
                ...(taste_profile !== undefined
                    ? {
                        taste_profile: Array.isArray(taste_profile)
                            ? taste_profile
                            : ["Any"],
                    }
                    : {}),
            },
            { new: true }
        ).select(
            "email username phone avatar taste_profile favorites role createdAt"
        );

        if (!updated)
            return res.status(404).json({ message: "User not found" });

        res.json(updated);
    } catch (err) {
        console.error("Error updateMe:", err);
        res.status(500).json({ message: "Error updating profile" });
    }
};

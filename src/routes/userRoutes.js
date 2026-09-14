const express = require("express");
const {
    getAllUsers,
    deleteUser,
    getMe,
    updateMe,
    addFavorite,
    removeFavorite,
    lockUser,
    unlockUser,

} = require("../controllers/userController");

const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");

const router = express.Router();


//  profile user
router.get("/me", authMiddleware, getMe);
router.put("/me", authMiddleware, updateMe);

//  favorites
router.post("/me/favorites", authMiddleware, addFavorite);          // body: { rid: number }
router.delete("/me/favorites/:rid", authMiddleware, removeFavorite); // param rid

//  admin (giữ nguyên)
router.get("/", authMiddleware, adminMiddleware, getAllUsers);
router.delete("/:id", authMiddleware, adminMiddleware, deleteUser);
router.patch("/:id/lock", authMiddleware, adminMiddleware, lockUser);
router.patch("/:id/unlock", authMiddleware, adminMiddleware, unlockUser);

module.exports = router;

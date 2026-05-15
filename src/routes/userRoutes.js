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

const router = express.Router();


//  profile user
router.get("/me", authMiddleware, getMe);
router.put("/me", authMiddleware, updateMe);

//  favorites
router.post("/me/favorites", authMiddleware, addFavorite);          // body: { rid: number }
router.delete("/me/favorites/:rid", authMiddleware, removeFavorite); // param rid

//  admin (giữ nguyên)
router.get("/", getAllUsers);
router.delete("/:id", deleteUser);
router.patch("/:id/lock", lockUser);
router.patch("/:id/unlock", unlockUser);

module.exports = router;

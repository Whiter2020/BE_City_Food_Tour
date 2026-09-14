const express = require("express");

const {

    getAllUsers,
    deleteUser,

    getMe,
    updateMe,

    addFavorite,
    removeFavorite,

    addViewedRestaurant,
    addSearchHistory,

    lockUser,
    unlockUser


} = require("../controllers/userController");


const authMiddleware =
require("../middleware/authMiddleware");


const adminMiddleware =
require("../middleware/adminMiddleware");


const router = express.Router();



// ===============================
// USER PROFILE
// ===============================

router.get(
    "/me",
    authMiddleware,
    getMe
);


router.put(
    "/me",
    authMiddleware,
    updateMe
);




// ===============================
// FAVORITE RESTAURANTS
// ===============================


router.post(
    "/me/favorites",
    authMiddleware,
    addFavorite
);


router.delete(
    "/me/favorites/:rid",
    authMiddleware,
    removeFavorite
);




// ===============================
// USER BEHAVIOR
// FOR RECOMMENDATION SYSTEM
// ===============================



// Khi user xem restaurant detail
// body: { rid:Number }

router.post(
    "/me/viewed",
    authMiddleware,
    addViewedRestaurant
);




// Khi user search restaurant
// body: { keyword:String }

router.post(
    "/me/search-history",
    authMiddleware,
    addSearchHistory
);






// ===============================
// ADMIN USER MANAGEMENT
// ===============================


router.get(
    "/",
    authMiddleware,
    adminMiddleware,
    getAllUsers
);


router.delete(
    "/:id",
    authMiddleware,
    adminMiddleware,
    deleteUser
);


router.patch(
    "/:id/lock",
    authMiddleware,
    adminMiddleware,
    lockUser
);


router.patch(
    "/:id/unlock",
    authMiddleware,
    adminMiddleware,
    unlockUser
);



module.exports = router;
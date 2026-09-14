const express = require("express");

const {
    createRestaurantRequest,
    getMyRestaurantRequests,
    getAllRestaurantRequests,
    approveRestaurantRequest,
    rejectRestaurantRequest

} = require("../controllers/restaurantRequestController");


const authMiddleware = require("../middleware/authMiddleware");
const adminMiddleware = require("../middleware/adminMiddleware");


const router = express.Router();



// =======================================
// USER
// =======================================


// User gửi yêu cầu đăng tải nhà hàng
// POST /api/restaurant-requests
router.post(
    "/",
    authMiddleware,
    createRestaurantRequest
);



// User xem các yêu cầu đã gửi
// GET /api/restaurant-requests/my
router.get(
    "/my",
    authMiddleware,
    getMyRestaurantRequests
);





// =======================================
// ADMIN
// =======================================


// Admin xem tất cả yêu cầu
// GET /api/restaurant-requests
router.get(
    "/",
    authMiddleware,
    adminMiddleware,
    getAllRestaurantRequests
);



// Admin approve request
// PATCH /api/restaurant-requests/:id/approve
router.patch(
    "/:id/approve",
    authMiddleware,
    adminMiddleware,
    approveRestaurantRequest
);



// Admin reject request
// PATCH /api/restaurant-requests/:id/reject
router.patch(
    "/:id/reject",
    authMiddleware,
    adminMiddleware,
    rejectRestaurantRequest
);



module.exports = router;
const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
    createReview,
    getReviewsByRestaurant,
    updateMyReview,
    deleteMyReview,
} = require("../controllers/reviewController");

// lấy reviews theo restaurant
router.get("/restaurants/:restaurantId/reviews", getReviewsByRestaurant);

// tạo review (cần login)
router.post("/restaurants/:restaurantId/reviews", authMiddleware, createReview);

// optional: sửa/xóa review của chính mình
router.put("/reviews/:reviewId", authMiddleware, updateMyReview);
router.delete("/reviews/:reviewId", authMiddleware, deleteMyReview);

module.exports = router;

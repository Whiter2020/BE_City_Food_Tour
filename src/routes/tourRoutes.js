const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  createTour,
  getMyTours,
  getTourById,
  addRestaurantToTour,
  removeRestaurantFromTour,
  updateTourPrivacy,
  getPublicTours,
  optimizeTour,
  reorderRestaurantsInTour,
} = require("../controllers/tourController");

// Public route
router.get("/public", getPublicTours);

// Protected routes
router.use(authMiddleware);

// Tạo tour mới
router.post("/", createTour);

// Lấy tất cả tour của user
router.get("/", getMyTours);

// Lấy chi tiết 1 tour
router.get("/:id", getTourById);

// Thêm nhà hàng vào tour
router.post("/add-restaurant", addRestaurantToTour);

router.post("/:id/optimize", optimizeTour);

// Xóa quán ăn khỏi tour
router.delete("/:tourId/restaurants/:restaurantId", removeRestaurantFromTour);

// Set Public/Private
router.patch("/:id/privacy", updateTourPrivacy);


router.patch("/:tourId/reorder", reorderRestaurantsInTour);

module.exports = router;

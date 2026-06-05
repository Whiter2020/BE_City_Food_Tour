const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  createTour,
  getMyTours,
  getTourById,
  addRestaurantToTour,
} = require("../controllers/tourController");

// Tất cả các route bên dưới đều yêu cầu đăng nhập
router.use(authMiddleware);

// Tạo tour mới
router.post("/", createTour);

// Lấy tất cả tour của user
router.get("/", getMyTours);

// Lấy chi tiết 1 tour
router.get("/:id", getTourById);

// Thêm nhà hàng vào tour
router.post("/add-restaurant", addRestaurantToTour);

module.exports = router;
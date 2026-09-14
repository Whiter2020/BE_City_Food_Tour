const express = require("express");
const router = express.Router();
const authMiddleware = require("../middleware/authMiddleware");
const {
  createTour,
  getMyTours,
  getTourById,
  updateTour,
  deleteTour,
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

router.post("/", createTour);
router.get("/", getMyTours);
router.get("/:id", getTourById);
router.put("/:id", updateTour);
router.delete("/:id", deleteTour);
router.post("/add-restaurant", addRestaurantToTour);
router.post("/:id/optimize", optimizeTour);
router.delete("/:tourId/restaurants/:restaurantId", removeRestaurantFromTour);
router.patch("/:id/privacy", updateTourPrivacy);
router.patch("/:tourId/reorder", reorderRestaurantsInTour);

module.exports = router;

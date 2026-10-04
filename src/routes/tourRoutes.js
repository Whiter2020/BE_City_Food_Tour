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
  optimizeTourPreview,
  geocodeStartLocation,
  reorderRestaurantsInTour,
} = require("../controllers/tourController");

// =======================================
// PUBLIC ROUTES
// =======================================

// GET /api/tours/public
router.get("/public", getPublicTours);


// =======================================
// PROTECTED ROUTES
// =======================================

router.use(authMiddleware);


// =======================================
// PREVIEW / UTILS
//
// Đặt trước /:id để tránh route động
// bắt nhầm các endpoint đặc biệt.
// =======================================

// POST /api/tours/preview/optimize
router.post(
  "/preview/optimize",
  optimizeTourPreview
);

// POST /api/tours/preview/geocode
router.post(
  "/preview/geocode",
  geocodeStartLocation
);


// =======================================
// BASIC TOUR CRUD
// =======================================

// POST /api/tours
router.post(
  "/",
  createTour
);

// GET /api/tours
router.get(
  "/",
  getMyTours
);


// =======================================
// TOUR RESTAURANT ACTIONS
// =======================================

// Giữ route cũ để không làm hư FE hiện tại.
// Body cần có:
// {
//   "tourId": "...",
//   "restaurantId": "...",
//   "order": 2
// }
router.post(
  "/add-restaurant",
  addRestaurantToTour
);

// Route RESTful mới.
// Body chỉ cần:
// {
//   "restaurantId": "...",
//   "order": 2
// }
//
// tourId lấy từ params.
router.post(
  "/:tourId/restaurants",
  (req, res, next) => {
    req.body = {
      ...(req.body || {}),
      tourId: req.params.tourId,
    };

    return addRestaurantToTour(
      req,
      res,
      next
    );
  }
);

// DELETE /api/tours/:tourId/restaurants/:restaurantId
router.delete(
  "/:tourId/restaurants/:restaurantId",
  removeRestaurantFromTour
);

// PATCH /api/tours/:tourId/reorder
router.patch(
  "/:tourId/reorder",
  reorderRestaurantsInTour
);


// =======================================
// TOUR OPTIMIZATION
// =======================================

// POST /api/tours/:id/optimize
router.post(
  "/:id/optimize",
  optimizeTour
);


// =======================================
// TOUR PRIVACY
// =======================================

// PATCH /api/tours/:id/privacy
router.patch(
  "/:id/privacy",
  updateTourPrivacy
);


// =======================================
// DYNAMIC TOUR ROUTES
//
// Đặt cuối cùng vì /:id là route động.
// =======================================

// GET /api/tours/:id
router.get(
  "/:id",
  getTourById
);

// PUT /api/tours/:id
router.put(
  "/:id",
  updateTour
);

// PATCH /api/tours/:id
// Cho phép FE dùng PATCH nếu chỉ cập nhật vài field.
router.patch(
  "/:id",
  updateTour
);

// DELETE /api/tours/:id
router.delete(
  "/:id",
  deleteTour
);

module.exports = router;
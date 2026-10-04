const express = require("express");

const {
  getAllRestaurants,
  getRestaurantById,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
} = require("../controllers/restaurantController");

const router = express.Router();


// =======================================
// RESTAURANT ROUTES
// Base path thường là:
// /api/restaurants
// =======================================


// =======================================
// GET ALL RESTAURANTS
//
// Hỗ trợ query filter:
// /api/restaurants?search=pho
// /api/restaurants?district=District 1
// /api/restaurants?districtCode=district-1
// /api/restaurants?city=Ho Chi Minh City
// /api/restaurants?priceRange=$$
// /api/restaurants?tag=Vietnamese
// /api/restaurants?cuisine=Vietnamese
// /api/restaurants?minRating=4
// /api/restaurants?openAt=18:00
// /api/restaurants?openNow=true
// /api/restaurants?closingBefore=22:00
// /api/restaurants?openingAfter=09:00
// /api/restaurants?dishSearch=pho
// /api/restaurants?dishCategory=main
// /api/restaurants?sort=rating_desc
// =======================================

router.get(
  "/",
  getAllRestaurants
);


// =======================================
// CREATE RESTAURANT
//
// Body có thể gồm:
// {
//   "name": "...",
//   "streetAddress": "...",
//   "ward": "...",
//   "district": "...",
//   "city": "...",
//   "country": "...",
//   "openingTime": "09:00",
//   "closingTime": "22:00",
//   "dishes": [
//     {
//       "name": "Gỏi cuốn",
//       "price": "50000",
//       "category": "appetizer"
//     },
//     {
//       "name": "Cơm tấm",
//       "price": "70000",
//       "category": "main"
//     },
//     {
//       "name": "Chè",
//       "price": "30000",
//       "category": "dessert"
//     },
//     {
//       "name": "Nước sâm",
//       "price": "20000",
//       "category": "drink"
//     }
//   ]
// }
// =======================================

router.post(
  "/",
  createRestaurant
);


// =======================================
// GET RESTAURANT BY ID
//
// Lưu ý:
// :id ở đây là id số tự tăng,
// không phải MongoDB _id.
//
// Ví dụ:
// /api/restaurants/1
// =======================================

router.get(
  "/:id",
  getRestaurantById
);


// =======================================
// UPDATE RESTAURANT
//
// PUT: cập nhật restaurant.
// PATCH: cho FE dùng khi chỉ cập nhật vài field.
// Cả 2 đều trỏ về updateRestaurant.
// =======================================

router.put(
  "/:id",
  updateRestaurant
);

router.patch(
  "/:id",
  updateRestaurant
);


// =======================================
// DELETE RESTAURANT
// =======================================

router.delete(
  "/:id",
  deleteRestaurant
);


module.exports = router;
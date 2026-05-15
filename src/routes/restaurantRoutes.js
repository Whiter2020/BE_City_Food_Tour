const express = require("express");
const {
    getAllRestaurants,
    getRestaurantById,
    createRestaurant,
    updateRestaurant,
    deleteRestaurant,
    createReview,
    getReviewsByRestaurant,
} = require("../controllers/restaurantController");

const router = express.Router();

router.get("/", getAllRestaurants);
router.get("/:id", getRestaurantById);
router.post("/", createRestaurant);
router.put("/:id", updateRestaurant);
router.delete("/:id", deleteRestaurant);


module.exports = router;

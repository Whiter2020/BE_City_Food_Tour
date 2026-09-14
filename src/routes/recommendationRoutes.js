const express = require("express");

const router = express.Router();

const {

    recommendRestaurants

} = require("../controllers/recommendationController");

const authMiddleware = require("../middleware/authMiddleware");

router.get(

    "/restaurants",

    authMiddleware,

    recommendRestaurants

);



module.exports = router;
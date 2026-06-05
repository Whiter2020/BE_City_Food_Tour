const Tour = require("../models/Tour");
const Restaurant = require("../models/Restaurant");

// Tạo tour mới
const createTour = async (req, res) => {
  try {
    const { name, description } = req.body;

    const newTour = new Tour({
      user: req.user.id, // lấy từ authMiddleware
      name,
      description,
      restaurants: [],
    });

    await newTour.save();

    res.status(201).json({
      message: "Tour created successfully",
      tour: newTour,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to create tour" });
  }
};

// Lấy tất cả tour của user đang đăng nhập
const getMyTours = async (req, res) => {
  try {
    const tours = await Tour.find({ user: req.user.id })
      .populate("restaurants.restaurant", "name address cuisine rating")
      .sort({ createdAt: -1 });

    res.json(tours);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to get tours" });
  }
};

// Lấy chi tiết 1 tour
const getTourById = async (req, res) => {
  try {
    const tour = await Tour.findOne({
      _id: req.params.id,
      user: req.user.id,
    }).populate("restaurants.restaurant");

    if (!tour) {
      return res.status(404).json({ message: "Tour not found" });
    }

    res.json(tour);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to get tour" });
  }
};

// Thêm nhà hàng vào tour
const addRestaurantToTour = async (req, res) => {
  try {
    const { tourId, restaurantId, order } = req.body;

    const tour = await Tour.findOne({ _id: tourId, user: req.user.id });
    if (!tour) {
      return res.status(404).json({ message: "Tour not found" });
    }

    // Kiểm tra nhà hàng có tồn tại không
    const restaurant = await Restaurant.findById(restaurantId);
    if (!restaurant) {
      return res.status(404).json({ message: "Restaurant not found" });
    }

    // Thêm vào mảng restaurants
    tour.restaurants.push({
      restaurant: restaurantId,
      order: order || tour.restaurants.length + 1,
    });

    await tour.save();

    res.json({
      message: "Restaurant added to tour",
      tour,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to add restaurant to tour" });
  }
};

module.exports = {
  createTour,
  getMyTours,
  getTourById,
  addRestaurantToTour,
};
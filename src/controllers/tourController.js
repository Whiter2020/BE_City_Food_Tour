const Tour = require("../models/Tour");
const Restaurant = require("../models/Restaurant");
const geoapify = require("../utils/geoapify");


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

const optimizeTour = async (req, res) => {
  try {
    const tour = await Tour.findOne({
      _id: req.params.id,
      user: req.user.id
    }).populate("restaurants.restaurant");

    if (!tour) {
      return res.status(404).json({ message: "Tour not found" });
    }

    if (tour.restaurants.length < 2) {
      return res.status(400).json({ message: "Cần ít nhất 2 nhà hàng để tối ưu lộ trình" });
    }

    // Lấy tọa độ của tất cả nhà hàng
    const waypoints = [];
    for (const item of tour.restaurants) {
      const rest = item.restaurant;
      if (rest?.location?.coordinates) {
        waypoints.push({
          lat: rest.location.coordinates[1],
          lon: rest.location.coordinates[0]
        });
      }
    }

    if (waypoints.length < 2) {
      return res.status(400).json({ message: "Không đủ tọa độ để tính route" });
    }

    // Gọi Geoapify tính route tối ưu
    const routeData = await geoapify.calculateRoute(waypoints, "drive");

    // Cập nhật tour
    tour.totalDistance = routeData.features[0]?.properties?.distance / 1000 || 0; // km
    tour.totalTime = routeData.features[0]?.properties?.time / 60 || 0;         // phút
    tour.isOptimized = true;

    await tour.save();

    res.json({
      message: "Tour đã được tối ưu lộ trình",
      tour,
      route: routeData.features[0]
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Lỗi khi tối ưu tour" });
  }
};

module.exports = {
  createTour,
  getMyTours,
  getTourById,
  addRestaurantToTour,
  optimizeTour,
};
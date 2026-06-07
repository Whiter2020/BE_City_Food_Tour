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
    // 1. Tìm tour theo id và chỉ lấy tour của user đang đăng nhập
    const tour = await Tour.findOne({
      _id: req.params.id,
      user: req.user.id
    }).populate("restaurants.restaurant");   // Populate để lấy thông tin chi tiết nhà hàng

    if (!tour) {
      return res.status(404).json({ message: "Tour not found" });
    }

    // 2. Kiểm tra tour phải có ít nhất 2 nhà hàng
    if (tour.restaurants.length < 2) {
      return res.status(400).json({ message: "Cần ít nhất 2 nhà hàng để tối ưu lộ trình" });
    }

    // 3. Lấy tọa độ (lat, lng) của từng nhà hàng trong tour
    const waypoints = [];
    for (const item of tour.restaurants) {
      const rest = item.restaurant;                    // Nhà hàng đã được populate
      if (rest?.lat != null && rest?.lng != null) {    // Chỉ lấy nhà hàng có tọa độ
        waypoints.push({
          lat: rest.lat,
          lon: rest.lng
        });
      }
    }

    // 4. Kiểm tra có đủ tọa độ để tính route không (ít nhất 2 điểm)
    if (waypoints.length < 2) {
      return res.status(400).json({ message: "Không đủ tọa độ để tính route" });
    }

    // 5. Gọi Geoapify để tính lộ trình tối ưu (theo mode "drive")
    const routeData = await geoapify.calculateRoute(waypoints, "drive");

    // 6. Cập nhật thông tin tour sau khi optimize
    tour.totalDistance = routeData.features[0]?.properties?.distance / 1000 || 0; // Đổi từ mét sang km
    tour.totalTime = routeData.features[0]?.properties?.time / 60 || 0;         // Đổi từ giây sang phút
    tour.isOptimized = true;

    await tour.save();   // Lưu lại vào database

    // 7. Trả về kết quả cho client
    res.json({
      message: "Tour đã được tối ưu lộ trình",
      tour,                                    // Tour đã được cập nhật
      route: routeData.features[0]             // Dữ liệu route chi tiết từ Geoapify
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Lỗi khi tối ưu tour" });
  }
};

// Sắp xếp lại thứ tự quán ăn trong tour
const reorderRestaurantsInTour = async (req, res) => {
  try {
    const { tourId } = req.params;
    const { restaurantIds } = req.body; // Mảng id theo thứ tự mới

    if (!Array.isArray(restaurantIds) || restaurantIds.length === 0) {
      return res.status(400).json({ message: "Danh sách restaurantIds không hợp lệ" });
    }

    const tour = await Tour.findOne({ _id: tourId, user: req.user.id });
    if (!tour) {
      return res.status(404).json({ message: "Tour not found" });
    }

    // Tạo map để tra cứu nhanh
    const restaurantMap = new Map();
    tour.restaurants.forEach((item) => {
      restaurantMap.set(item.restaurant.toString(), item);
    });

    // Xây dựng lại mảng restaurants theo thứ tự mới
    const newRestaurants = [];
    restaurantIds.forEach((id, index) => {
      const existing = restaurantMap.get(id);
      if (existing) {
        existing.order = index + 1;
        newRestaurants.push(existing);
      }
    });

    // Nếu số lượng không khớp thì báo lỗi
    if (newRestaurants.length !== restaurantIds.length) {
      return res.status(400).json({ message: "Một số restaurantId không tồn tại trong tour" });
    }

    tour.restaurants = newRestaurants;
    await tour.save();

    res.json({
      message: "Đã sắp xếp lại thứ tự quán ăn",
      tour,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to reorder restaurants" });
  }
};

// Xóa quán ăn khỏi tour
const removeRestaurantFromTour = async (req, res) => {
  try {
    const { tourId, restaurantId } = req.params;

    const tour = await Tour.findOne({ _id: tourId, user: req.user.id });
    if (!tour) {
      return res.status(404).json({ message: "Tour not found" });
    }

    // Xóa quán ăn khỏi mảng
    tour.restaurants = tour.restaurants.filter(
      (item) => item.restaurant.toString() !== restaurantId
    );

    // Cập nhật lại order
    tour.restaurants.forEach((item, index) => {
      item.order = index + 1;
    });

    await tour.save();

    res.json({
      message: "Restaurant removed from tour",
      tour,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to remove restaurant from tour" });
  }
};

// Set Public / Private cho tour
const updateTourPrivacy = async (req, res) => {
  try {
    const { isPublic } = req.body;

    const tour = await Tour.findOne({ _id: req.params.id, user: req.user.id });
    if (!tour) {
      return res.status(404).json({ message: "Tour not found" });
    }

    tour.isPublic = isPublic;
    await tour.save();

    res.json({
      message: `Tour is now ${isPublic ? "Public" : "Private"}`,
      tour,
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to update tour privacy" });
  }
};

// Lấy danh sách tour public (dành cho người khác xem)
const getPublicTours = async (req, res) => {
  try {
    const tours = await Tour.find({ isPublic: true })
      .populate("user", "username")
      .populate("restaurants.restaurant", "name address cuisine rating")
      .sort({ createdAt: -1 });

    res.json(tours);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to get public tours" });
  }
};

module.exports = {
  createTour,
  getMyTours,
  getTourById,
  addRestaurantToTour,
  removeRestaurantFromTour,   // ← thêm
  updateTourPrivacy,          // ← thêm
  getPublicTours,             // ← thêm
  optimizeTour,
  reorderRestaurantsInTour,
};

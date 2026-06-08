require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

// Kết nối MongoDB
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('✅ Kết nối MongoDB thành công');
  } catch (error) {
    console.error('❌ Lỗi kết nối MongoDB:', error);
    process.exit(1);
  }
};

const Restaurant = require('./src/models/Restaurant');

// Hàm seed
const seedRestaurants = async () => {
  try {
    await connectDB();

    // Đọc file JSON
    const filePath = path.join(__dirname, 'seed', 'restaurants.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    const mappedData = data.map((item) => {
      let lat = null, lng = null;
      if (item.location && item.location.coordinates) {
        [lng, lat] = item.location.coordinates;
      }
      const tags = item.cuisine ? [item.cuisine] : [];

      let priceRange = "$";
      if (item.budget >= 300000) priceRange = "$$$$$";
      else if (item.budget >= 150000) priceRange = "$$$$";
      else if (item.budget >= 80000) priceRange = "$$$";
      else if (item.budget >= 50000) priceRange = "$$";

      return {
        ...item,
        lat,
        lng,
        tags,
        priceRange,
        location: undefined,
        cuisine: undefined,
        // Preserve seed content instead of replacing it during reseed.
        image: item.image || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?auto=format&fit=crop&w=1200&q=80",
        description: item.description || "",
        amenities: [],
        openingTime: "09:00",
        closingTime: "22:00",
        dishes: [],
        reviewCount: 0,
        reviews: [],
      };
    });

    console.log(`📦 Đang seed ${data.length} nhà hàng...`);

    // Xóa dữ liệu cũ để tránh duplicate id
    await Restaurant.deleteMany({});
    console.log('🗑️ Đã xóa dữ liệu cũ');

    // Insert data
    await Restaurant.insertMany(mappedData);
    console.log(`✅ Seed thành công ${data.length} nhà hàng!`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi seed:', error);
    process.exit(1);
  }
};

seedRestaurants();

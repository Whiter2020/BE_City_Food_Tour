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

// Schema đơn giản cho seed (nếu chưa có model đầy đủ)
const restaurantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  address: String,
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true } // [longitude, latitude]
  },
  cuisine: String,
  rating: Number,
  priceRange: String,
  description: String,
}, { timestamps: true });

const Restaurant = mongoose.model('Restaurant', restaurantSchema);

// Hàm seed
const seedRestaurants = async () => {
  try {
    await connectDB();

    // Đọc file JSON
    const filePath = path.join(__dirname, 'seed', 'restaurants.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    console.log(`📦 Đang seed ${data.length} nhà hàng...`);

    // Xóa dữ liệu cũ (nếu muốn seed lại từ đầu)
    // await Restaurant.deleteMany({});
    // console.log('🗑️ Đã xóa dữ liệu cũ');

    // Insert data
    await Restaurant.insertMany(data);
    console.log(`✅ Seed thành công ${data.length} nhà hàng!`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi seed:', error);
    process.exit(1);
  }
};

seedRestaurants();
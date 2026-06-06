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

const seedRestaurants = async () => {
  try {
    await connectDB();

    const Restaurant = require('./src/models/Restaurant');

    const filePath = path.join(__dirname, 'seed', 'restaurants.json');
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    console.log(`📦 Đang seed ${data.length} nhà hàng...`);

    // Xóa dữ liệu cũ
    await Restaurant.deleteMany({});
    console.log('🗑️ Đã xóa dữ liệu cũ');

    let successCount = 0;

    // Dùng vòng lặp để trigger hook
    for (const item of data) {
      try {
        await Restaurant.create(item);
        successCount++;
      } catch (err) {
        console.log(`⚠️ Bỏ qua: ${item.name} - ${err.message}`);
      }
    }

    console.log(`✅ Seed thành công ${successCount}/${data.length} nhà hàng!`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Lỗi khi seed:', error);
    process.exit(1);
  }
};

seedRestaurants();
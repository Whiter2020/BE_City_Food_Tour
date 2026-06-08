const Restaurant = require("../models/Restaurant");
const mongoose = require("mongoose");
const Review = require("../models/Review");

// GET /api/restaurants
exports.getAllRestaurants = async (req, res) => {
    try {
        // lean() cho nhẹ + dễ merge
        const restaurants = await Restaurant.find().sort({ id: 1 }).lean();

        if (!restaurants.length) return res.json([]);

        // lấy list ObjectId restaurant
        const objIds = restaurants.map((r) => new mongoose.Types.ObjectId(r._id));

        // aggregate reviews theo restaurant
        const stats = await Review.aggregate([
            { $match: { restaurant: { $in: objIds } } },
            {
                $group: {
                    _id: "$restaurant",
                    avgRating: { $avg: "$rating" },
                    count: { $sum: 1 },
                },
            },
        ]);

        // map nhanh _id -> {avg,count}
        const statMap = new Map(
            stats.map((s) => [
                String(s._id),
                { avg: s.avgRating || 0, count: s.count || 0 },
            ])
        );

        const enriched = restaurants.map((r) => {
            const s = statMap.get(String(r._id));
            const avg = s ? s.avg : 0;
            const count = s ? s.count : 0;

            return {
                ...r,
                rating: Math.round(avg * 10) / 10, // 1 chữ số
                reviewCount: count,
            };
        });

        return res.json(enriched);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Lỗi server" });
    }
};

// GET /api/restaurants/:id   (id là số 1,2,3,...)
exports.getRestaurantById = async (req, res) => {
    try {
        const id = Number(req.params.id);

        const restaurant = await Restaurant.findOne({ id }).lean();
        if (!restaurant) {
            return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
        }

        const stats = await Review.aggregate([
            { $match: { restaurant: new mongoose.Types.ObjectId(restaurant._id) } },
            {
                $group: {
                    _id: "$restaurant",
                    avgRating: { $avg: "$rating" },
                    count: { $sum: 1 },
                },
            },
        ]);

        const avg = stats.length ? stats[0].avgRating : 0;
        const count = stats.length ? stats[0].count : 0;

        return res.json({
            ...restaurant,
            rating: Math.round(avg * 10) / 10,
            reviewCount: count,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Lỗi server" });
    }
};

// helper: chuẩn hóa priceRange
function normalizePriceRange(priceRange, fallback = "$$") {
    const validRanges = ["$", "$$", "$$$", "$$$$", "$$$$$"];
    if (validRanges.includes(priceRange)) return priceRange;
    return fallback;
}

// helper: chuẩn hóa tags
function normalizeTags(tags) {
    if (Array.isArray(tags)) {
        return tags.map((t) => String(t).trim()).filter(Boolean);
    }
    if (typeof tags === "string") {
        return tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
    }
    return [];
}





// lấy số quận từ district: "District 1", "Quận 1", "1" -> 1
function parseDistrictNumber(district) {
    if (!district) return null;
    const m = String(district).match(/\d+/);
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
}



// POST /api/restaurants   (Add Restaurant từ admin)
exports.createRestaurant = async (req, res) => {
    try {
        const {
            name,
            address,
            district,
            image,
            openingTime,
            closingTime,
            description,
            dishes,      // [{ name, price, image }]
            priceRange,  // '$' | '$$' | ...
            tags,        // array hoặc string
            phone,
            lat,
            lng,
            amenities,   // new field array of strings
            reviews,    // optional initial reviews array
        } = req.body;

        if (!name || !address) {
            return res
                .status(400)
                .json({ message: "Tên nhà hàng và địa chỉ là bắt buộc" });
        }

        // id tăng dần 1,2,3,...
        const last = await Restaurant.findOne().sort({ id: -1 });
        const nextId = last ? last.id + 1 : 1;


        // dishes
        const dishDocs = (dishes || []).map((dish, index) => ({
            id: index + 1,
            name: dish.name,
            price: dish.price,
            image: dish.image || "",
        }));

        const normalizedPriceRange = normalizePriceRange(priceRange, "$$");
        const normalizedTags = normalizeTags(tags);

        const restaurant = await Restaurant.create({
            id: nextId,
            name,
            address,
            district,
            image,
            openingTime,
            closingTime,
            description,
            dishes: dishDocs,
            rating: 0,
            priceRange: normalizedPriceRange,
            tags: normalizedTags,
            amenities: amenities || [],
            reviews: reviews || [],
            phone: phone || "",
            lat: lat || null,
            lng: lng || null,
        });

        res.status(201).json(restaurant);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

exports.deleteRestaurant = async (req, res) => {
    try {
        const id = Number(req.params.id);

        const deleted = await Restaurant.findOneAndDelete({ id });

        if (!deleted) {
            return res
                .status(404)
                .json({ message: "Không tìm thấy nhà hàng để xoá" });
        }

        return res.json({
            message: "Xoá nhà hàng thành công",
            restaurant: deleted,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Lỗi server" });
    }
};

// PUT /api/restaurants/:id   (Edit Restaurant từ admin)
exports.updateRestaurant = async (req, res) => {
    try {
        const id = Number(req.params.id);

        const restaurant = await Restaurant.findOne({ id });
        if (!restaurant) {
            return res.status(404).json({ message: "Không tìm thấy nhà hàng" });
        }

        const {
            name,
            address,
            district,
            image,
            openingTime,
            closingTime,
            description,
            dishes,
            priceRange,
            tags,
            phone,
            lat,
            lng,
            amenities,   // new field array of strings
            reviews,     // optional initial reviews array
        } = req.body;

        if (!name || !address) {
            return res.status(400).json({ message: "Tên nhà hàng và địa chỉ là bắt buộc" });
        }

        // ✅ lưu district cũ TRƯỚC khi overwrite
        const oldDistrict = restaurant.district;

        // dishes mới
        const dishDocs = (dishes || []).map((dish, index) => ({
            id: index + 1,
            name: dish.name,
            price: dish.price,
            image: dish.image || "",
        }));

        const normalizedPriceRange = normalizePriceRange(
            priceRange,
            restaurant.priceRange || "$$"
        );

        const normalizedTags = tags !== undefined ? normalizeTags(tags) : restaurant.tags || [];

        // update only fields that are provided
        if (name !== undefined) restaurant.name = name;
        if (address !== undefined) restaurant.address = address;
        if (district !== undefined) restaurant.district = district;
        if (image !== undefined && image !== '') restaurant.image = image;
        if (openingTime !== undefined) restaurant.openingTime = openingTime;
        if (closingTime !== undefined) restaurant.closingTime = closingTime;
        if (description !== undefined) restaurant.description = description;
        if (dishes && dishes.length > 0) restaurant.dishes = dishDocs;
        restaurant.priceRange = normalizedPriceRange;
        restaurant.tags = normalizedTags;
        if (amenities !== undefined) restaurant.amenities = amenities;
        if (reviews !== undefined) restaurant.reviews = reviews;
        if (phone !== undefined && phone !== '') restaurant.phone = phone;
        if (lat !== undefined && lat !== null) restaurant.lat = lat;
        if (lng !== undefined && lng !== null) restaurant.lng = lng;



        const updated = await restaurant.save();
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

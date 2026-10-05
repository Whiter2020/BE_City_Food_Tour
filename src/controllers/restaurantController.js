const Restaurant = require("../models/Restaurant");
const mongoose = require("mongoose");
const Review = require("../models/Review");
const { normalizeCityCode, normalizeDistrictCode } = require("../utils/location");
const geoapify = require("../utils/geoapify");
const { formatAddress, isPostcode, toCoordinate, coordinatesFromFeature } = require("../utils/address");

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
    const source = Array.isArray(tags)
        ? tags
        : typeof tags === "string"
            ? tags.split(",")
            : [];
    const seen = new Set();
    return source.reduce((normalized, value) => {
        const tag = String(value).trim().replace(/\s+/g, " ");
        const key = tag.toLocaleLowerCase();
        if (tag && !seen.has(key)) {
            seen.add(key);
            normalized.push(tag);
        }
        return normalized;
    }, []);
}

function normalizeDishCategory(category) {
    const value = String(category || "main").trim().toLowerCase();
    const aliases = {
        main: "main", "món chính": "main", "mon chinh": "main",
        appetizer: "appetizer", "khai vị": "appetizer", "khai vi": "appetizer",
        dessert: "dessert", "tráng miệng": "dessert", "trang mieng": "dessert",
        drink: "drink", drinks: "drink", beverage: "drink", "đồ uống": "drink", "do uong": "drink",
    };
    return aliases[value] || "main";
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
            streetAddress,
            ward,
            district,
            city,
            country,
            cityCode,
            districtCode,
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

        const formattedAddress = formatAddress({ streetAddress, ward, district, city, country }) || String(address || "").trim();
        if (!name || !formattedAddress) {
            return res
                .status(400)
                .json({ message: "Tên nhà hàng và các trường địa chỉ bắt buộc" });
        }
        if ((streetAddress || district || city || country) && (!streetAddress?.trim() || !district?.trim() || !city?.trim() || !country?.trim())) {
            return res.status(400).json({ message: "Street address, district/area, city, and country are required." });
        }

        let coordinates = { lat: toCoordinate(lat, -90, 90), lng: toCoordinate(lng, -180, 180) };
        if (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) {
            const feature = await geoapify.geocode(formattedAddress);
            coordinates = coordinatesFromFeature(feature);
        }
        if (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) {
            return res.status(422).json({ message: "Could not locate this address. Please check the street, district, and city." });
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
            isSignature: Boolean(dish.isSignature),
            category: normalizeDishCategory(dish.category),
        }));

        const normalizedPriceRange = normalizePriceRange(priceRange, "$$");
        const normalizedTags = normalizeTags(tags);
        const safeDistrict = isPostcode(district) ? "" : String(district || "").trim();
        const safeDistrictCode = isPostcode(districtCode) ? safeDistrict : (districtCode || safeDistrict);

        const restaurant = await Restaurant.create({
            id: nextId,
            name,
            address: formattedAddress,
            streetAddress: String(streetAddress || "").trim(),
            ward: String(ward || "").trim(),
            district: safeDistrict,
            city: String(city || "").trim(),
            country: String(country || "").trim(),
            cityCode: normalizeCityCode(city || cityCode || "ho-chi-minh"),
            districtCode: normalizeDistrictCode(safeDistrictCode),
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
            lat: coordinates.lat,
            lng: coordinates.lng,
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
            streetAddress,
            ward,
            district,
            city,
            country,
            cityCode,
            districtCode,
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

        const formattedAddress = formatAddress({ streetAddress, ward, district, city, country }) || String(address || restaurant.address || "").trim();
        if (!name || !formattedAddress) {
            return res.status(400).json({ message: "Tên nhà hàng và địa chỉ là bắt buộc" });
        }
        if ((streetAddress || district || city || country) && (!streetAddress?.trim() || !district?.trim() || !city?.trim() || !country?.trim())) {
            return res.status(400).json({ message: "Street address, district/area, city, and country are required." });
        }

        const addressChanged = formattedAddress !== restaurant.address;
        let coordinates = {
            lat: toCoordinate(lat, -90, 90) ?? restaurant.lat,
            lng: toCoordinate(lng, -180, 180) ?? restaurant.lng,
        };
        if (addressChanged || !Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) {
            const feature = await geoapify.geocode(formattedAddress);
            coordinates = coordinatesFromFeature(feature);
            if (!Number.isFinite(coordinates.lat) || !Number.isFinite(coordinates.lng)) {
                return res.status(422).json({ message: "Could not locate this address. Please check the street, district, and city." });
            }
        }

        // ✅ lưu district cũ TRƯỚC khi overwrite
        const oldDistrict = restaurant.district;

        // dishes mới
        const dishDocs = (dishes || []).map((dish, index) => ({
            id: index + 1,
            name: dish.name,
            price: dish.price,
            image: dish.image || "",
            isSignature: Boolean(dish.isSignature),
            category: normalizeDishCategory(dish.category),
        }));

        const normalizedPriceRange = normalizePriceRange(
            priceRange,
            restaurant.priceRange || "$$"
        );

        const normalizedTags = tags !== undefined ? normalizeTags(tags) : restaurant.tags || [];

        // update only fields that are provided
        if (name !== undefined) restaurant.name = name;
        if (address !== undefined || streetAddress !== undefined || ward !== undefined || district !== undefined || city !== undefined || country !== undefined) restaurant.address = formattedAddress;
        if (streetAddress !== undefined) restaurant.streetAddress = String(streetAddress || "").trim();
        if (ward !== undefined) restaurant.ward = String(ward || "").trim();
        if (district !== undefined) restaurant.district = isPostcode(district) ? "" : String(district || "").trim();
        if (city !== undefined) restaurant.city = String(city || "").trim();
        if (country !== undefined) restaurant.country = String(country || "").trim();
        if (city !== undefined || cityCode !== undefined) restaurant.cityCode = normalizeCityCode(city || cityCode);
        if (districtCode !== undefined || district !== undefined) {
            const safeDistrict = isPostcode(district) ? "" : String(district ?? restaurant.district ?? "").trim();
            const safeDistrictCode = isPostcode(districtCode) ? safeDistrict : (districtCode || safeDistrict);
            restaurant.districtCode = normalizeDistrictCode(safeDistrictCode);
        }
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
        restaurant.lat = coordinates.lat;
        restaurant.lng = coordinates.lng;



        const updated = await restaurant.save();
        res.json(updated);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Lỗi server" });
    }
};

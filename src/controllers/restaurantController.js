const Restaurant = require("../models/Restaurant");
const mongoose = require("mongoose");
const Review = require("../models/Review");
const {
    normalizeCityCode,
    normalizeDistrictCode,
} = require("../utils/location");
const geoapify = require("../utils/geoapify");
const {
    formatAddress,
    isPostcode,
    toCoordinate,
    coordinatesFromFeature,
} = require("../utils/address");


// =======================================
// Helpers
// =======================================

// Chuẩn hóa priceRange
function normalizePriceRange(priceRange, fallback = "$$") {
    const validRanges = ["$", "$$", "$$$", "$$$$", "$$$$$"];

    if (validRanges.includes(priceRange)) {
        return priceRange;
    }

    return fallback;
}


// Chuẩn hóa tags
function normalizeTags(tags) {
    if (Array.isArray(tags)) {
        return tags
            .map((t) => String(t).trim())
            .filter(Boolean);
    }

    if (typeof tags === "string") {
        return tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
    }

    return [];
}


// =======================================
// Chuẩn hóa category món ăn
//
// main       = Món chính
// appetizer  = Khai vị
// dessert    = Tráng miệng
// drink      = Đồ uống
// =======================================
function normalizeDishCategory(category) {
    if (!category) {
        return "main";
    }

    const value = String(category)
        .trim()
        .toLowerCase();

    const aliases = {
        main: "main",
        "món chính": "main",
        "mon chinh": "main",

        appetizer: "appetizer",
        "khai vị": "appetizer",
        "khai vi": "appetizer",

        dessert: "dessert",
        "tráng miệng": "dessert",
        "trang mieng": "dessert",

        drink: "drink",
        drinks: "drink",
        "đồ uống": "drink",
        "do uong": "drink",
        beverage: "drink",
    };

    return aliases[value] || "main";
}


// =======================================
// Chuẩn hóa danh sách món ăn
// =======================================
function normalizeDishes(dishes) {
    if (!Array.isArray(dishes)) {
        return [];
    }

    return dishes
        .filter(
            (dish) =>
                dish &&
                (
                    dish.name ||
                    dish.price ||
                    dish.image
                )
        )
        .map((dish, index) => ({
            id: index + 1,

            name: String(
                dish.name || ""
            ).trim(),

            price: dish.price ?? "",

            image: dish.image || "",

            isSignature:
                Boolean(dish.isSignature),

            category:
                normalizeDishCategory(
                    dish.category
                ),
        }));
}


// =======================================
// Parse HH:mm -> số phút
// Ví dụ 09:30 -> 570
// =======================================
function parseTimeToMinutes(time) {
    if (!time) {
        return null;
    }

    const match = String(time)
        .trim()
        .match(
            /^([01]\d|2[0-3]):([0-5]\d)$/
        );

    if (!match) {
        return null;
    }

    return (
        Number(match[1]) * 60 +
        Number(match[2])
    );
}


// =======================================
// Kiểm tra restaurant có mở tại thời điểm
// được yêu cầu hay không.
//
// Có hỗ trợ:
// 09:00 - 22:00
// 18:00 - 02:00
// =======================================
function isOpenAt(
    openingTime,
    closingTime,
    targetTime
) {
    const open =
        parseTimeToMinutes(
            openingTime
        );

    const close =
        parseTimeToMinutes(
            closingTime
        );

    const target =
        parseTimeToMinutes(
            targetTime
        );

    if (
        open === null ||
        close === null ||
        target === null
    ) {
        return false;
    }

    // Cùng giờ -> coi như mở cả ngày
    if (open === close) {
        return true;
    }

    // Ví dụ 09:00 - 22:00
    if (open < close) {
        return (
            target >= open &&
            target <= close
        );
    }

    // Ví dụ 18:00 - 02:00
    return (
        target >= open ||
        target <= close
    );
}


// =======================================
// Lấy giờ hiện tại HH:mm
// =======================================
function getCurrentHHMM() {
    const now = new Date();

    const hours = String(
        now.getHours()
    ).padStart(2, "0");

    const minutes = String(
        now.getMinutes()
    ).padStart(2, "0");

    return `${hours}:${minutes}`;
}


// =======================================
// Parse giá món
//
// Hỗ trợ:
// "50,000"
// "50000"
// "50.000đ"
// "$50,000"
// =======================================
function parseDishPrice(price) {
    if (typeof price === "number") {
        return Number.isFinite(price)
            ? price
            : 0;
    }

    if (
        price === null ||
        price === undefined
    ) {
        return 0;
    }

    const cleaned = String(price)
        .replace(/[^\d]/g, "");

    const value = Number(cleaned);

    return Number.isFinite(value)
        ? value
        : 0;
}


// =======================================
// Lấy giá món thấp nhất
// =======================================
function getMinDishPrice(restaurant) {
    if (
        !Array.isArray(
            restaurant.dishes
        ) ||
        restaurant.dishes.length === 0
    ) {
        return 0;
    }

    const prices =
        restaurant.dishes
            .map((dish) =>
                parseDishPrice(
                    dish.price
                )
            )
            .filter(
                (price) => price > 0
            );

    return prices.length
        ? Math.min(...prices)
        : 0;
}


// =======================================
// Lấy số quận
//
// "District 1" -> 1
// "Quận 1"     -> 1
// "1"          -> 1
// =======================================
function parseDistrictNumber(
    district
) {
    if (!district) {
        return null;
    }

    const match =
        String(district).match(
            /\d+/
        );

    if (!match) {
        return null;
    }

    const number =
        Number(match[0]);

    return Number.isFinite(number)
        ? number
        : null;
}


// =======================================
// Normalize text để search
// =======================================
function normalizeSearchText(
    value
) {
    return String(value || "")
        .trim()
        .toLowerCase();
}


// =======================================
// Search restaurant
// =======================================
function matchesSearch(
    restaurant,
    search
) {
    if (!search) {
        return true;
    }

    const keyword =
        normalizeSearchText(search);

    const searchableValues = [
        restaurant.name,
        restaurant.address,
        restaurant.streetAddress,
        restaurant.ward,
        restaurant.district,
        restaurant.city,

        ...(Array.isArray(
            restaurant.tags
        )
            ? restaurant.tags
            : []),

        ...(Array.isArray(
            restaurant.dishes
        )
            ? restaurant.dishes.flatMap(
                (dish) => [
                    dish.name,
                    dish.category,
                ]
            )
            : []),
    ];

    return searchableValues.some(
        (value) =>
            normalizeSearchText(
                value
            ).includes(keyword)
    );
}


// =======================================
// Filter theo món ăn
// =======================================
function matchesDishFilter(
    restaurant,
    {
        dishSearch,
        dishCategory,
    }
) {
    if (
        !dishSearch &&
        !dishCategory
    ) {
        return true;
    }

    const dishes =
        Array.isArray(
            restaurant.dishes
        )
            ? restaurant.dishes
            : [];

    const keyword =
        normalizeSearchText(
            dishSearch
        );

    return dishes.some((dish) => {
        const categoryMatch =
            !dishCategory ||
            normalizeDishCategory(
                dish.category
            ) ===
                normalizeDishCategory(
                    dishCategory
                );

        const nameMatch =
            !keyword ||
            normalizeSearchText(
                dish.name
            ).includes(keyword);

        return (
            categoryMatch &&
            nameMatch
        );
    });
}


// =======================================
// Sort restaurants
// =======================================
function sortRestaurants(
    restaurants,
    sort
) {
    if (!sort) {
        return restaurants;
    }

    const priceRank = {
        "$": 1,
        "$$": 2,
        "$$$": 3,
        "$$$$": 4,
        "$$$$$": 5,
    };

    const compareString = (
        a,
        b
    ) =>
        String(a || "").localeCompare(
            String(b || ""),
            "vi",
            {
                sensitivity: "base",
            }
        );

    const sorted = [
        ...restaurants,
    ];

    switch (sort) {
        case "rating_desc":
            return sorted.sort(
                (a, b) =>
                    b.rating -
                    a.rating
            );

        case "rating_asc":
            return sorted.sort(
                (a, b) =>
                    a.rating -
                    b.rating
            );

        case "price_asc":
            return sorted.sort(
                (a, b) =>
                    (
                        priceRank[
                            a.priceRange
                        ] || 0
                    ) -
                    (
                        priceRank[
                            b.priceRange
                        ] || 0
                    )
            );

        case "price_desc":
            return sorted.sort(
                (a, b) =>
                    (
                        priceRank[
                            b.priceRange
                        ] || 0
                    ) -
                    (
                        priceRank[
                            a.priceRange
                        ] || 0
                    )
            );

        case "dish_price_asc":
            return sorted.sort(
                (a, b) =>
                    getMinDishPrice(a) -
                    getMinDishPrice(b)
            );

        case "dish_price_desc":
            return sorted.sort(
                (a, b) =>
                    getMinDishPrice(b) -
                    getMinDishPrice(a)
            );

        case "closing_asc":
            return sorted.sort(
                (a, b) =>
                    (
                        parseTimeToMinutes(
                            a.closingTime
                        ) ?? 9999
                    ) -
                    (
                        parseTimeToMinutes(
                            b.closingTime
                        ) ?? 9999
                    )
            );

        case "closing_desc":
            return sorted.sort(
                (a, b) =>
                    (
                        parseTimeToMinutes(
                            b.closingTime
                        ) ?? -1
                    ) -
                    (
                        parseTimeToMinutes(
                            a.closingTime
                        ) ?? -1
                    )
            );

        case "opening_asc":
            return sorted.sort(
                (a, b) =>
                    (
                        parseTimeToMinutes(
                            a.openingTime
                        ) ?? 9999
                    ) -
                    (
                        parseTimeToMinutes(
                            b.openingTime
                        ) ?? 9999
                    )
            );

        case "name_asc":
            return sorted.sort(
                (a, b) =>
                    compareString(
                        a.name,
                        b.name
                    )
            );

        case "name_desc":
            return sorted.sort(
                (a, b) =>
                    compareString(
                        b.name,
                        a.name
                    )
            );

        default:
            return sorted;
    }
}


// =======================================
// GET /api/restaurants
//
// Query params:
//
// ?search=pho
// ?district=District 1
// ?districtCode=district-1
// ?city=Ho Chi Minh City
// ?priceRange=$$
// ?tag=Vietnamese
// ?cuisine=Vietnamese
// ?minRating=4
// ?openAt=18:00
// ?openNow=true
// ?closingBefore=22:00
// ?openingAfter=09:00
// ?dishSearch=pho
// ?dishCategory=main
// ?sort=rating_desc
//
// Không truyền query:
// -> trả toàn bộ restaurant như API cũ.
// =======================================
exports.getAllRestaurants = async (
    req,
    res
) => {
    try {
        const {
            search = "",
            district,
            districtCode,
            city,
            priceRange,
            tag,
            cuisine,
            minRating,
            openAt,
            openNow,
            closingBefore,
            openingAfter,
            dishSearch,
            dishCategory,
            sort,
        } = req.query;


        // Lấy toàn bộ restaurant.
        // Giữ behavior cũ khi không có query.
        const restaurants =
            await Restaurant.find()
                .sort({ id: 1 })
                .lean();


        if (!restaurants.length) {
            return res.json([]);
        }


        // Lấy ObjectId restaurant.
        const objIds =
            restaurants.map(
                (restaurant) =>
                    new mongoose.Types.ObjectId(
                        restaurant._id
                    )
            );


        // Aggregate reviews.
        const stats =
            await Review.aggregate([
                {
                    $match: {
                        restaurant: {
                            $in: objIds,
                        },
                    },
                },

                {
                    $group: {
                        _id: "$restaurant",

                        avgRating: {
                            $avg: "$rating",
                        },

                        count: {
                            $sum: 1,
                        },
                    },
                },
            ]);


        // Map nhanh:
        // restaurantId -> { avg, count }
        const statMap =
            new Map(
                stats.map((stat) => [
                    String(
                        stat._id
                    ),
                    {
                        avg:
                            stat.avgRating ||
                            0,

                        count:
                            stat.count ||
                            0,
                    },
                ])
            );


        // Enrich rating/reviewCount.
        let enriched =
            restaurants.map(
                (restaurant) => {
                    const stat =
                        statMap.get(
                            String(
                                restaurant._id
                            )
                        );

                    const avg =
                        stat
                            ? stat.avg
                            : 0;

                    const count =
                        stat
                            ? stat.count
                            : 0;

                    return {
                        ...restaurant,

                        rating:
                            Math.round(
                                avg * 10
                            ) / 10,

                        reviewCount:
                            count,
                    };
                }
            );


        // ===================================
        // Search
        // ===================================
        if (search) {
            enriched =
                enriched.filter(
                    (restaurant) =>
                        matchesSearch(
                            restaurant,
                            search
                        )
                );
        }


        // ===================================
        // District
        // ===================================
        if (district) {
            const normalizedDistrict =
                normalizeSearchText(
                    district
                );

            enriched =
                enriched.filter(
                    (restaurant) => {
                        const restaurantDistrict =
                            normalizeSearchText(
                                restaurant.district
                            );

                        const restaurantNumber =
                            parseDistrictNumber(
                                restaurant.district
                            );

                        const requestedNumber =
                            parseDistrictNumber(
                                district
                            );

                        return (
                            restaurantDistrict ===
                                normalizedDistrict ||
                            (
                                requestedNumber !==
                                    null &&
                                restaurantNumber ===
                                    requestedNumber
                            )
                        );
                    }
                );
        }


        // ===================================
        // District code
        // ===================================
        if (districtCode) {
            const requestedCode =
                normalizeSearchText(
                    districtCode
                );

            enriched =
                enriched.filter(
                    (restaurant) =>
                        normalizeSearchText(
                            restaurant.districtCode
                        ) ===
                        requestedCode
                );
        }


        // ===================================
        // City
        // ===================================
        if (city) {
            const normalizedCity =
                normalizeSearchText(
                    city
                );

            enriched =
                enriched.filter(
                    (restaurant) =>
                        normalizeSearchText(
                            restaurant.city
                        ).includes(
                            normalizedCity
                        ) ||
                        normalizeSearchText(
                            restaurant.cityCode
                        ).includes(
                            normalizedCity
                        )
                );
        }


        // ===================================
        // Price range
        // ===================================
        if (priceRange) {
            const requestedPrice =
                normalizePriceRange(
                    priceRange,
                    ""
                );

            if (requestedPrice) {
                enriched =
                    enriched.filter(
                        (restaurant) =>
                            restaurant.priceRange ===
                            requestedPrice
                    );
            }
        }


        // ===================================
        // Cuisine / Tag
        // ===================================
        const requestedTag =
            tag || cuisine;

        if (requestedTag) {
            const normalizedTag =
                normalizeSearchText(
                    requestedTag
                );

            enriched =
                enriched.filter(
                    (restaurant) => {
                        const tags =
                            Array.isArray(
                                restaurant.tags
                            )
                                ? restaurant.tags
                                : [];

                        return tags.some(
                            (item) =>
                                normalizeSearchText(
                                    item
                                ) ===
                                    normalizedTag ||
                                normalizeSearchText(
                                    item
                                ).includes(
                                    normalizedTag
                                )
                        );
                    }
                );
        }


        // ===================================
        // Minimum rating
        // ===================================
        if (
            minRating !==
            undefined
        ) {
            const ratingValue =
                Number(minRating);

            if (
                Number.isFinite(
                    ratingValue
                )
            ) {
                enriched =
                    enriched.filter(
                        (restaurant) =>
                            restaurant.rating >=
                            ratingValue
                    );
            }
        }


        // ===================================
        // Open at specific time
        // ===================================
        if (openAt) {
            if (
                parseTimeToMinutes(
                    openAt
                ) === null
            ) {
                return res.status(400).json({
                    message:
                        "openAt phải có định dạng HH:mm, ví dụ 18:00",
                });
            }

            enriched =
                enriched.filter(
                    (restaurant) =>
                        isOpenAt(
                            restaurant.openingTime,
                            restaurant.closingTime,
                            openAt
                        )
                );
        }


        // ===================================
        // Open now
        // ===================================
        if (
            openNow === "true" ||
            openNow === "1"
        ) {
            const currentTime =
                getCurrentHHMM();

            enriched =
                enriched.filter(
                    (restaurant) =>
                        isOpenAt(
                            restaurant.openingTime,
                            restaurant.closingTime,
                            currentTime
                        )
                );
        }


        // ===================================
        // Closing before
        // ===================================
        if (closingBefore) {
            const targetClosing =
                parseTimeToMinutes(
                    closingBefore
                );

            if (
                targetClosing === null
            ) {
                return res.status(400).json({
                    message:
                        "closingBefore phải có định dạng HH:mm, ví dụ 22:00",
                });
            }

            enriched =
                enriched.filter(
                    (restaurant) => {
                        const closing =
                            parseTimeToMinutes(
                                restaurant.closingTime
                            );

                        return (
                            closing !==
                                null &&
                            closing <=
                                targetClosing
                        );
                    }
                );
        }


        // ===================================
        // Opening after
        // ===================================
        if (openingAfter) {
            const targetOpening =
                parseTimeToMinutes(
                    openingAfter
                );

            if (
                targetOpening === null
            ) {
                return res.status(400).json({
                    message:
                        "openingAfter phải có định dạng HH:mm, ví dụ 09:00",
                });
            }

            enriched =
                enriched.filter(
                    (restaurant) => {
                        const opening =
                            parseTimeToMinutes(
                                restaurant.openingTime
                            );

                        return (
                            opening !==
                                null &&
                            opening >=
                                targetOpening
                        );
                    }
                );
        }


        // ===================================
        // Dish search / category
        // ===================================
        if (
            dishSearch ||
            dishCategory
        ) {
            enriched =
                enriched.filter(
                    (restaurant) =>
                        matchesDishFilter(
                            restaurant,
                            {
                                dishSearch,
                                dishCategory,
                            }
                        )
                );
        }


        // ===================================
        // Sort
        // ===================================
        enriched =
            sortRestaurants(
                enriched,
                sort
            );


        return res.json(
            enriched
        );
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            message: "Lỗi server",
        });
    }
};


// =======================================
// GET /api/restaurants/:id
// id là số 1,2,3,...
// =======================================
exports.getRestaurantById = async (
    req,
    res
) => {
    try {
        const id =
            Number(req.params.id);

        const restaurant =
            await Restaurant.findOne({
                id,
            }).lean();


        if (!restaurant) {
            return res.status(404).json({
                message:
                    "Không tìm thấy nhà hàng",
            });
        }


        const stats =
            await Review.aggregate([
                {
                    $match: {
                        restaurant:
                            new mongoose.Types.ObjectId(
                                restaurant._id
                            ),
                    },
                },

                {
                    $group: {
                        _id:
                            "$restaurant",

                        avgRating: {
                            $avg:
                                "$rating",
                        },

                        count: {
                            $sum: 1,
                        },
                    },
                },
            ]);


        const avg =
            stats.length
                ? stats[0].avgRating
                : 0;

        const count =
            stats.length
                ? stats[0].count
                : 0;


        return res.json({
            ...restaurant,

            rating:
                Math.round(
                    avg * 10
                ) / 10,

            reviewCount:
                count,
        });
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            message: "Lỗi server",
        });
    }
};


// =======================================
// POST /api/restaurants
// Add Restaurant từ admin
// =======================================
exports.createRestaurant = async (
    req,
    res
) => {
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
            dishes,
            priceRange,
            tags,
            phone,
            lat,
            lng,
            amenities,
            reviews,
        } = req.body;


        const formattedAddress =
            formatAddress({
                streetAddress,
                ward,
                district,
                city,
                country,
            }) ||
            String(
                address || ""
            ).trim();


        if (
            !name ||
            !formattedAddress
        ) {
            return res.status(400).json({
                message:
                    "Tên nhà hàng và các trường địa chỉ bắt buộc",
            });
        }


        if (
            (
                streetAddress ||
                district ||
                city ||
                country
            ) &&
            (
                !streetAddress?.trim() ||
                !district?.trim() ||
                !city?.trim() ||
                !country?.trim()
            )
        ) {
            return res.status(400).json({
                message:
                    "Street address, district/area, city, and country are required.",
            });
        }


        // ===================================
        // Geocoding
        // ===================================
        let coordinates = {
            lat: toCoordinate(
                lat,
                -90,
                90
            ),

            lng: toCoordinate(
                lng,
                -180,
                180
            ),
        };


        if (
            !Number.isFinite(
                coordinates.lat
            ) ||
            !Number.isFinite(
                coordinates.lng
            )
        ) {
            const feature =
                await geoapify.geocode(
                    formattedAddress
                );

            coordinates =
                coordinatesFromFeature(
                    feature
                );
        }


        if (
            !Number.isFinite(
                coordinates.lat
            ) ||
            !Number.isFinite(
                coordinates.lng
            )
        ) {
            return res.status(422).json({
                message:
                    "Could not locate this address. Please check the street, district, and city.",
            });
        }


        // ===================================
        // ID tăng dần
        // ===================================
        const last =
            await Restaurant.findOne()
                .sort({
                    id: -1,
                });

        const nextId =
            last
                ? last.id + 1
                : 1;


        // ===================================
        // Dishes
        // ===================================
        // Nếu món cũ không có category
        // -> tự động nhận "main".
        const dishDocs =
            normalizeDishes(
                dishes
            );


        const normalizedPriceRange =
            normalizePriceRange(
                priceRange,
                "$$"
            );


        const normalizedTags =
            normalizeTags(tags);


        const safeDistrict =
            isPostcode(district)
                ? ""
                : String(
                    district || ""
                ).trim();


        const safeDistrictCode =
            isPostcode(
                districtCode
            )
                ? safeDistrict
                : (
                    districtCode ||
                    safeDistrict
                );


        // ===================================
        // Create restaurant
        // ===================================
        const restaurant =
            await Restaurant.create({
                id: nextId,

                name,

                address:
                    formattedAddress,

                streetAddress:
                    String(
                        streetAddress || ""
                    ).trim(),

                ward:
                    String(
                        ward || ""
                    ).trim(),

                district:
                    safeDistrict,

                city:
                    String(
                        city || ""
                    ).trim(),

                country:
                    String(
                        country || ""
                    ).trim(),

                cityCode:
                    normalizeCityCode(
                        city ||
                        cityCode ||
                        "ho-chi-minh"
                    ),

                districtCode:
                    normalizeDistrictCode(
                        safeDistrictCode
                    ),

                image,

                openingTime,

                closingTime,

                description,

                dishes:
                    dishDocs,

                rating:
                    0,

                priceRange:
                    normalizedPriceRange,

                tags:
                    normalizedTags,

                amenities:
                    Array.isArray(
                        amenities
                    )
                        ? amenities
                        : [],

                reviews:
                    Array.isArray(
                        reviews
                    )
                        ? reviews
                        : [],

                phone:
                    phone || "",

                lat:
                    coordinates.lat,

                lng:
                    coordinates.lng,
            });


        return res.status(201).json(
            restaurant
        );
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            message: "Lỗi server",
        });
    }
};


// =======================================
// DELETE /api/restaurants/:id
// =======================================
exports.deleteRestaurant = async (
    req,
    res
) => {
    try {
        const id =
            Number(req.params.id);


        const deleted =
            await Restaurant.findOneAndDelete({
                id,
            });


        if (!deleted) {
            return res.status(404).json({
                message:
                    "Không tìm thấy nhà hàng để xoá",
            });
        }


        return res.json({
            message:
                "Xoá nhà hàng thành công",

            restaurant:
                deleted,
        });
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            message: "Lỗi server",
        });
    }
};


// =======================================
// PUT /api/restaurants/:id
// Edit Restaurant từ admin
// =======================================
exports.updateRestaurant = async (
    req,
    res
) => {
    try {
        const id =
            Number(req.params.id);


        const restaurant =
            await Restaurant.findOne({
                id,
            });


        if (!restaurant) {
            return res.status(404).json({
                message:
                    "Không tìm thấy nhà hàng",
            });
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
            amenities,
            reviews,
        } = req.body;


        // ===================================
        // Address
        // ===================================
        const formattedAddress =
            formatAddress({
                streetAddress,
                ward,
                district,
                city,
                country,
            }) ||
            String(
                address ||
                restaurant.address ||
                ""
            ).trim();


        if (
            !name ||
            !formattedAddress
        ) {
            return res.status(400).json({
                message:
                    "Tên nhà hàng và địa chỉ là bắt buộc",
            });
        }


        if (
            (
                streetAddress ||
                district ||
                city ||
                country
            ) &&
            (
                !streetAddress?.trim() ||
                !district?.trim() ||
                !city?.trim() ||
                !country?.trim()
            )
        ) {
            return res.status(400).json({
                message:
                    "Street address, district/area, city, and country are required.",
            });
        }


        // ===================================
        // Geocoding
        // ===================================
        const addressChanged =
            formattedAddress !==
            restaurant.address;


        let coordinates = {
            lat:
                toCoordinate(
                    lat,
                    -90,
                    90
                ) ??
                restaurant.lat,

            lng:
                toCoordinate(
                    lng,
                    -180,
                    180
                ) ??
                restaurant.lng,
        };


        if (
            addressChanged ||
            !Number.isFinite(
                coordinates.lat
            ) ||
            !Number.isFinite(
                coordinates.lng
            )
        ) {
            const feature =
                await geoapify.geocode(
                    formattedAddress
                );

            coordinates =
                coordinatesFromFeature(
                    feature
                );


            if (
                !Number.isFinite(
                    coordinates.lat
                ) ||
                !Number.isFinite(
                    coordinates.lng
                )
            ) {
                return res.status(422).json({
                    message:
                        "Could not locate this address. Please check the street, district, and city.",
                });
            }
        }


        // ===================================
        // Dishes
        // ===================================
        // Không gửi dishes:
        // giữ nguyên dishes cũ.
        //
        // Gửi dishes: []
        // xóa toàn bộ món.
        const dishDocs =
            dishes !== undefined
                ? normalizeDishes(
                    dishes
                )
                : restaurant.dishes;


        // ===================================
        // Price & tags
        // ===================================
        const normalizedPriceRange =
            normalizePriceRange(
                priceRange,
                restaurant.priceRange ||
                    "$$"
            );


        const normalizedTags =
            tags !== undefined
                ? normalizeTags(tags)
                : (
                    restaurant.tags ||
                    []
                );


        // ===================================
        // Update basic fields
        // ===================================
        if (
            name !== undefined
        ) {
            restaurant.name =
                name;
        }


        if (
            address !== undefined ||
            streetAddress !== undefined ||
            ward !== undefined ||
            district !== undefined ||
            city !== undefined ||
            country !== undefined
        ) {
            restaurant.address =
                formattedAddress;
        }


        if (
            streetAddress !== undefined
        ) {
            restaurant.streetAddress =
                String(
                    streetAddress || ""
                ).trim();
        }


        if (
            ward !== undefined
        ) {
            restaurant.ward =
                String(
                    ward || ""
                ).trim();
        }


        if (
            district !== undefined
        ) {
            restaurant.district =
                isPostcode(
                    district
                )
                    ? ""
                    : String(
                        district || ""
                    ).trim();
        }


        if (
            city !== undefined
        ) {
            restaurant.city =
                String(
                    city || ""
                ).trim();
        }


        if (
            country !== undefined
        ) {
            restaurant.country =
                String(
                    country || ""
                ).trim();
        }


        if (
            city !== undefined ||
            cityCode !== undefined
        ) {
            restaurant.cityCode =
                normalizeCityCode(
                    city ||
                    cityCode ||
                    restaurant.city
                );
        }


        if (
            districtCode !== undefined ||
            district !== undefined
        ) {
            const safeDistrict =
                isPostcode(
                    district
                )
                    ? ""
                    : String(
                        district ??
                        restaurant.district ??
                        ""
                    ).trim();


            const safeDistrictCode =
                isPostcode(
                    districtCode
                )
                    ? safeDistrict
                    : (
                        districtCode ||
                        safeDistrict
                    );


            restaurant.districtCode =
                normalizeDistrictCode(
                    safeDistrictCode
                );
        }


        if (
            image !== undefined &&
            image !== ""
        ) {
            restaurant.image =
                image;
        }


        if (
            openingTime !== undefined
        ) {
            restaurant.openingTime =
                openingTime;
        }


        if (
            closingTime !== undefined
        ) {
            restaurant.closingTime =
                closingTime;
        }


        if (
            description !== undefined
        ) {
            restaurant.description =
                description;
        }


        // ===================================
        // Update dishes
        // ===================================
        if (
            dishes !== undefined
        ) {
            restaurant.dishes =
                dishDocs;
        }


        restaurant.priceRange =
            normalizedPriceRange;


        restaurant.tags =
            normalizedTags;


        if (
            amenities !== undefined
        ) {
            restaurant.amenities =
                Array.isArray(
                    amenities
                )
                    ? amenities
                    : [];
        }


        if (
            reviews !== undefined
        ) {
            restaurant.reviews =
                Array.isArray(
                    reviews
                )
                    ? reviews
                    : [];
        }


        if (
            phone !== undefined &&
            phone !== ""
        ) {
            restaurant.phone =
                phone;
        }


        restaurant.lat =
            coordinates.lat;

        restaurant.lng =
            coordinates.lng;


        // ===================================
        // Save
        // ===================================
        const updated =
            await restaurant.save();


        return res.json(
            updated
        );
    } catch (err) {
        console.error(err);

        return res.status(500).json({
            message: "Lỗi server",
        });
    }
};
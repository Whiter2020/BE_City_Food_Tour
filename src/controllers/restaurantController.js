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

function normalizePriceRange(priceRange, fallback = "$$") {
  const validRanges = ["$", "$$", "$$$", "$$$$", "$$$$$"];
  const value = String(priceRange || "").trim();

  if (validRanges.includes(value)) {
    return value;
  }

  return fallback;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags
      .map((tag) => String(tag || "").trim())
      .filter(Boolean);
  }

  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }

  return [];
}

function normalizeDishCategory(category) {
  if (!category) {
    return "main";
  }

  const value = String(category).trim().toLowerCase();

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
          dish.image ||
          dish.category
        )
    )
    .map((dish, index) => ({
      id: index + 1,
      name: String(dish.name || "").trim(),
      price: dish.price ?? "",
      image: dish.image || "",
      isSignature: Boolean(dish.isSignature),
      category: normalizeDishCategory(dish.category),
    }));
}

function parseTimeToMinutes(time) {
  if (!time) {
    return null;
  }

  const match = String(time)
    .trim()
    .match(/^([01]\d|2[0-3]):([0-5]\d)$/);

  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function normalizeOptionalTime(time) {
  if (time === undefined || time === null) {
    return undefined;
  }

  const value = String(time).trim();

  if (!value) {
    return "";
  }

  return value;
}

function validateTimeField(time, fieldName) {
  const value = normalizeOptionalTime(time);

  if (value === undefined || value === "") {
    return null;
  }

  if (parseTimeToMinutes(value) === null) {
    return `${fieldName} must use HH:mm format, for example 18:00`;
  }

  return null;
}

function isOpenAt(openingTime, closingTime, targetTime) {
  const open = parseTimeToMinutes(openingTime);
  const close = parseTimeToMinutes(closingTime);
  const target = parseTimeToMinutes(targetTime);

  if (open === null || close === null || target === null) {
    return false;
  }

  // Cùng giờ: coi như mở cả ngày.
  if (open === close) {
    return true;
  }

  // Ví dụ 09:00 -> 22:00
  if (open < close) {
    return target >= open && target <= close;
  }

  // Ví dụ 18:00 -> 02:00
  return target >= open || target <= close;
}

function getCurrentHHMM() {
  const now = new Date();

  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");

  return `${hours}:${minutes}`;
}

function parseDishPrice(price) {
  if (typeof price === "number") {
    return Number.isFinite(price) ? price : 0;
  }

  if (price === null || price === undefined) {
    return 0;
  }

  const cleaned = String(price).replace(/[^\d]/g, "");
  const value = Number(cleaned);

  return Number.isFinite(value) ? value : 0;
}

function getMinDishPrice(restaurant) {
  if (
    !Array.isArray(restaurant.dishes) ||
    restaurant.dishes.length === 0
  ) {
    return 0;
  }

  const prices = restaurant.dishes
    .map((dish) => parseDishPrice(dish.price))
    .filter((price) => price > 0);

  return prices.length ? Math.min(...prices) : 0;
}

function parseDistrictNumber(district) {
  if (!district) {
    return null;
  }

  const match = String(district).match(/\d+/);

  if (!match) {
    return null;
  }

  const number = Number(match[0]);

  return Number.isFinite(number) ? number : null;
}

function normalizeSearchText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function matchesSearch(restaurant, search) {
  if (!search) {
    return true;
  }

  const keyword = normalizeSearchText(search);

  const searchableValues = [
    restaurant.name,
    restaurant.address,
    restaurant.streetAddress,
    restaurant.ward,
    restaurant.district,
    restaurant.city,

    ...(Array.isArray(restaurant.tags)
      ? restaurant.tags
      : []),

    ...(Array.isArray(restaurant.dishes)
      ? restaurant.dishes.flatMap((dish) => [
          dish.name,
          dish.category,
        ])
      : []),
  ];

  return searchableValues.some((value) =>
    normalizeSearchText(value).includes(keyword)
  );
}

function matchesDishFilter(
  restaurant,
  {
    dishSearch,
    dishCategory,
  }
) {
  if (!dishSearch && !dishCategory) {
    return true;
  }

  const dishes = Array.isArray(restaurant.dishes)
    ? restaurant.dishes
    : [];

  const keyword = normalizeSearchText(dishSearch);

  return dishes.some((dish) => {
    const categoryMatch =
      !dishCategory ||
      normalizeDishCategory(dish.category) ===
        normalizeDishCategory(dishCategory);

    const nameMatch =
      !keyword ||
      normalizeSearchText(dish.name).includes(keyword);

    return categoryMatch && nameMatch;
  });
}

function sortRestaurants(restaurants, sort) {
  if (!sort) {
    return restaurants;
  }

  const priceRank = {
    $: 1,
    $$: 2,
    $$$: 3,
    $$$$: 4,
    $$$$$: 5,
  };

  const compareString = (a, b) =>
    String(a || "").localeCompare(
      String(b || ""),
      "vi",
      {
        sensitivity: "base",
      }
    );

  const sorted = [...restaurants];

  switch (sort) {
    case "rating_desc":
      return sorted.sort((a, b) => b.rating - a.rating);

    case "rating_asc":
      return sorted.sort((a, b) => a.rating - b.rating);

    case "price_asc":
      return sorted.sort(
        (a, b) =>
          (priceRank[a.priceRange] || 0) -
          (priceRank[b.priceRange] || 0)
      );

    case "price_desc":
      return sorted.sort(
        (a, b) =>
          (priceRank[b.priceRange] || 0) -
          (priceRank[a.priceRange] || 0)
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
          (parseTimeToMinutes(a.closingTime) ?? 9999) -
          (parseTimeToMinutes(b.closingTime) ?? 9999)
      );

    case "closing_desc":
      return sorted.sort(
        (a, b) =>
          (parseTimeToMinutes(b.closingTime) ?? -1) -
          (parseTimeToMinutes(a.closingTime) ?? -1)
      );

    case "opening_asc":
      return sorted.sort(
        (a, b) =>
          (parseTimeToMinutes(a.openingTime) ?? 9999) -
          (parseTimeToMinutes(b.openingTime) ?? 9999)
      );

    case "name_asc":
      return sorted.sort((a, b) =>
        compareString(a.name, b.name)
      );

    case "name_desc":
      return sorted.sort((a, b) =>
        compareString(b.name, a.name)
      );

    default:
      return sorted;
  }
}

function hasAnyAddressField(payload) {
  return [
    "address",
    "streetAddress",
    "ward",
    "district",
    "city",
    "country",
  ].some((field) => payload[field] !== undefined);
}

function validateStructuredAddress(payload) {
  const hasStructuredAddress = [
    payload.streetAddress,
    payload.district,
    payload.city,
    payload.country,
  ].some(
    (value) =>
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ""
  );

  if (!hasStructuredAddress) {
    return null;
  }

  if (
    !payload.streetAddress?.trim() ||
    !payload.district?.trim() ||
    !payload.city?.trim() ||
    !payload.country?.trim()
  ) {
    return "Street address, district/area, city, and country are required.";
  }

  return null;
}

function buildFormattedAddress(payload, fallbackAddress = "") {
  return (
    formatAddress({
      streetAddress: payload.streetAddress,
      ward: payload.ward,
      district: payload.district,
      city: payload.city,
      country: payload.country,
    }) ||
    String(payload.address || fallbackAddress || "").trim()
  );
}

function normalizeDistrictValue(district) {
  return isPostcode(district)
    ? ""
    : String(district || "").trim();
}

function normalizeDistrictCodeValue(districtCode, district) {
  const safeDistrict = normalizeDistrictValue(district);

  const safeDistrictCode = isPostcode(districtCode)
    ? safeDistrict
    : districtCode || safeDistrict;

  return normalizeDistrictCode(safeDistrictCode);
}

function parseProvidedCoordinate(value, min, max, fieldName) {
  if (value === undefined || value === null || value === "") {
    return {
      provided: false,
      value: null,
      error: null,
    };
  }

  const parsed = toCoordinate(value, min, max);

  if (!Number.isFinite(parsed)) {
    return {
      provided: true,
      value: null,
      error: `${fieldName} must be a valid coordinate`,
    };
  }

  return {
    provided: true,
    value: parsed,
    error: null,
  };
}

async function resolveCoordinates({
  lat,
  lng,
  formattedAddress,
  fallbackLat = null,
  fallbackLng = null,
  shouldGeocode = true,
}) {
  const parsedLat = parseProvidedCoordinate(
    lat,
    -90,
    90,
    "lat"
  );

  const parsedLng = parseProvidedCoordinate(
    lng,
    -180,
    180,
    "lng"
  );

  if (parsedLat.error) {
    return {
      error: parsedLat.error,
      coordinates: null,
    };
  }

  if (parsedLng.error) {
    return {
      error: parsedLng.error,
      coordinates: null,
    };
  }

  const hasManualCoordinates =
    parsedLat.provided || parsedLng.provided;

  if (hasManualCoordinates) {
    if (!parsedLat.provided || !parsedLng.provided) {
      return {
        error:
          "Both lat and lng are required when setting coordinates manually",
        coordinates: null,
      };
    }

    return {
      error: null,
      coordinates: {
        lat: parsedLat.value,
        lng: parsedLng.value,
      },
    };
  }

  const existingCoordinates = {
    lat: fallbackLat,
    lng: fallbackLng,
  };

  if (
    !shouldGeocode &&
    Number.isFinite(existingCoordinates.lat) &&
    Number.isFinite(existingCoordinates.lng)
  ) {
    return {
      error: null,
      coordinates: existingCoordinates,
    };
  }

  const feature = await geoapify.geocode(formattedAddress);

  const coordinates = coordinatesFromFeature(feature);

  if (
    !Number.isFinite(coordinates.lat) ||
    !Number.isFinite(coordinates.lng)
  ) {
    return {
      error:
        "Could not locate this address. Please check the street, district, and city.",
      coordinates: null,
    };
  }

  return {
    error: null,
    coordinates,
  };
}

async function getNextRestaurantId() {
  const last = await Restaurant.findOne().sort({
    id: -1,
  });

  return last ? last.id + 1 : 1;
}

// =======================================
// GET /api/restaurants
// =======================================

exports.getAllRestaurants = async (req, res) => {
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

    const restaurants = await Restaurant.find()
      .sort({
        id: 1,
      })
      .lean();

    if (!restaurants.length) {
      return res.json([]);
    }

    const objIds = restaurants.map(
      (restaurant) =>
        new mongoose.Types.ObjectId(restaurant._id)
    );

    const stats = await Review.aggregate([
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

    const statMap = new Map(
      stats.map((stat) => [
        String(stat._id),
        {
          avg: stat.avgRating || 0,
          count: stat.count || 0,
        },
      ])
    );

    let enriched = restaurants.map((restaurant) => {
      const stat = statMap.get(String(restaurant._id));

      const avg = stat ? stat.avg : 0;
      const count = stat ? stat.count : 0;

      return {
        ...restaurant,
        rating: Math.round(avg * 10) / 10,
        reviewCount: count,
      };
    });

    if (search) {
      enriched = enriched.filter((restaurant) =>
        matchesSearch(restaurant, search)
      );
    }

    if (district) {
      const normalizedDistrict = normalizeSearchText(district);

      enriched = enriched.filter((restaurant) => {
        const restaurantDistrict = normalizeSearchText(
          restaurant.district
        );

        const restaurantNumber = parseDistrictNumber(
          restaurant.district
        );

        const requestedNumber = parseDistrictNumber(district);

        return (
          restaurantDistrict === normalizedDistrict ||
          (
            requestedNumber !== null &&
            restaurantNumber === requestedNumber
          )
        );
      });
    }

    if (districtCode) {
      const requestedCode = normalizeSearchText(districtCode);

      enriched = enriched.filter(
        (restaurant) =>
          normalizeSearchText(restaurant.districtCode) ===
          requestedCode
      );
    }

    if (city) {
      const normalizedCity = normalizeSearchText(city);

      enriched = enriched.filter(
        (restaurant) =>
          normalizeSearchText(restaurant.city).includes(
            normalizedCity
          ) ||
          normalizeSearchText(restaurant.cityCode).includes(
            normalizedCity
          )
      );
    }

    if (priceRange) {
      const requestedPrice = normalizePriceRange(priceRange, "");

      if (requestedPrice) {
        enriched = enriched.filter(
          (restaurant) =>
            restaurant.priceRange === requestedPrice
        );
      }
    }

    const requestedTag = tag || cuisine;

    if (requestedTag) {
      const normalizedTag = normalizeSearchText(requestedTag);

      enriched = enriched.filter((restaurant) => {
        const tags = Array.isArray(restaurant.tags)
          ? restaurant.tags
          : [];

        return tags.some(
          (item) =>
            normalizeSearchText(item) === normalizedTag ||
            normalizeSearchText(item).includes(normalizedTag)
        );
      });
    }

    if (minRating !== undefined) {
      const ratingValue = Number(minRating);

      if (Number.isFinite(ratingValue)) {
        enriched = enriched.filter(
          (restaurant) => restaurant.rating >= ratingValue
        );
      }
    }

    if (openAt) {
      if (parseTimeToMinutes(openAt) === null) {
        return res.status(400).json({
          message:
            "openAt phải có định dạng HH:mm, ví dụ 18:00",
        });
      }

      enriched = enriched.filter((restaurant) =>
        isOpenAt(
          restaurant.openingTime,
          restaurant.closingTime,
          openAt
        )
      );
    }

    if (openNow === "true" || openNow === "1") {
      const currentTime = getCurrentHHMM();

      enriched = enriched.filter((restaurant) =>
        isOpenAt(
          restaurant.openingTime,
          restaurant.closingTime,
          currentTime
        )
      );
    }

    if (closingBefore) {
      const targetClosing = parseTimeToMinutes(closingBefore);

      if (targetClosing === null) {
        return res.status(400).json({
          message:
            "closingBefore phải có định dạng HH:mm, ví dụ 22:00",
        });
      }

      enriched = enriched.filter((restaurant) => {
        const closing = parseTimeToMinutes(
          restaurant.closingTime
        );

        return (
          closing !== null &&
          closing <= targetClosing
        );
      });
    }

    if (openingAfter) {
      const targetOpening = parseTimeToMinutes(openingAfter);

      if (targetOpening === null) {
        return res.status(400).json({
          message:
            "openingAfter phải có định dạng HH:mm, ví dụ 09:00",
        });
      }

      enriched = enriched.filter((restaurant) => {
        const opening = parseTimeToMinutes(
          restaurant.openingTime
        );

        return (
          opening !== null &&
          opening >= targetOpening
        );
      });
    }

    if (dishSearch || dishCategory) {
      enriched = enriched.filter((restaurant) =>
        matchesDishFilter(restaurant, {
          dishSearch,
          dishCategory,
        })
      );
    }

    enriched = sortRestaurants(enriched, sort);

    return res.json(enriched);
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

exports.getRestaurantById = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        message: "ID nhà hàng không hợp lệ",
      });
    }

    const restaurant = await Restaurant.findOne({
      id,
    }).lean();

    if (!restaurant) {
      return res.status(404).json({
        message: "Không tìm thấy nhà hàng",
      });
    }

    const stats = await Review.aggregate([
      {
        $match: {
          restaurant: new mongoose.Types.ObjectId(
            restaurant._id
          ),
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

    const avg = stats.length ? stats[0].avgRating : 0;
    const count = stats.length ? stats[0].count : 0;

    return res.json({
      ...restaurant,
      rating: Math.round(avg * 10) / 10,
      reviewCount: count,
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

exports.createRestaurant = async (req, res) => {
  try {
    const body = req.body || {};

    const {
      name,
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
    } = body;

    const normalizedName = String(name || "").trim();

    const formattedAddress = buildFormattedAddress(body);

    if (!normalizedName || !formattedAddress) {
      return res.status(400).json({
        message: "Tên nhà hàng và các trường địa chỉ bắt buộc",
      });
    }

    const addressError = validateStructuredAddress(body);

    if (addressError) {
      return res.status(400).json({
        message: addressError,
      });
    }

    const openingError = validateTimeField(
      openingTime,
      "openingTime"
    );

    const closingError = validateTimeField(
      closingTime,
      "closingTime"
    );

    if (openingError || closingError) {
      return res.status(400).json({
        message: openingError || closingError,
      });
    }

    const resolved = await resolveCoordinates({
      lat,
      lng,
      formattedAddress,
      shouldGeocode: true,
    });

    if (resolved.error) {
      return res.status(422).json({
        message: resolved.error,
      });
    }

    const nextId = await getNextRestaurantId();

    const dishDocs = normalizeDishes(dishes);

    const normalizedPriceRange = normalizePriceRange(
      priceRange,
      "$$"
    );

    const normalizedTags = normalizeTags(tags);

    const safeDistrict = normalizeDistrictValue(district);

    const safeDistrictCode = districtCode || safeDistrict;

    const restaurant = await Restaurant.create({
      id: nextId,

      name: normalizedName,

      address: formattedAddress,

      streetAddress: String(streetAddress || "").trim(),

      ward: String(ward || "").trim(),

      district: safeDistrict,

      city: String(city || "").trim(),

      country: String(country || "").trim(),

      cityCode: normalizeCityCode(
        city ||
          cityCode ||
          "ho-chi-minh"
      ),

      districtCode: normalizeDistrictCodeValue(
        safeDistrictCode,
        safeDistrict
      ),

      image: image || "",

      openingTime: normalizeOptionalTime(openingTime) || "",

      closingTime: normalizeOptionalTime(closingTime) || "",

      description: description || "",

      dishes: dishDocs,

      rating: 0,

      priceRange: normalizedPriceRange,

      tags: normalizedTags,

      amenities: Array.isArray(amenities)
        ? amenities
        : [],

      reviews: Array.isArray(reviews)
        ? reviews
        : [],

      phone: phone || "",

      lat: resolved.coordinates.lat,

      lng: resolved.coordinates.lng,
    });

    return res.status(201).json(restaurant);
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

exports.deleteRestaurant = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        message: "ID nhà hàng không hợp lệ",
      });
    }

    const deleted = await Restaurant.findOneAndDelete({
      id,
    });

    if (!deleted) {
      return res.status(404).json({
        message: "Không tìm thấy nhà hàng để xoá",
      });
    }

    return res.json({
      message: "Xoá nhà hàng thành công",
      restaurant: deleted,
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

exports.updateRestaurant = async (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({
        message: "ID nhà hàng không hợp lệ",
      });
    }

    const restaurant = await Restaurant.findOne({
      id,
    });

    if (!restaurant) {
      return res.status(404).json({
        message: "Không tìm thấy nhà hàng",
      });
    }

    const body = req.body || {};

    const {
      name,
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
    } = body;

    const addressWasProvided = hasAnyAddressField(body);

    const formattedAddress = addressWasProvided
      ? buildFormattedAddress(body, restaurant.address)
      : restaurant.address;

    const normalizedName =
      name !== undefined
        ? String(name || "").trim()
        : restaurant.name;

    if (!normalizedName || !formattedAddress) {
      return res.status(400).json({
        message: "Tên nhà hàng và địa chỉ là bắt buộc",
      });
    }

    const addressError = validateStructuredAddress(body);

    if (addressError) {
      return res.status(400).json({
        message: addressError,
      });
    }

    const openingError = validateTimeField(
      openingTime,
      "openingTime"
    );

    const closingError = validateTimeField(
      closingTime,
      "closingTime"
    );

    if (openingError || closingError) {
      return res.status(400).json({
        message: openingError || closingError,
      });
    }

    const addressChanged =
      addressWasProvided &&
      formattedAddress !== restaurant.address;

    const resolved = await resolveCoordinates({
      lat,
      lng,
      formattedAddress,
      fallbackLat: restaurant.lat,
      fallbackLng: restaurant.lng,
      shouldGeocode:
        addressChanged ||
        !Number.isFinite(restaurant.lat) ||
        !Number.isFinite(restaurant.lng),
    });

    if (resolved.error) {
      return res.status(422).json({
        message: resolved.error,
      });
    }

    const dishDocs =
      dishes !== undefined
        ? normalizeDishes(dishes)
        : restaurant.dishes;

    const normalizedPriceRange = normalizePriceRange(
      priceRange,
      restaurant.priceRange || "$$"
    );

    const normalizedTags =
      tags !== undefined
        ? normalizeTags(tags)
        : restaurant.tags || [];

    restaurant.name = normalizedName;

    if (addressWasProvided) {
      restaurant.address = formattedAddress;
    }

    if (streetAddress !== undefined) {
      restaurant.streetAddress = String(streetAddress || "").trim();
    }

    if (ward !== undefined) {
      restaurant.ward = String(ward || "").trim();
    }

    if (district !== undefined) {
      restaurant.district = normalizeDistrictValue(district);
    }

    if (city !== undefined) {
      restaurant.city = String(city || "").trim();
    }

    if (country !== undefined) {
      restaurant.country = String(country || "").trim();
    }

    if (city !== undefined || cityCode !== undefined) {
      restaurant.cityCode = normalizeCityCode(
        city ||
          cityCode ||
          restaurant.city
      );
    }

    if (district !== undefined || districtCode !== undefined) {
      const safeDistrict = normalizeDistrictValue(
        district ?? restaurant.district ?? ""
      );

      const safeDistrictCode = districtCode || safeDistrict;

      restaurant.districtCode = normalizeDistrictCodeValue(
        safeDistrictCode,
        safeDistrict
      );
    }

    if (image !== undefined) {
      restaurant.image = image;
    }

    if (openingTime !== undefined) {
      restaurant.openingTime =
        normalizeOptionalTime(openingTime) || "";
    }

    if (closingTime !== undefined) {
      restaurant.closingTime =
        normalizeOptionalTime(closingTime) || "";
    }

    if (description !== undefined) {
      restaurant.description = description;
    }

    if (dishes !== undefined) {
      restaurant.dishes = dishDocs;
    }

    restaurant.priceRange = normalizedPriceRange;

    restaurant.tags = normalizedTags;

    if (amenities !== undefined) {
      restaurant.amenities = Array.isArray(amenities)
        ? amenities
        : [];
    }

    if (reviews !== undefined) {
      restaurant.reviews = Array.isArray(reviews)
        ? reviews
        : [];
    }

    if (phone !== undefined) {
      restaurant.phone = phone || "";
    }

    restaurant.lat = resolved.coordinates.lat;

    restaurant.lng = resolved.coordinates.lng;

    const updated = await restaurant.save();

    return res.json(updated);
  } catch (err) {
    console.error(err);

    return res.status(500).json({
      message: "Lỗi server",
    });
  }
};
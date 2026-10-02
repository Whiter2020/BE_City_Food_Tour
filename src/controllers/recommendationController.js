const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const Review = require("../models/Review");
const Tour = require("../models/Tour");
const { normalizeCityCode, normalizeDistrictCode } = require("../utils/location");

const uniqueNumbers = (values) => [...new Set(values.map(Number).filter(Number.isFinite))];
const sharedTag = (restaurant, tags) => (restaurant.tags || []).some((tag) => tags.has(String(tag).toLowerCase()));
const distanceKm = (from, to) => {
  const radians = (value) => value * Math.PI / 180;
  const earthRadiusKm = 6371;
  const latDiff = radians(to.lat - from.lat);
  const lngDiff = radians(to.lng - from.lng);
  const a = Math.sin(latDiff / 2) ** 2 + Math.cos(radians(from.lat)) * Math.cos(radians(to.lat)) * Math.sin(lngDiff / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

exports.recommendRestaurants = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    const restaurants = await Restaurant.find().lean();
    if (!restaurants.length) return res.json({ message: "No restaurants found", data: [] });

    const [reviewRatings, tours] = await Promise.all([
      Review.aggregate([{ $group: { _id: "$restaurant", avgRating: { $avg: "$rating" } } }]),
      Tour.find({ user: user._id }).select("restaurants.restaurant").lean(),
    ]);
    const ratingMap = new Map(reviewRatings.map(({ _id, avgRating }) => [String(_id), Number(avgRating.toFixed(2))]));
    const restaurantIdByObjectId = new Map(restaurants.map((restaurant) => [String(restaurant._id), Number(restaurant.id)]));
    const favoriteIds = uniqueNumbers([...(user.favorites || []), ...(user.liked_restaurants || []).map((item) => item.restaurant_id)]);
    const viewedIds = uniqueNumbers((user.viewed_restaurants || []).map((item) => item.restaurant_id));
    const tourRestaurantIds = uniqueNumbers(tours.flatMap((tour) => (tour.restaurants || []).map((item) => restaurantIdByObjectId.get(String(item.restaurant)))));
    const restaurantsById = new Map(restaurants.map((restaurant) => [Number(restaurant.id), restaurant]));
    const tagsFor = (ids) => new Set(ids.flatMap((id) => restaurantsById.get(id)?.tags || []).map((tag) => String(tag).toLowerCase()));
    const favoriteTags = tagsFor(favoriteIds);
    const viewedTags = tagsFor(viewedIds);
    const tourTags = tagsFor(tourRestaurantIds);
    const searchTerms = [...new Set((user.search_history || []).slice(-10).map((entry) => String(entry.keyword || "").trim().toLowerCase()).filter((term) => term.length >= 2))];
    const tasteProfile = user.taste_profile || ["Any"];
    const preferredArea = user.preferred_area || "";
    const preferredCityCode = normalizeCityCode(user.preferred_city_code || "ho-chi-minh");
    const preferredDistrictCode = normalizeDistrictCode(user.preferred_district_code || preferredArea);
    const priceRange = user.price_range || "";
    const userLocation = Number.isFinite(Number(req.query.lat)) && Number.isFinite(Number(req.query.lng)) && Math.abs(Number(req.query.lat)) <= 90 && Math.abs(Number(req.query.lng)) <= 180
      ? { lat: Number(req.query.lat), lng: Number(req.query.lng) } : null;

    const result = restaurants.map((restaurant) => {
      let score = 0;
      const reasons = [];
      const text = [restaurant.name, restaurant.address, restaurant.district, ...(restaurant.tags || []), ...(restaurant.dishes || []).map((dish) => dish.name)].filter(Boolean).join(" ").toLowerCase();
      const matchingTaste = tasteProfile.find((taste) => taste !== "Any" && text.includes(String(taste).toLowerCase()));
      if (matchingTaste) { score += 50; reasons.push(`Matches your taste: ${matchingTaste}`); }
      if (preferredArea && normalizeCityCode(restaurant.cityCode || "ho-chi-minh") === preferredCityCode && normalizeDistrictCode(restaurant.districtCode || restaurant.district) === preferredDistrictCode) { score += 30; reasons.push("Located in your preferred area"); }
      if (priceRange && restaurant.priceRange === priceRange) { score += 20; reasons.push("Matches your budget"); }
      if (sharedTag(restaurant, favoriteTags)) { score += 25; reasons.push("Similar to restaurants you saved"); }
      if (sharedTag(restaurant, viewedTags)) { score += 10; reasons.push("Similar to restaurants you viewed"); }
      if (sharedTag(restaurant, tourTags)) { score += 15; reasons.push("Matches your food-tour history"); }
      if (searchTerms.some((term) => text.includes(term))) { score += 10; reasons.push("Matches a recent search"); }
      const rating = ratingMap.get(String(restaurant._id)) || Number(restaurant.rating || 0);
      const ratingScore = Math.min(10, Math.max(0, (rating - 3) * 5));
      if (ratingScore > 0) { score += ratingScore; reasons.push("Highly rated by the community"); }
      if (userLocation && Number.isFinite(restaurant.lat) && Number.isFinite(restaurant.lng)) {
        const km = distanceKm(userLocation, { lat: restaurant.lat, lng: restaurant.lng });
        if (km <= 3) { score += 20; reasons.push("Near your current location"); }
        else if (km <= 8) { score += 10; reasons.push("Close to your current location"); }
      }
      return { id: restaurant.id, name: restaurant.name, address: restaurant.address, district: restaurant.district, tags: restaurant.tags, image: restaurant.image, rating, score: Number(score.toFixed(2)), reason: reasons };
    });
    result.sort((a, b) => b.score - a.score || b.rating - a.rating);
    return res.json({ message: "Recommendation success", algorithm: "Profile + behavior + tour history + rating + optional location scoring", data: result.slice(0, 10) });
  } catch (error) {
    console.error("Recommendation error:", error);
    return res.status(500).json({ message: "Recommendation failed" });
  }
};

const Review = require("../models/Review");
const Restaurant = require("../models/Restaurant");
const mongoose = require("mongoose");

// helper: cập nhật avg_rating + reviewCount (cache)
async function recalcRestaurantRating(restaurantObjectId) {
    const stats = await Review.aggregate([
        { $match: { restaurant: new mongoose.Types.ObjectId(restaurantObjectId) } },
        {
            $group: {
                _id: "$restaurant",
                avgRating: { $avg: "$rating" },
                count: { $sum: 1 },
            },
        },
    ]);

    const avgRating = stats?.[0]?.avgRating ?? 0;
    const count = stats?.[0]?.count ?? 0;

    await Restaurant.findByIdAndUpdate(restaurantObjectId, {
        rating: Number(avgRating.toFixed(1)),
        reviewCount: count,
    });
}
// GET /api/restaurants/:restaurantId/reviews
exports.getReviewsByRestaurant = async (req, res) => {
    try {
        const { restaurantId } = req.params;

        const restaurant = await Restaurant.findOne({ id: Number(restaurantId) });
        if (!restaurant) return res.status(404).json({ message: "Restaurant not found" });

        const reviews = await Review.find({ restaurant: restaurant._id })
            .populate("user", "username email avatar")
            .sort({ createdAt: -1 });

        // map response gọn cho FE
        const result = reviews.map((r) => ({
            _id: r._id,
            rating: r.rating,
            content: r.content,
            createdAt: r.createdAt,
            user: {
                _id: r.user?._id,
                username: r.user?.username,
                email: r.user?.email,
                avatar: r.user?.avatar,
            },
        }));

        res.json(result);
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Cannot fetch reviews" });
    }
};

// POST /api/restaurants/:restaurantId/reviews  (auth)
exports.createReview = async (req, res) => {
    try {
        const { restaurantId } = req.params;
        const userId = req.user?.id;
        const { rating, content } = req.body;

        if (!rating || !content) {
            return res.status(400).json({ message: "rating and content are required" });
        }

        const restaurant = await Restaurant.findOne({ id: Number(restaurantId) });
        if (!restaurant) return res.status(404).json({ message: "Restaurant not found" });

        const restaurantObjectId = restaurant._id;

        const review = await Review.create({
            user: userId,
            restaurant: restaurantObjectId,
            rating,
            content,
        });

        await recalcRestaurantRating(restaurantObjectId);

        res.status(201).json({
            _id: review._id,
            rating: review.rating,
            content: review.content,
            createdAt: review.createdAt,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Cannot create review" });
    }
};

// OPTIONAL: PUT /api/reviews/:reviewId  (auth)
exports.updateMyReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const userId = req.user?.id;
        const { rating, content } = req.body;

        const review = await Review.findById(reviewId);
        if (!review) return res.status(404).json({ message: "Review not found" });
        if (String(review.user) !== String(userId))
            return res.status(403).json({ message: "Forbidden" });

        if (rating !== undefined) review.rating = rating;
        if (content !== undefined) review.content = content;

        await review.save();

        await recalcRestaurantRating(review.restaurant);

        res.json({ message: "Updated", review });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Cannot update review" });
    }
};

// OPTIONAL: DELETE /api/reviews/:reviewId  (auth)
exports.deleteMyReview = async (req, res) => {
    try {
        const { reviewId } = req.params;
        const userId = req.user?.id;

        const review = await Review.findById(reviewId);
        if (!review) return res.status(404).json({ message: "Review not found" });
        if (String(review.user) !== String(userId))
            return res.status(403).json({ message: "Forbidden" });

        const restaurantId = review.restaurant;
        await review.deleteOne();

        await recalcRestaurantRating(restaurantId);

        res.json({ message: "Deleted" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: "Cannot delete review" });
    }
};

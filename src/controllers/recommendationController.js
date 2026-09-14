const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const Review = require("../models/Review");
// ======================================================
// USER PERSONALIZED RESTAURANT RECOMMENDATION
//
// GET /api/recommendations/restaurants
//
// Algorithm:
// 1. Taste profile matching
// 2. Search history matching
// 3. Viewed restaurant behavior
// 4. Liked restaurant behavior
// 5. Restaurant rating
//
// ======================================================
exports.recommendRestaurants = async (req, res) => {

    try {

        const userId = req.user.id;



        // =====================================
        // 1. Get User Profile
        // =====================================

        const user = await User.findById(userId);


        if (!user) {

            return res.status(404).json({
                message: "User not found"
            });

        }
        // =====================================
        // 2. Get Restaurants
        // =====================================
        const restaurants = await Restaurant.find();
        if (!restaurants.length) {

            return res.json({

                message: "No restaurants found",

                data: []

            });

        }





        // =====================================
        // 3. Get Review Rating
        // =====================================

        const reviewRatings = await Review.aggregate([

            {
                $group: {

                    _id: "$restaurant",

                    avgRating: {
                        $avg: "$rating"
                    },

                    totalReviews: {
                        $sum: 1
                    }

                }

            }

        ]);



        const ratingMap = {};



        reviewRatings.forEach(item => {

            ratingMap[
                item._id.toString()
            ] = {

                avgRating:
                    Number(
                        item.avgRating.toFixed(2)
                    ),

                totalReviews:
                    item.totalReviews

            };

        });







        // =====================================
        // 4. User Behavior Data
        // =====================================


        const tasteProfile =
            user.taste_profile || [];



        const searchHistory =
            (user.search_history || [])
            .map(item =>
                item.keyword
                ?
                item.keyword.toLowerCase()
                :
                ""
            );



        const viewedRestaurants =
            (user.viewed_restaurants || [])
            .map(item =>
                item.restaurant_id
            );



        const likedRestaurants =
            (user.liked_restaurants || [])
            .map(item =>
                item.restaurant_id
            );







        // =====================================
        // 5. Calculate Recommendation Score
        // =====================================


        const recommendationList =
            restaurants.map(restaurant => {


                let score = 0;



                const restaurantText = [

                    restaurant.name,

                    restaurant.address,

                    restaurant.district,

                    ...(restaurant.tags || [])

                ]

                .join(" ")

                .toLowerCase();







                // -----------------------------
                // Taste matching
                // Weight: 40
                // -----------------------------

                tasteProfile.forEach(taste => {


                    if (

                        taste !== "Any"

                        &&

                        restaurantText.includes(
                            taste.toLowerCase()
                        )

                    ) {

                        score += 40;

                    }


                });







                // -----------------------------
                // Search history
                // Weight: 20
                // -----------------------------

                searchHistory.forEach(keyword => {


                    if (

                        keyword

                        &&

                        restaurantText.includes(
                            keyword
                        )

                    ) {

                        score += 20;

                    }


                });








                // -----------------------------
                // Viewed restaurant
                // Weight: 15
                // -----------------------------

                if (

                    viewedRestaurants.includes(
                        restaurant.id
                    )

                ) {

                    score += 15;

                }








                // -----------------------------
                // Liked restaurant
                // Weight: 15
                // -----------------------------

                if (

                    likedRestaurants.includes(
                        restaurant.id
                    )

                ) {

                    score += 15;

                }








                // -----------------------------
                // Rating
                // Weight: 10
                // -----------------------------

                const ratingData =
                    ratingMap[
                        restaurant._id.toString()
                    ];



                const avgRating =
                    ratingData
                    ?
                    ratingData.avgRating
                    :
                    restaurant.rating || 0;



                score += avgRating * 2;







                return {


                    id:
                    restaurant.id,


                    name:
                    restaurant.name,


                    address:
                    restaurant.address,


                    district:
                    restaurant.district,


                    tags:
                    restaurant.tags,


                    image:
                    restaurant.image,


                    rating:
                    avgRating,


                    score:
                    Number(
                        score.toFixed(2)
                    )

                };


            });
        // =====================================
        // 6. Sort Highest Score
        // =====================================
        recommendationList.sort(
            (a,b) =>
                b.score - a.score
        );

        // Top 10 recommendation
        const result =
            recommendationList.slice(0,10);

        return res.json({

            message:
                "Recommendation success",


            algorithm:
                "User behavior based scoring",



            data:
                result

        });




    }

    catch(error) {


        console.error(
            "Recommendation error:",
            error
        );



        return res.status(500).json({

            message:
                "Recommendation failed"

        });

    }

};
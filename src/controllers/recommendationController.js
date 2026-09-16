const User = require("../models/User");
const Restaurant = require("../models/Restaurant");
const Review = require("../models/Review");


// ======================================================
// USER PERSONALIZED RESTAURANT RECOMMENDATION
//
// Based on:
// 1. Taste Profile
// 2. Preferred Area
// 3. Price Range
//
// GET /api/recommendations/restaurants
// ======================================================


exports.recommendRestaurants = async (req, res) => {

    try {


        const userId = req.user.id;



        // =====================================
        // 1. Get User
        // =====================================

        const user = await User.findById(userId);


        if (!user) {

            return res.status(404).json({
                message:"User not found"
            });

        }




        // =====================================
        // 2. Get Restaurants
        // =====================================

        const restaurants = await Restaurant.find();



        if(!restaurants.length){

            return res.json({

                message:"No restaurants found",

                data:[]

            });

        }




        // =====================================
        // 3. Get Review Rating
        // =====================================


        const reviewRatings =
            await Review.aggregate([

                {
                    $group:{

                        _id:"$restaurant",

                        avgRating:{
                            $avg:"$rating"
                        }

                    }

                }

            ]);



        const ratingMap = {};



        reviewRatings.forEach(item=>{


            ratingMap[
                item._id.toString()
            ] = Number(
                item.avgRating.toFixed(2)
            );


        });







        // =====================================
        // 4. User Preference Data
        // =====================================


        const tasteProfile =
            user.taste_profile || ["Any"];



        const preferredArea =
            user.preferred_area || "";



        const priceRange =
            user.price_range || "";







        // =====================================
        // 5. Calculate Score
        // =====================================


        const recommendationList =


        restaurants.map(restaurant=>{


            let score = 0;


            let reasons = [];



            const restaurantText = [

                restaurant.name,

                restaurant.address,

                restaurant.district,

                restaurant.cuisine,

                ...(restaurant.tags || [])

            ]

            .join(" ")

            .toLowerCase();






            // =================================
            // Taste Profile Matching
            // Weight: 50
            // =================================


            let tasteMatched = false;



            tasteProfile.forEach(taste=>{


                if(

                    taste !== "Any"

                    &&

                    restaurantText.includes(
                        taste.toLowerCase()
                    )

                ){

                    score += 50;


                    tasteMatched = true;


                    reasons.push(
                        `Matches your taste: ${taste}`
                    );


                }


            });








            // =================================
            // Preferred Area Matching
            // Weight: 30
            // =================================


            if(

                preferredArea

                &&

                restaurant.district

                &&

                restaurant.district
                .toLowerCase()
                .includes(
                    preferredArea.toLowerCase()
                )

            ){


                score +=30;


                reasons.push(
                    "Located in your preferred area"
                );


            }








            // =================================
            // Price Range Matching
            // Weight:20
            // =================================


            if(

                priceRange

                &&

                restaurant.priceRange

                &&

                restaurant.priceRange
                ===
                priceRange

            ){


                score +=20;


                reasons.push(
                    "Matches your budget"
                );


            }







            // =================================
            // Rating
            // Only display
            // =================================


            const rating =

                ratingMap[
                    restaurant._id.toString()
                ]

                ||

                restaurant.rating

                ||

                0;







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



                rating,



                score,



                reason:
                reasons


            };


        });








        // =====================================
        // 6. Sort Score
        // =====================================


        recommendationList.sort(

            (a,b)=>

                b.score - a.score

        );







        // =====================================
        // 7. Return Top 10
        // =====================================


        const result =

            recommendationList
            .slice(0,10);







        return res.json({

            message:
            "Recommendation success",


            algorithm:
            "Taste + Area + Price based scoring",



            data:
            result


        });




    }



    catch(error){


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
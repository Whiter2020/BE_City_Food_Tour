const RestaurantRequest = require("../models/RestaurantRequest");
const Restaurant = require("../models/Restaurant");


// =======================================
// USER CREATE RESTAURANT REQUEST
// POST /api/restaurant-requests
// =======================================
exports.createRestaurantRequest = async (req, res) => {

    try {

        const userId = req.user.id;


        const {
            name,
            address,
            cuisine,
            image,
            description

        } = req.body;



        if (!name || !address || !cuisine) {

            return res.status(400).json({
                message:
                    "Name, address and cuisine are required"
            });

        }



        const request =
            await RestaurantRequest.create({

                user: userId,

                name,
                address,
                cuisine,
                image,
                description,

                status:"Pending"

            });



        res.status(201).json({

            message:
                "Restaurant request submitted",

            request

        });



    } catch(err){


        console.error(
            "Create restaurant request error:",
            err
        );


        res.status(500).json({

            message:"Server error"

        });


    }

};





// =======================================
// USER GET OWN REQUESTS
// GET /api/restaurant-requests/my
// =======================================
exports.getMyRestaurantRequests = async(req,res)=>{


    try {


        const userId = req.user.id;



        const requests =
            await RestaurantRequest
                .find({
                    user:userId
                })
                .sort({
                    createdAt:-1
                });



        res.json(requests);



    } catch(err){


        console.error(
            "Get my restaurant requests error:",
            err
        );


        res.status(500).json({

            message:"Server error"

        });


    }

};





// =======================================
// ADMIN GET ALL REQUESTS
// GET /api/restaurant-requests
// =======================================
exports.getAllRestaurantRequests = async(req,res)=>{


    try {


        const requests =
            await RestaurantRequest
                .find()
                .populate(
                    "user",
                    "username email phone"
                )
                .sort({
                    createdAt:-1
                });



        res.json(requests);



    } catch(err){


        console.error(
            "Get all restaurant requests error:",
            err
        );


        res.status(500).json({

            message:"Server error"

        });


    }

};





// =======================================
// ADMIN APPROVE REQUEST
// PATCH /api/restaurant-requests/:id/approve
// =======================================
exports.approveRestaurantRequest = async(req,res)=>{


    try {


        const request =
            await RestaurantRequest.findById(
                req.params.id
            );



        if(!request){

            return res.status(404).json({

                message:"Request not found"

            });

        }



        // Không cho approve lại
        if(request.status !== "Pending"){

            return res.status(400).json({

                message:
                "Request has already been processed"

            });

        }



        // Tạo restaurant thật
        const restaurant =
            await Restaurant.create({

                name:
                    request.name,


                address:
                    request.address,


                cuisine:
                    request.cuisine,


                image:
                    request.image,


                description:
                    request.description,


                owner:
                    request.user

            });





        // Update request
        request.status = "Approved";

        await request.save();





        res.json({

            message:
                "Restaurant request approved",

            restaurant,

            request

        });



    } catch(err){


        console.error(
            "Approve request error:",
            err
        );


        res.status(500).json({

            message:"Server error"

        });


    }

};





// =======================================
// ADMIN REJECT REQUEST
// PATCH /api/restaurant-requests/:id/reject
// =======================================
exports.rejectRestaurantRequest = async(req,res)=>{


    try {


        const {
            adminNote

        } = req.body;




        const request =
            await RestaurantRequest.findById(
                req.params.id
            );



        if(!request){

            return res.status(404).json({

                message:"Request not found"

            });

        }




        request.status="Rejected";


        request.adminNote =
            adminNote || null;



        await request.save();





        res.json({

            message:
                "Restaurant request rejected",

            request

        });




    } catch(err){


        console.error(
            "Reject request error:",
            err
        );


        res.status(500).json({

            message:"Server error"

        });


    }

};
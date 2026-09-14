const User = require("../models/User");


// ===============================
// ADMIN GET ALL USERS
// ===============================

exports.getAllUsers = async (req, res) => {

    try {

        const users = await User.find()
            .select(
                "email username role createdAt isLocked"
            );


        res.json(users);


    } catch(err){

        console.error(err);

        res.status(500)
        .json({
            message:"Error fetching users"
        });

    }

};




// ===============================
// DELETE USER
// ===============================

exports.deleteUser = async(req,res)=>{

    try{


        if(req.user.id === req.params.id){

            return res.status(400)
            .json({
                message:"You cannot delete your own account"
            });

        }



        const target =
            await User.findById(req.params.id)
            .select("role");



        if(!target){

            return res.status(404)
            .json({
                message:"User not found"
            });

        }



        if(target.role==="admin"){

            return res.status(400)
            .json({
                message:"Admin accounts cannot be deleted"
            });

        }



        await User.findByIdAndDelete(
            req.params.id
        );


        res.json({
            message:"User deleted"
        });



    }catch(err){

        console.error(err);

        res.status(500)
        .json({
            message:"Error deleting user"
        });

    }

};





// ===============================
// LOCK USER
// ===============================

exports.lockUser = async(req,res)=>{

try{


const updated =
await User.findByIdAndUpdate(
    req.params.id,
    {
        isLocked:true
    },
    {
        new:true
    }
)
.select(
"email username role createdAt isLocked"
);



res.json(updated);



}catch(err){

console.error(err);

res.status(500)
.json({
message:"Error locking user"
});

}


};





// ===============================
// UNLOCK USER
// ===============================

exports.unlockUser = async(req,res)=>{

try{


const updated =
await User.findByIdAndUpdate(
    req.params.id,
    {
        isLocked:false
    },
    {
        new:true
    }
)
.select(
"email username role createdAt isLocked"
);



res.json(updated);



}catch(err){

console.error(err);

res.status(500)
.json({
message:"Error unlocking user"
});

}


};






// ===============================
// GET CURRENT USER PROFILE
// ===============================

exports.getMe = async(req,res)=>{


try{


const user =
await User.findById(
    req.user.id
)
.select(
`
email
username
phone
avatar
favorites
taste_profile
search_history
viewed_restaurants
liked_restaurants
role
createdAt
`
);



if(!user){

return res.status(404)
.json({
message:"User not found"
});

}



res.json(user);



}catch(err){

console.error(err);


res.status(500)
.json({
message:"Error get profile"
});


}


};






// ===============================
// ADD FAVORITE
// Đồng thời lưu liked_restaurants
// cho recommendation
// ===============================

exports.addFavorite = async(req,res)=>{


try{


const userId=req.user.id;

const rid=Number(req.body.rid);



if(Number.isNaN(rid)){

return res.status(400)
.json({
message:"Invalid restaurant id"
});

}




const user =
await User.findByIdAndUpdate(

userId,

{

$addToSet:{

favorites:rid,


liked_restaurants:{

restaurant_id:rid

}

}

},

{
new:true
}

)
.select(
"favorites liked_restaurants"
);



res.json(user);



}catch(err){

console.error(err);


res.status(500)
.json({
message:"Error adding favorite"
});


}


};







// ===============================
// REMOVE FAVORITE
// ===============================

exports.removeFavorite = async(req,res)=>{


try{


const userId=req.user.id;

const rid=Number(req.params.rid);



const user =
await User.findByIdAndUpdate(

userId,

{

$pull:{

favorites:rid,

liked_restaurants:{
restaurant_id:rid
}

}

},

{
new:true
}

)
.select(
"favorites liked_restaurants"
);



res.json(user);



}catch(err){

console.error(err);


res.status(500)
.json({
message:"Error removing favorite"
});


}


};







// ===============================
// UPDATE PROFILE
// ===============================

exports.updateMe = async(req,res)=>{


try{


const {
username,
phone,
avatar,
taste_profile

}=req.body;



const updated =
await User.findByIdAndUpdate(

req.user.id,


{

...(username!==undefined && {
username
}),


...(phone!==undefined && {
phone
}),


...(avatar!==undefined && {
avatar
}),



...(taste_profile!==undefined && {

taste_profile:
Array.isArray(taste_profile)
?
taste_profile
:
["Any"]

})

},


{
new:true
}

)
.select(
`
email
username
phone
avatar
taste_profile
favorites
role
createdAt
`
);



res.json(updated);



}catch(err){

console.error(err);


res.status(500)
.json({
message:"Error updating profile"
});


}


};








// ===============================
// SAVE VIEWED RESTAURANT
// ===============================

exports.addViewedRestaurant = async(req,res)=>{


try{


const rid =
Number(req.body.rid);



if(Number.isNaN(rid)){

return res.status(400)
.json({
message:"Invalid restaurant id"
});

}



const user =
await User.findByIdAndUpdate(

req.user.id,


{

$push:{

viewed_restaurants:{

restaurant_id:rid

}

}

},


{
new:true
}

)
.select(
"viewed_restaurants"
);



res.json(user);



}catch(err){

console.error(err);


res.status(500)
.json({
message:"Error saving viewed restaurant"
});


}


};







// ===============================
// SAVE SEARCH HISTORY
// ===============================

exports.addSearchHistory = async(req,res)=>{


try{


const {
keyword
}=req.body;



if(!keyword){

return res.status(400)
.json({
message:"Keyword required"
});

}




const user =
await User.findByIdAndUpdate(

req.user.id,


{

$push:{

search_history:{

keyword

}

}

},


{
new:true
}

)
.select(
"search_history"
);



res.json(user);



}catch(err){

console.error(err);


res.status(500)
.json({
message:"Error saving search history"
});


}


};
const RestaurantRequest = require("../models/RestaurantRequest");
const Restaurant = require("../models/Restaurant");
const geoapify = require("../utils/geoapify");
const { normalizeCityCode, normalizeDistrictCode } = require("../utils/location");
const { formatAddress, isPostcode, toCoordinate, coordinatesFromFeature } = require("../utils/address");

const getDistrict = (properties = {}) => {
    const city = String(properties.city || properties.municipality || "").trim().toLowerCase();
    const postcode = String(properties.postcode || "").trim();
    const candidates = [properties.district, properties.city_district, properties.suburb, properties.neighbourhood, properties.neighborhood, properties.locality, properties.county];
    return candidates.map((value) => String(value || "").trim()).find((value) =>
        value && !isPostcode(value) && value !== postcode && value.toLowerCase() !== city
    ) || "";
};

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
            streetAddress,
            ward,
            district,
            districtCode,
            city,
            cityCode,
            country,
            lat,
            lng,
            cuisine,
            tags,
            amenities,
            image,
            description,
            openingTime,
            closingTime,
            dishes,

        } = req.body;



        const normalizedTags = Array.isArray(tags)
            ? [...new Set(tags.map((tag) => String(tag).trim()).filter(Boolean))]
            : [];
        const formattedAddress = formatAddress({ streetAddress, ward, district, city, country }) || String(address || "").trim();
        if (!name || !formattedAddress || !normalizedTags.length) {

            return res.status(400).json({
                message:
                    "Name, address and at least one tag are required"
            });

        }
        if ((streetAddress || district || city || country) && (!streetAddress?.trim() || !district?.trim() || !city?.trim() || !country?.trim())) {
            return res.status(400).json({ message: "Street address, district/area, city, and country are required." });
        }



        const request =
            await RestaurantRequest.create({

                user: userId,

                name,
                address: formattedAddress,
                streetAddress: String(streetAddress || "").trim(),
                ward: String(ward || "").trim(),
                district: isPostcode(district) ? "" : String(district || "").trim(),
                districtCode: isPostcode(districtCode) ? "" : normalizeDistrictCode(districtCode || district),
                city: String(city || "").trim(),
                cityCode: normalizeCityCode(city || cityCode || "ho-chi-minh"),
                country: String(country || "").trim(),
                lat: toCoordinate(lat, -90, 90),
                lng: toCoordinate(lng, -180, 180),
                openingTime: String(openingTime || "").trim(),
                closingTime: String(closingTime || "").trim(),
                dishes: Array.isArray(dishes) ? dishes
                    .filter((dish) => dish && String(dish.name || "").trim())
                    .map((dish) => ({
                        name: String(dish.name).trim(),
                        price: String(dish.price || "").trim(),
                        image: String(dish.image || "").trim(),
                    })) : [],
                // Retain the legacy field only for old clients; tags are the
                // sole classification source for search, planning, and ranking.
                cuisine: String(cuisine || "").trim(),
                tags: normalizedTags,
                amenities: Array.isArray(amenities)
                    ? [...new Set(amenities.map((amenity) => String(amenity).trim()).filter(Boolean))]
                    : [],
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



        // Older/manual requests may not have coordinates. Geocode only when needed.
        let resolvedLat = request.lat;
        let resolvedLng = request.lng;
        let locationProperties = {};
        if (!Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLng)) {
            const requestAddress = formatAddress(request) || request.address;
            const feature = await geoapify.geocode(requestAddress);
            const coordinates = coordinatesFromFeature(feature);
            locationProperties = feature?.properties || {};
            resolvedLat = coordinates.lat;
            resolvedLng = coordinates.lng;
        }

        if (!Number.isFinite(resolvedLat) || !Number.isFinite(resolvedLng)) {
            return res.status(422).json({
                message: "Could not locate this address. Please review the street, district, city, and country before approving.",
            });
        }

        let resolvedDistrict = !isPostcode(request.district) ? request.district : "";
        resolvedDistrict = resolvedDistrict || getDistrict(locationProperties);
        if (!resolvedDistrict && Number.isFinite(resolvedLat) && Number.isFinite(resolvedLng)) {
            const reverseFeature = await geoapify.reverseGeocode(resolvedLat, resolvedLng);
            locationProperties = reverseFeature?.properties || locationProperties;
            resolvedDistrict = getDistrict(locationProperties);
        }
        const resolvedCityCode = normalizeCityCode(request.city || request.cityCode || locationProperties.city || locationProperties.municipality || locationProperties.state || "ho-chi-minh");
        const requestedDistrictCode = isPostcode(request.districtCode) ? "" : request.districtCode;
        const resolvedDistrictCode = normalizeDistrictCode(requestedDistrictCode || resolvedDistrict);

        // Tạo restaurant thật, preserving the full formatted address.
        const lastRestaurant = await Restaurant.findOne().sort({ id: -1 }).select("id");
        const nextId = lastRestaurant ? lastRestaurant.id + 1 : 1;
        const restaurant =
            await Restaurant.create({
                id: nextId,

                name:
                    request.name,


                address: formatAddress(request) || request.address,
                streetAddress: request.streetAddress || "",
                ward: request.ward || "",
                city: request.city || locationProperties.city || locationProperties.municipality || "",
                country: request.country || locationProperties.country || "",

                district: resolvedDistrict,
                districtCode: resolvedDistrictCode,
                cityCode: resolvedCityCode,
                lat: resolvedLat,
                lng: resolvedLng,


                image:
                    request.image,


                description:
                    request.description,

                openingTime: request.openingTime || "",
                closingTime: request.closingTime || "",
                dishes: (request.dishes || []).map((dish, index) => ({
                    id: index + 1,
                    name: dish.name,
                    price: dish.price || "",
                    image: dish.image || "",
                })),

                tags: [...new Set([
                    ...(request.tags || []),
                    // Requests created before this migration may only contain cuisine.
                    ...String(request.cuisine || "").split(",").map((tag) => tag.trim()).filter(Boolean)
                ])],

                amenities: request.amenities || [],


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

        if(request.status !== "Pending"){
            return res.status(400).json({
                message: "Request has already been processed"
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

const axios = require('axios');

const GEOAPIFY_API_KEY = process.env.GEOAPIFY_API_KEY;

if (!GEOAPIFY_API_KEY) {
  console.warn("⚠️ GEOAPIFY_API_KEY is missing in .env");
}

// Geocoding (chuyển địa chỉ thành tọa độ)
const geocode = async (address) => {
  try {
    const response = await axios.get('https://api.geoapify.com/v1/geocode/search', {
      params: {
        text: address,
        apiKey: GEOAPIFY_API_KEY,
        limit: 1
      }
    });
    return response.data.features[0] || null;
  } catch (error) {
    console.error("Geoapify Geocode Error:", error.message);
    return null;
  }
};

// Routing (tính đường đi giữa nhiều điểm)
const calculateRoute = async (waypoints, mode = "drive") => {
  try {
    const waypointString = waypoints.map(w => `${w.lat},${w.lon}`).join('|');
    
    const response = await axios.get('https://api.geoapify.com/v1/routing', {
      params: {
        waypoints: waypointString,
        mode: mode,           // drive, walk, bicycle...
        apiKey: GEOAPIFY_API_KEY
      }
    });
    return response.data;
  } catch (error) {
    console.error("Geoapify Routing Error:", error.message);
    throw error;
  }
};

module.exports = {
  geocode,
  calculateRoute,
};
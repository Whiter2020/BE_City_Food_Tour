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
        limit: 1,
      },
      timeout: 8000,
    });
    return response.data.features[0] || null;
  } catch (error) {
    console.error("Geoapify Geocode Error:", error.message);
    return null;
  }
};

const reverseGeocode = async (lat, lon) => {
  try {
    const response = await axios.get('https://api.geoapify.com/v1/geocode/reverse', {
      params: { lat, lon, apiKey: GEOAPIFY_API_KEY, limit: 1 },
      timeout: 8000,
    });
    return response.data.features?.[0] || null;
  } catch (error) {
    console.error('Geoapify Reverse Geocode Error:', error.message);
    return null;
  }
};

const autocomplete = async (query) => {
  if (!GEOAPIFY_API_KEY) return [];
  const response = await axios.get('https://api.geoapify.com/v1/geocode/autocomplete', {
    params: {
      text: query,
      apiKey: GEOAPIFY_API_KEY,
      limit: 6,
    },
    timeout: 8000,
  });
  return response.data.features || [];
};

// Routing (tính đường đi giữa nhiều điểm)
const calculateRoute = async (waypoints, mode = "drive", options = {}) => {
  try {
    const waypointString = waypoints.map(w => `${w.lat},${w.lon}`).join('|');
    
    const response = await axios.get('https://api.geoapify.com/v1/routing', {
      params: {
        waypoints: waypointString,
        mode: mode,           // drive, walk, bicycle...
        apiKey: GEOAPIFY_API_KEY,
        ...options,
      }
    });
    return response.data;
  } catch (error) {
    console.error("Geoapify Routing Error:", error.message);
    throw error;
  }
};

// Builds a road-network distance/time matrix for route-order optimization.
const calculateRouteMatrix = async (waypoints, mode = "drive") => {
  try {
    const locations = waypoints.map((waypoint) => ({
      location: [waypoint.lon, waypoint.lat],
    }));

    const response = await axios.post(
      "https://api.geoapify.com/v1/routematrix",
      {
        mode,
        sources: locations,
        targets: locations,
      },
      {
        params: { apiKey: GEOAPIFY_API_KEY },
        headers: { "Content-Type": "application/json" },
      },
    );

    return response.data;
  } catch (error) {
    console.error("Geoapify Route Matrix Error:", error.message);
    throw error;
  }
};

module.exports = {
  geocode,
  reverseGeocode,
  autocomplete,
  calculateRoute,
  calculateRouteMatrix,
};

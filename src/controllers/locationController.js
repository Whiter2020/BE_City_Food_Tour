const geoapify = require('../utils/geoapify');
const { normalizeCityCode, normalizeDistrictCode } = require('../utils/location');

const isPostcode = (value) => /^\d{4,10}(?:-\d{3,4})?$/.test(String(value || '').trim());

const getDistrict = (properties) => {
  const city = String(properties.city || properties.municipality || '').trim().toLowerCase();
  const postcode = String(properties.postcode || '').trim();
  const candidates = [properties.district, properties.city_district, properties.suburb, properties.neighbourhood, properties.neighborhood, properties.locality, properties.county];
  return candidates.map((value) => String(value || '').trim()).find((value) =>
    value && !isPostcode(value) && value !== postcode && value.toLowerCase() !== city
  ) || '';
};

exports.getAddressSuggestions = async (req, res) => {
  const query = String(req.query.q || '').trim();
  if (query.length < 3 || query.length > 150) {
    return res.json([]);
  }

  try {
    const features = await geoapify.autocomplete(query);
    const suggestions = features.map((feature) => {
      const properties = feature.properties || {};
      const district = getDistrict(properties);
      const city = properties.city || properties.municipality || '';
      return {
        formatted: properties.formatted || properties.address_line1 || query,
        lat: properties.lat,
        lon: properties.lon,
        street: properties.street || '',
        district,
        districtCode: normalizeDistrictCode(district),
        city,
        cityCode: city ? normalizeCityCode(city) : '',
        state: properties.state || '',
        country: properties.country || '',
      };
    }).filter((suggestion) => suggestion.formatted);

    return res.json(suggestions);
  } catch (error) {
    console.error('Address autocomplete error:', error.message);
    return res.status(502).json({ message: 'Address suggestions are temporarily unavailable.' });
  }
};

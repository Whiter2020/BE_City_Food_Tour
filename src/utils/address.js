const formatAddress = ({ streetAddress, ward, district, city, country } = {}) =>
  [streetAddress, ward, district, city, country]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(", ");

const isPostcode = (value) => /^\d{4,10}(?:-\d{3,4})?$/.test(String(value || "").trim());

const toCoordinate = (value, min, max) => {
  if (value === null || value === undefined || value === "") return null;
  const coordinate = Number(value);
  return Number.isFinite(coordinate) && coordinate >= min && coordinate <= max ? coordinate : null;
};

const coordinatesFromFeature = (feature) => {
  const [lng, lat] = feature?.geometry?.coordinates || [];
  return {
    lat: toCoordinate(lat, -90, 90),
    lng: toCoordinate(lng, -180, 180),
  };
};

module.exports = { formatAddress, isPostcode, toCoordinate, coordinatesFromFeature };

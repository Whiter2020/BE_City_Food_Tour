const slugify = (value) => String(value || "")
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[đĐ]/g, "d")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/(^-|-$)/g, "");

const normalizeCityCode = (value) => {
  const raw = slugify(value);
  const aliases = {
    "ho-chi-minh": "ho-chi-minh",
    "ho-chi-minh-city": "ho-chi-minh",
    "tp-hcm": "ho-chi-minh",
    "tphcm": "ho-chi-minh",
    hcmc: "ho-chi-minh",
    hanoi: "ha-noi",
    "ha-noi": "ha-noi",
    "da-nang": "da-nang",
  };
  return aliases[raw] || raw;
};

const normalizeDistrictCode = (value) => {
  const raw = slugify(value)
    .replace(/-(ho-chi-minh|ho-chi-minh-city|tp-hcm|tphcm|hcmc|ha-noi|hanoi|da-nang)$/, "")
    .replace(/^quan-(\d+)$/, "district-$1")
    .replace(/^q-(\d+)$/, "district-$1")
    .replace(/^thu-duc-city$/, "thu-duc");
  return raw;
};

module.exports = { normalizeCityCode, normalizeDistrictCode };

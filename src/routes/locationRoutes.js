const express = require('express');
const { getAddressSuggestions } = require('../controllers/locationController');

const router = express.Router();

router.get('/autocomplete', getAddressSuggestions);

module.exports = router;

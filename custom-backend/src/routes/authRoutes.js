const express = require('express');
const { login, logout, register } = require('../controllers/authController');
const { authenticate } = require('../middleware/authenticate');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.post('/logout', authenticate, logout);

module.exports = router;

'use strict';

const express = require('express');
const { handleLogin, handleLogout, handleAuthStatus } = require('../auth');

const router = express.Router();

router.post('/login',  handleLogin);
router.post('/logout', handleLogout);
router.get('/auth',    handleAuthStatus);

module.exports = router;

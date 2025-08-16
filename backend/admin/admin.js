const router = require('express').Router();
const session = require("express-session");
const cookieParser = require("cookie-parser");
const Keyv = require("keyv").default;
require("dotenv").config();
// Prepare admin emails array
const adminEmails = (process.env.ADMIN_USERS || "").split(",").map(e => e.trim().toLowerCase());
const isAdmin = email ? adminEmails.includes(email.toLowerCase()) : false;
module.exports = router;

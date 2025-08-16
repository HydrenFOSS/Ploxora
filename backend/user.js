const router = require('express').Router();
const session = require("express-session");
const cookieParser = require("cookie-parser");
const Keyv = require("keyv");
require("dotenv").config();

// Keyv instances (persisted in SQLite by default, but no tables needed)
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv(process.env.SESSIONS_DB || 'sqlite://sessions.sqlite');

users.on('error', err => console.error('Users DB Error', err));
sessions.on('error', err => console.error('Sessions DB Error', err));

// Middleware
router.use(cookieParser());
router.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true },
}));

// Login page
router.get("/", (req, res) => {
  const token = req.cookies["SESSION-COOKIE"];
  if (token) return res.redirect('/dashboard');

  const name = process.env.APP_NAME;
  res.render("login", { error: req.query.err || "", name });
});

module.exports = router;

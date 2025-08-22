const router = require('express').Router();
const session = require("express-session");
const cookieParser = require("cookie-parser");
const Keyv = require("keyv");
require("dotenv").config();
const Logger = require("../utilities/logger");
const settings = new Keyv(process.env.SETTINGS_DB || "sqlite://settings.sqlite");
const logger = new Logger({ prefix: "Ploxora", level: "debug" });
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv(process.env.SESSIONS_DB || 'sqlite://sessions.sqlite');

async function requireLogin(req, res, next) {
  try {
    const token = req.cookies["SESSION-COOKIE"];
    if (!token) return res.redirect("/?err=LOGIN-IN-FIRST");

    const userId = await sessions.get(token);
    if (!userId) {
      res.clearCookie("SESSION-COOKIE");
      return res.redirect("/?err=LOGIN-IN-FIRST");
    }

    const user = await users.get(userId);
    if (!user) {
      res.clearCookie("SESSION-COOKIE");
      return res.redirect("/?err=NO-USER");
    }

    req.user = user; // attach user for later
    next();
  } catch (err) {
    logger.error("Auth error:", err);
    res.redirect("/?err=AUTH-FAILED");
  }
}
async function getAppName() {
  const appName = await settings.get("NAME");
  return appName;
}
users.on('error', err => logger.error('Users DB Error', err));
sessions.on('error', err => logger.error('Sessions DB Error', err));

// Middleware
router.use(cookieParser());
router.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true },
}));

// Login page
router.get("/", async (req, res) => {
  const token = req.cookies["SESSION-COOKIE"];
  if (token) return res.redirect('/dashboard');

  const name = await getAppName();
  res.render("login", { error: req.query.err || "", name });
});

router.get('/settings', requireLogin, async (req, res) => {
  const token = req.cookies["SESSION-COOKIE"];
  const userId = await sessions.get(token);
  const user = await users.get(userId);
  res.render("settings", { user, name: await getAppName() })
});

// Delete account (unlink from your app, not Discord itself)
router.post('/settings/delete-account', requireLogin, async (req, res) => {
  try {
    const user = req.user;

    // remove user and session
    await users.delete(user.id);

    const token = req.cookies["SESSION-COOKIE"];
    if (token) await sessions.delete(token);

    res.clearCookie("SESSION-COOKIE");
    res.redirect('/?msg=ACCOUNT_DELETED');
  } catch (err) {
    logger.error("Delete account error:", err);
    res.redirect('/settings?err=DELETE_FAILED');
  }
});
module.exports = router;

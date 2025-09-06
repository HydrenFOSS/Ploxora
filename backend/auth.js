/*
|--------------------------------------------------------------------------
| Ploxora Authentication Routes
| Author: ma4z
| Version: v1
|--------------------------------------------------------------------------
| This file handles user authentication and account management:
| - Discord OAuth2 login
| - Local login & registration
| - Session handling
| - Logout
|--------------------------------------------------------------------------
*/
const express = require("express");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const session = require("express-session");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
require("dotenv").config();
const Logger = require("../utilities/logger");
const logger = new Logger({ prefix: "Ploxora-Auth-Router", level: "debug" });
const router = express.Router();
const bcrypt = require("bcrypt");

const SESSION_TTL = 1000 * 60 * 60 * 24; // 24h TTL
const { nodes, servers, settings, users, sessions } = require('../utilities/db');

users.on('error', err => logger.error('Users DB Error', err));
sessions.on('error', err => logger.error('Sessions DB Error', err));

// Prepare admin emails array
const adminEmails = (process.env.ADMIN_USERS || "").split(",").map(e => e.trim().toLowerCase());
async function getAppName() {
  const appName = await settings.get("NAME");
  return appName;
}
function uuid() {
  const bytes = crypto.randomBytes(16);

  // UUID v4 layout
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = bytes.toString("hex");

  return (
    hex.slice(0, 8) + "-" +
    hex.slice(8, 12) + "-" +
    hex.slice(12, 16) + "-" +
    hex.slice(16, 20) + "-" +
    hex.slice(20)
  );
}
passport.use(
  new DiscordStrategy(
    {
      clientID: process.env.DISCORD_CLIENT_ID,
      clientSecret: process.env.DISCORD_CLIENT_SECRET,
      callbackURL: process.env.DISCORD_CALLBACK_URL || "/auth/discord/callback",
      scope: ["identify", "email"],
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        const { id, username, email, avatar } = profile;

        const existingUser = await users.get(id);

        const isAdmin = email ? adminEmails.includes(email.toLowerCase()) : false;

        const userData = {
          id,
          username,
          email: email || existingUser?.email || "",
          profilePicture: avatar
            ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`
            : existingUser?.profilePicture
            || `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(username)}`,
          admin: isAdmin,
          servers: existingUser?.servers || {},
        };


        await users.set(id, userData);

        const token = uuid();
        await sessions.set(token, id);

        done(null, { id, token, username });
      } catch (err) {
        done(err, null);
      }
    }
  )
);

// Middleware
router.use(cookieParser());
router.use(session({
  secret: process.env.SESSION_SECRET || "supersecret",
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true },
}));
router.use(passport.initialize());
router.use(passport.session());

// Passport serialize/deserialize
passport.serializeUser((user, done) => done(null, user.token));
passport.deserializeUser(async (token, done) => {
  try {
    const userId = await sessions.get(token);
    if (!userId) return done(null, false);
    const user = await users.get(userId);
    done(null, user);
  } catch (err) {
    done(err, null);
  }
});

/*
* Route: GET /
* Description: Render login page. If a valid session exists, redirect to dashboard.
* Query: ?err (optional error message)
* Version: v1.0.0
*/
router.get("/", async (req, res) => {
  const token = req.cookies["SESSION-COOKIE"];
  if (token) {
    const userId = await sessions.get(token);
    if (userId) return res.redirect('/dashboard');
    else res.clearCookie("SESSION-COOKIE"); // remove invalid cookie
  }
  const name = await getAppName();
  res.render("login", { error: req.query.err || "", name, rgenabled: settings.registerEnabled });
});

/*
* Route: GET /auth/discord
* Description: Redirect user to Discord for authentication.
* Version: v1.0.0
*/
router.get("/auth/discord", passport.authenticate("discord"));

/*
* Route: GET /auth/discord/callback
* Description: Discord OAuth2 callback. Validates user, checks ban status, creates session.
* Redirects: /dashboard (on success), / (on failure).
* Version: v1.0.0
*/
router.get("/auth/discord/callback",
  passport.authenticate("discord", { failureRedirect: "/" }),
  async (req, res) => {
    const user = req.user;
    if (!user || !user.token) return res.redirect("/");
     // Fetch full user object from DB
    const fullUser = await users.get(user.id);
    if (!fullUser) return res.redirect("/?err=NO-USER");

    // Check if banned
    if (fullUser.banned) {
      res.clearCookie("SESSION-COOKIE");
      return res.redirect("/?err=USER_BANNED");
    }
    req.user = fullUser;
    res.cookie("SESSION-COOKIE", user.token, { httpOnly: true, maxAge: SESSION_TTL });
    res.redirect("/dashboard");
  }
);

/*
* Route: GET /logout
* Description: Destroy session, clear cookie, logout user, and redirect to login.
* Version: v1.0.0
*/
router.get("/logout", async (req, res) => {
  try {
    const token = req.cookies["SESSION-COOKIE"];
    if (token) await sessions.delete(token);

    res.clearCookie("SESSION-COOKIE", { httpOnly: true });
    req.logout(() => { });
    res.redirect("/");
  } catch (err) {
    logger.error(err);
    res.status(500).send("Error logging out " + err);
  }
});
/*
* Route: GET /register
* Description: Render registration page.
* Query: ?err (optional error message)
* Version: v1.0.0
*/
router.get("/register", async (req, res) => {
  if (!settings.registerEnabled) {
    return res.redirect('/')
  }
  const name = await getAppName();
  res.render("register", { error: req.query.err || "", name });
});

/*
* Route: POST /register
* Description: Register a new user with username, email, and password.
* Body: { username, email, password }
* Validations: Checks for existing email, hashes password, sets admin if email in ADMIN_USERS.
* Redirects: /dashboard (on success), /register?err=... (on failure).
* Version: v1.0.0
*/

router.post("/register", async (req, res) => {
  if (!settings.registerEnabled) {
    return res.redirect('/')
  }
  try {
    const { username, email, password } = req.body;
    if (!username || !email || !password) {
      return res.redirect("/register?err=Missing fields");
    }

    // Check if email already exists
    for await (const [id, user] of users.iterator()) {
      if (user.email && user.email.toLowerCase() === email.toLowerCase()) {
        return res.redirect("/register?err=Email already registered");
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const id = uuid();

    const isAdmin = adminEmails.includes(email.toLowerCase());

    const newUser = {
      id,
      username,
      email,
      password: hashedPassword, // store hash
      profilePicture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(username)}`,
      admin: isAdmin,
      servers: {},
    };

    await users.set(id, newUser);

    const token = uuid();
    await sessions.set(token, id);

    res.cookie("SESSION-COOKIE", token, { httpOnly: true, maxAge: SESSION_TTL });
    res.redirect("/dashboard");
  } catch (err) {
    logger.error("Register error", err);
    res.redirect("/register?err=Error registering user");
  }
});

/*
* Route: POST /login
* Description: Authenticate a user with email and password.
* Body: { email, password }
* Validations: Check password, check ban status, assign admin if email matches ADMIN_USERS.
* Redirects: /dashboard (on success), /?err=... (on failure).
* Version: v1.0.0
*/
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.redirect("/login?err=Missing fields");

    let foundUser = null;
    for await (const [id, user] of users.iterator()) {
      if (user.email && user.email.toLowerCase() === email.toLowerCase()) {
        foundUser = { ...user }; // <-- create a fresh copy, do NOT mutate original
        break;
      }
    }

    if (!foundUser) return res.redirect("/?err=Invalid credentials");

    const match = await bcrypt.compare(password, foundUser.password || "");
    if (!match) return res.redirect("/?err=Invalid credentials");

    // Always re-check admin based on env
    foundUser.admin = adminEmails.includes(foundUser.email.toLowerCase());
    if (foundUser.banned) return res.redirect("/?err=USER_BANNED");

    // Only set profile picture if empty
    if (!foundUser.profilePicture || foundUser.profilePicture === "") {
      foundUser.profilePicture = `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(foundUser.username)}`;
    }

    // Save updated user individually
    await users.set(foundUser.id, foundUser);
    req.user = foundUser;

    const token = uuid();
    await sessions.set(token, foundUser.id);

    res.cookie("SESSION-COOKIE", token, { httpOnly: true, maxAge: SESSION_TTL });
    res.redirect("/dashboard");

  } catch (err) {
    logger.error("Login error", err);
    res.redirect("/login?err=Error logging in");
  }
});

const ploxora_route = "Authentication | Author: ma4z | V1"
module.exports = { router,ploxora_route };

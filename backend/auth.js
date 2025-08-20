const express = require("express");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const session = require("express-session");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const Keyv = require("keyv");
require("dotenv").config();
const Logger = require("../utilities/logger");
const logger = new Logger({ prefix: "Ploxora", level: "debug" });
const router = express.Router();
const bcrypt = require("bcrypt");

// Keyv instances for users and sessions
const SESSION_TTL = 1000 * 60 * 60 * 24; // 24h TTL
const nodes = new Keyv(process.env.NODES_DB || "sqlite://nodes.sqlite");
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv({ uri: process.env.SESSIONS_DB || 'sqlite://sessions.sqlite', ttl: SESSION_TTL });

users.on('error', err => logger.error('Users DB Error', err));
sessions.on('error', err => logger.error('Sessions DB Error', err));

// Prepare admin emails array
const adminEmails = (process.env.ADMIN_USERS || "").split(",").map(e => e.trim().toLowerCase());

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

// Login page
router.get("/", async (req, res) => {
  const token = req.cookies["SESSION-COOKIE"];
  if (token) {
    const userId = await sessions.get(token);
    if (userId) return res.redirect('/dashboard');
    else res.clearCookie("SESSION-COOKIE"); // remove invalid cookie
  }
  const name = process.env.APP_NAME;
  res.render("login", { error: req.query.err || "", name });
});

// Dashboard page
router.get("/dashboard", async (req, res) => {
  const token = req.cookies["SESSION-COOKIE"];
  if (!token) return res.redirect("/?err=LOGIN-IN-FIRST");
  let count = 0;
  for await (const _ of nodes.iterator()) {
    count++;
  }
  const userId = await sessions.get(token);
  if (!userId) {
    res.clearCookie("SESSION-COOKIE");
    return res.redirect("/?err=LOGIN-IN-FIRST");
  }

  const user = await users.get(userId);
  if (!user) {
    res.clearCookie("SESSION-COOKIE");
    return res.redirect("/?err=LOGIN-IN-FIRST");
  }

  const name = process.env.APP_NAME;
  res.render('dashboard', { user, name, nodes: count });
});

// Discord auth routes
router.get("/auth/discord", passport.authenticate("discord"));
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

    res.cookie("SESSION-COOKIE", user.token, { httpOnly: true, maxAge: SESSION_TTL });
    res.redirect("/dashboard");
  }
);

// Logout
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
router.get("/register", (req, res) => {
  const name = process.env.APP_NAME;
  res.render("register", { error: req.query.err || "", name });
});

router.post("/register", async (req, res) => {
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

// Login route
router.get("/login", (req, res) => {
  const name = process.env.APP_NAME;
  res.render("login", { error: req.query.err || "", name });
});

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

    if (!foundUser) return res.redirect("/login?err=Invalid credentials");

    const match = await bcrypt.compare(password, foundUser.password || "");
    if (!match) return res.redirect("/login?err=Invalid credentials");

    // Always re-check admin based on env
    foundUser.admin = adminEmails.includes(foundUser.email.toLowerCase());
    if (foundUser.banned) return res.redirect("/?err=USER_BANNED");

    // Only set profile picture if empty
    if (!foundUser.profilePicture || foundUser.profilePicture === "") {
      foundUser.profilePicture = `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(foundUser.username)}`;
    }

    // Save updated user individually
    await users.set(foundUser.id, foundUser);

    const token = uuid();
    await sessions.set(token, foundUser.id);

    res.cookie("SESSION-COOKIE", token, { httpOnly: true, maxAge: SESSION_TTL });
    res.redirect("/dashboard");

  } catch (err) {
    logger.error("Login error", err);
    res.redirect("/login?err=Error logging in");
  }
});

module.exports = router;

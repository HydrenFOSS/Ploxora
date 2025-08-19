const express = require("express");
const passport = require("passport");
const DiscordStrategy = require("passport-discord").Strategy;
const session = require("express-session");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
const Keyv = require("keyv");
require("dotenv").config();
const Catloggr = require("cat-loggr");
const logger = new Catloggr({ prefix: "Ploxora" });
const router = express.Router();

// Keyv instances for users and sessions
const SESSION_TTL = 1000 * 60 * 60 * 24; // 24h TTL
const nodes = new Keyv(process.env.NODES_DB || "sqlite://nodes.sqlite");
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv({ uri: process.env.SESSIONS_DB || 'sqlite://sessions.sqlite', ttl: SESSION_TTL });

users.on('error', err => logger.error('Users DB Error', err));
sessions.on('error', err => logger.error('Sessions DB Error', err));

// Prepare admin emails array
const adminEmails = (process.env.ADMIN_USERS || "").split(",").map(e => e.trim().toLowerCase());

// Passport Discord setup
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

        const isAdmin = email ? adminEmails.includes(email.toLowerCase()) : false;

        const userData = {
          id,
          username,
          email: email || "",
          profilePicture: avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png` : "",
          admin: isAdmin,
          servers: {},
        };

        await users.set(id, userData);

        const token = crypto.randomBytes(32).toString("hex");
        await sessions.set(token, id); // will auto-expire after TTL

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
    req.logout(() => {});
    res.redirect("/");
  } catch (err) {
    logger.error(err);
    res.status(500).send("Error logging out " + err);
  }
});

module.exports = router;

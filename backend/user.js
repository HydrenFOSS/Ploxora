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
const nodes = new Keyv(process.env.NODES_DB || 'sqlite://nodes.sqlite');

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

  const name = await getAppName();
  res.render('dashboard', { user, name, nodes: count });
});

router.get("/server/stats/:containerId", requireLogin, async (req, res) => {
  const { containerId } = req.params;
  const q = req.user;

  try {
    const user = await users.get(q.id);
    if (!user) {
      return res.status(403).json({ error: "User not found" });
    }

    const server = user.servers?.find(s => s.containerId === containerId);
    if (!server) {
      return res.status(403).json({ error: "Not allowed" });
    }

    const node = await nodes.get(server.node);
    if (!node) {
      return res.status(500).json({ error: "Node not found" });
    }

    // fetch returns a Response object, you need to parse JSON
    const response = await fetch(
      `http://${node.address}:${node.port}/stats/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch from node" });
    }

    const data = await response.json(); // 👈 parse JSON
    res.json(data);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch stats", details: err.message });
  }
});

router.get("/vps/:containerId", requireLogin, async (req, res) => {
  try {
    const { containerId } = req.params;
    const user = req.user;
    const server = user.servers?.find(s => s.containerId === containerId);
    if (!server) {
      return res.status(403).send("You do not have access to this VPS.");
    }
    res.render("vps", { user, server, name: await getAppName() });
  } catch (err) {
    logger.error("VPS page error:", err);
    res.status(500).send("Failed to load VPS page.");
  }
});

module.exports = router;

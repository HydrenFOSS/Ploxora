const router = require('express').Router();
const session = require("express-session");
const cookieParser = require("cookie-parser");
const Keyv = require("keyv");
require("dotenv").config();
const Logger = require("../utilities/logger");
const settings = new Keyv(process.env.SETTINGS_DB || "sqlite://settings.sqlite");
const logger = new Logger({ prefix: "Ploxora-Users-Router", level: "debug" });
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv(process.env.SESSIONS_DB || 'sqlite://sessions.sqlite');
const nodes = new Keyv(process.env.NODES_DB || 'sqlite://nodes.sqlite');
const serversDB = new Keyv(process.env.SERVERS_DB || "sqlite://servers.sqlite");

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
async function getServerByContainerId(containerId) {
  for await (const [id, server] of serversDB.iterator()) {
    if (server.containerId === containerId) return { id, server };
  }
  return null;
}

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


// Generic VPS action route
router.post("/vps/action/:containerId/:action", requireLogin, async (req, res) => {
  try {
    const { containerId, action } = req.params;
    logger.info('I just need to execute a action called '+ action)
    const allowedActions = ["start", "stop", "restart"];

    if (!allowedActions.includes(action)) {
      return res.status(400).json({ error: "Invalid action. allowed is: start, stop, restart" });
    }

    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { id: serverId, server } = result;
    if (!req.user.servers?.some(s => s.id === serverId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const node = await nodes.get(server.node);
    if (!node) return res.status(500).json({ error: "Node not found" });

    const response = await fetch(
      `http://${node.address}:${node.port}/action/${action}/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`,
      { method: "POST" }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: "Node request failed", details: text });
    }

    res.json({ containerId, action, message: `Container ${action}ed successfully` });
  } catch (err) {
    logger.error("[VPS Action] error:", err);
    res.status(500).json({ error: "Failed to perform action", details: err.message });
  }
});

router.post("/vps/ressh/:containerId", requireLogin, async (req, res) => {
  try {
    const { containerId } = req.params;

    if (!containerId) return res.status(400).json({ error: "Missing containerId" });

    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { id: serverId, server } = result;

    if (!req.user.servers?.some(s => s.id === serverId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const node = await nodes.get(server.node);
    if (!node) return res.status(500).json({ error: "Node not found" });


    // Check container status
    const statusResp = await fetch(
      `http://${node.address}:${node.port}/stats/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`
    );
    if (!statusResp.ok) {
      const text = await statusResp.text();
      return res.status(statusResp.status).json({ error: "Failed to fetch container status", details: text });
    }

    const statusData = await statusResp.json();

    // Fetch SSH info safely
    let sshData = { ssh: "N/A" };
    try {
      const sshResp = await fetch(
        `http://${node.address}:${node.port}/ressh?x-verification-key=${encodeURIComponent(node.token)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ containerId }) }
      );

      if (!sshResp.ok) {
        const text = await sshResp.text();
        console.error("[Ressh] Node returned error:", sshResp.status, text);
        return res.status(sshResp.status).json({ error: "Node request failed", details: text });
      }

      const rawText = await sshResp.text();
      if (rawText) {
        try {
          sshData = JSON.parse(rawText);
        } catch {
          sshData = { ssh: rawText };
        }
      }

    } catch (e) {
      console.error("[Ressh] Node request failed:", e);
      return res.status(500).json({ error: "Node request failed", details: e.message });
    }

    // Update DB
    server.ssh = sshData.ssh || "N/A";
    await serversDB.set(serverId, server);

    const userServer = req.user.servers.find(s => s.id === serverId);
    if (userServer) userServer.ssh = server.ssh;
    await users.set(req.user.id, req.user);

    res.json({ containerId, action: "ressh", ssh: server.ssh, message: "SSH info updated successfully" });

  } catch (err) {
    logger.error("[Ressh] VPS ressh error:", err);
    res.status(500).json({ error: "Failed to perform action", details: err.message });
  }
});

const ploxora_route = "User Pages | Author: ma4z | V1"
module.exports = { router,ploxora_route };

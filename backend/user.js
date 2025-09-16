/*
|--------------------------------------------------------------------------
| Ploxora User Routes
| Author: ma4z
| Version: v1
|--------------------------------------------------------------------------
| This file handles user-side routes for:
| - Authentication checks
| - Settings & account management
| - Dashboard
| - VPS server management (stats, actions, SSH)
|--------------------------------------------------------------------------
*/
const router = require('express').Router();
const session = require("express-session");
const cookieParser = require("cookie-parser");
const crypto = require("crypto");
require("dotenv").config();
const Logger = require("../utilities/logger");
const logger = new Logger({ prefix: "Ploxora-Users-Router", level: "debug", pcolo: "green" });
const { servers: serversDB, users, nodes, sessions, settings } = require('../utilities/db');

async function requireLogin(req, res, next) {
  try {
    const token = req.cookies["SESSION-COOKIE"];
    if (!token) return res.redirect("/?err=LOGIN-IN-FIRST");

    const userId = await sessions.get(token);
    if (!userId) {
      res.clearCookie("SESSION-COOKIE");
      return res.redirect("/?err=USER_NOT_FOUND");
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

const addonManager = require("../addons/addon_manager");
function buildNodeUrl(node, path) {
  const base = `${node.protocol || "http"}://${node.address}`;
  const portPart = node.portEnabled && node.port ? `:${node.port}` : "";
  return `${base}${portPart}${path}`;
}
async function requireAdmin(req, res, next) {
  const token = req.cookies["SESSION-COOKIE"];
  const userId = await sessions.get(token);
  const user = await users.get(userId);
  const isAdmin = adminEmails.includes(user.email.toLowerCase());
  if (!isAdmin) {
    return res.redirect('/')
  }

  next();
}
/*
|--------------------------------------------------------------------------
| Client API System
|--------------------------------------------------------------------------
*/

/*
* Route: GET /client/api
* Description: Render client API management page.
*/
router.get("/client/api", requireLogin, async (req, res) => {
  try {
    const user = req.user;
    const name = await getAppName();
    res.render("clientapi", {
      user,
      name,
      apikeys: user.clientAPIs || [],
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("ClientAPI page error:", err);
    res.status(500).send("Failed to load client API page.");
  }
});

/*
* Route: POST /client/api/create
* Description: Creates a new client API key for the logged-in user.
*/
router.post("/client/api/create", requireLogin, async (req, res) => {
  try {
    const apiKey = crypto.randomBytes(24).toString("hex");

    const user = req.user;
    if (!user.clientAPIs) user.clientAPIs = [];
    user.clientAPIs.push({ key: apiKey, createdAt: Date.now() });

    await users.set(user.id, user);

    res.json({ apiKey, message: "Client API key created successfully" });
  } catch (err) {
    logger.error("ClientAPI create error:", err.stack || err.message || err);
    res.status(500).json({ error: "Failed to create API key" });
  }
});

/*
* Route: DELETE /client/api/delete/:key
* Description: Deletes a client API key owned by the logged-in user.
*/
router.delete("/client/api/delete/:key", requireLogin, async (req, res) => {
  try {
    const { key } = req.params;
    const user = req.user;

    if (!user.clientAPIs) return res.status(404).json({ error: "No API keys found" });

    const before = user.clientAPIs.length;
    user.clientAPIs = user.clientAPIs.filter(api => api.key !== key);

    if (before === user.clientAPIs.length) {
      return res.status(404).json({ error: "API key not found" });
    }

    await users.set(user.id, user);
    res.json({ message: "API key deleted successfully" });
  } catch (err) {
    logger.error("ClientAPI delete error:", err);
    res.status(500).json({ error: "Failed to delete API key" });
  }
});

/*
* Route: GET /client/api/list
* Description: Lists all client API keys belonging to logged-in user.
*/
router.get("/client/api/list", requireLogin, async (req, res) => {
  try {
    const user = req.user;
    res.json({ keys: user.clientAPIs || [] });
  } catch (err) {
    logger.error("ClientAPI list error:", err);
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
});

/*
* Route: GET /settings
* Description: Render settings page.
* Data: Logged-in user, app name, loaded addons.
* Version: v1.0.0
*/
router.get('/settings', requireLogin, async (req, res) => {
  const token = req.cookies["SESSION-COOKIE"];
  const userId = await sessions.get(token);
  const user = await users.get(userId);
  res.render("settings", { user, name: await getAppName(), addons: addonManager.loadedAddons })
});


/*
* Route: POST /settings/delete-account
* Description: Delete current user account and active session.
* Behavior: Clears cookies, removes from DB, redirects to login with msg=ACCOUNT_DELETED.
* Version: v1.0.0
*/

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

/*
* Route: GET /dashboard
* Description: Render user dashboard with node count & addons.
* Validations: Requires active session + user.
* Version: v1.0.0
*/
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

  let servers;

  if (req.query.admin === "seeothers" && user.admin === true) {
    servers = [];
    for await (const [key, value] of serversDB.iterator()) {
      if (value.user !== user.id) {
       servers.push(value);
      }
    }
  } else {
    servers = user.servers || [];
  }

  res.render("dashboard", {
    user,
    servers,
    name,
    nodes: count,
    watchingOthers: user.admin && req.query.admin === "seeothers",
    addons: addonManager.loadedAddons,
  });
});
/*
* Function: getServerByContainerId(containerId)
* Purpose: Find a server in serversDB by containerId.
* Returns: { id, server } or null if not found.
*/
async function getServerByContainerId(containerId) {
  for await (const [id, server] of serversDB.iterator()) {
    if (server.containerId === containerId) return { id, server };
  }
  return null;
}

/*
* Middleware: requireServerAccess
* Ensures the logged-in user is either the owner, a subuser, or an admin.
* Attaches the server object to req.server if access is granted.
*/
async function requireServerAccess(req, res, next) {
  try {
    const { containerId } = req.params;
    const user = req.user;

    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).send("Server not found");

    const { server } = result;

    const isOwner = user.servers?.some(s => s.containerId === containerId);
    const isSubuser = server.subusers?.some(su => su.email === user.email);

    if (!isOwner && !isSubuser && !user.admin) {
      return res.status(403).send("You do not have access to this VPS.");
    }

    req.server = server;
    next();
  } catch (err) {
    logger.error("[requireServerAccess] error:", err);
    res.status(500).send("Internal error checking server access");
  }
}

/*
* Route: GET /server/stats/:containerId
* Description: Fetch live server stats for a given container from node.
* Params: containerId
* Response: JSON stats (CPU, RAM, etc.)
* Version: v1.0.0
*/
router.get("/server/stats/:containerId", requireLogin, requireServerAccess, async (req, res) => {
  const { containerId } = req.params;
  const q = req.user;
  const server = req.server; 

  try {
    const user = await users.get(q.id);
    if (!user) {
      return res.status(403).json({ error: "User not found" });
    }

    const node = await nodes.get(server.node);
    if (!node) {
      return res.status(500).json({ error: "Node not found" });
    }

    const response = await fetch(
      buildNodeUrl(node, `/stats/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`)
    );

    if (!response.ok) {
      return res.status(response.status).json({ error: "Failed to fetch from node" });
    }

    const data = await response.json(); 
    res.json(data);
  } catch (err) {
    res
      .status(500)
      .json({ error: "Failed to fetch stats", details: err.message });
  }
});
/*
* Route: GET /vps/:containerId
* Description: Render VPS page for a specific container.
* Validations: Ensures user owns requested VPS.
* Version: v1.0.0
*/
router.get("/vps/:containerId", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId } = req.params;
    const user = req.user;
    const server = req.server;
    let serverip;
    const node = await nodes.get(server.node);
    if (!node) return res.status(500).json({ error: "Node not found" });
    if (node) {
      serverip = `ssh root@${node.address} -p ${server.port}`
    }
    res.render("vps", { user, server, serverip, name: await getAppName(), addons: addonManager.loadedAddons });
  } catch (err) {
    console.log(err)
    logger.error("VPS page error:", err || err.mesage || err.stack);
    res.status(500).send("Failed to load VPS page.");
  }
});

/*
* Route: POST /vps/action/:containerId/:action
* Description: Perform an action (start, stop, restart) on a VPS container.
* Params: containerId, action
* Validations: Only allows "start", "stop", "restart".
* Version: v1.0.0
*/
router.post("/vps/action/:containerId/:action", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId, action } = req.params;
    const allowedActions = ["start", "stop", "restart"];

    if (!allowedActions.includes(action)) {
      return res.status(400).json({ error: "Invalid action. allowed is: start, stop, restart" });
    }

    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { server } = result;

    const node = await nodes.get(server.node);
    if (!node) return res.status(500).json({ error: "Node not found" });

    const response = await fetch(
      buildNodeUrl(node, `/action/${action}/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`),
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
/*
* Route: POST /vps/ressh/:containerId
* Description: Regenerate SSH details for a VPS.
* Process: Validates access, fetches from node, updates DB.
* Returns: JSON with updated SSH info.
* Version: v1.0.0
*/
router.post("/vps/ressh/:containerId", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId } = req.params;

    if (!containerId) return res.status(400).json({ error: "Missing containerId" });

    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { id: serverId, server } = result;

    const node = await nodes.get(server.node);
    if (!node) return res.status(500).json({ error: "Node not found" });


    // Check container status
    const statusResp = await fetch(
      buildNodeUrl(node, `/stats/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`)
    );
    if (!statusResp.ok) {
      const text = await statusResp.text();
      return res.status(statusResp.status).json({ error: "Failed to fetch container status", details: text });
    }


    // Fetch SSH info safely
    let sshData = { ssh: "N/A" };
    try {
      const sshResp = await fetch(
        buildNodeUrl(node, `/ressh?x-verification-key=${encodeURIComponent(node.token)}`),
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
/*
* Route: GET /vps/:containerId/network
* Description: Render VPS Network Allocations page.
* Validations: Ensures user owns requested VPS.
* Version: v1.0.0
*/
router.get("/vps/:containerId/network", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId } = req.params;
    const user = req.user;

    // Check if user owns this server
    const server = req.server;

    // Render with allocations
    res.render("vps_network", {
      user,
      server,
      allocations: server.allocations || [],
      name: await getAppName(),
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("VPS Network page error:", err);
    res.status(500).send("Failed to load VPS Network page.");
  }
});

/*
* Route: POST /vps/:containerId/edit-name
* Description: Update the name of a VPS server.
* Body: { name: "newName" }
* Validations: Must own server, name must not be empty.
* Version: v1.0.0
*/
router.post("/vps/:containerId/edit-name", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId } = req.params;
    const { name } = req.body;

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return res.status(400).json({ error: "Invalid name" });
    }

    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { id: serverId, server } = result;

    // Update server in DB
    server.name = name.trim();
    await serversDB.set(serverId, server);

    // Update user’s copy
    const userServer = req.user.servers.find(s => s.id === serverId);
    if (userServer) userServer.name = server.name;
    await users.set(req.user.id, req.user);

    res.json({
      containerId,
      name: server.name,
      message: "Server name updated successfully"
    });

  } catch (err) {
    logger.error("[VPS Edit Name] error:", err);
    res.status(500).json({ error: "Failed to update server name", details: err.message });
  }
});
/*
* Route: GET /vps/:containerId/settings
* Description: VPS Settings page.
* Validations: Ensures user owns the VPS.
* Version: v1.0.0
*/
router.get("/vps/:containerId/settings", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId } = req.params;
    const user = req.user;

    // Check if user owns this server
    const server = req.server;

    res.render("vps_settings", {
      user,
      server,
      name: await getAppName(),
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("VPS Settings page error:", err);
    res.status(500).send("Failed to load VPS Settings page.");
  }
});

async function findUserByEmail(email) {
  for await (const [id, user] of users.iterator()) {
    if (user.email === email) {
      return { id, user };
    }
  }
  return null;
}

/*
|--------------------------------------------------------------------------
| Subuser Management (Add, Delete)
|--------------------------------------------------------------------------
*/

/*
* Route: POST /vps/:containerId/subusers/add
* Description: Add a subuser to a VPS server.
* Body: { email }
*/
router.post("/vps/:containerId/subusers/add", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId } = req.params;
    const { email } = req.body;

    if (!email) return res.status(400).json({ error: "Email is required" });

    // find server by containerId
    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { id: serverId, server } = result;

    // make sure server.subusers exists
    if (!server.subusers) server.subusers = [];

    // check if subuser already exists
    if (server.subusers.find(su => su.email === email)) {
      return res.status(400).json({ error: "Subuser already exists" });
    }

    // add subuser to the server record
    server.subusers.push({
      email,
      addedAt: Date.now()
    });

    await serversDB.set(serverId, server);

    const subuserResult = await findUserByEmail(email);
    if (subuserResult) {
      const { id: subuserId, user: subuser } = subuserResult;

      // force servers into an array
      if (!Array.isArray(subuser.servers)) {
        subuser.servers = [];
      }

      if (!subuser.servers.find(s => s.containerId === server.containerId)) {
        subuser.servers.push({
          id: serverId,
          name: server.name,
          ssh: server.ssh,
          containerId: server.containerId,
          createdAt: server.createdAt,
          status: server.status,
          user: server.user,
          node: server.node,
          allocation: server.allocation,
          subusers: server.subusers
        });
      }

      await users.set(subuserId, subuser);
    }


    return res.redirect(`/vps/${containerId}/subusers?success=ADDED`)
  } catch (err) {
    logger.error("[Add Subuser] error:", err.stack || err.message || err);
    res.status(500).json({ error: "Failed to add subuser", details: err.message });
  }
});


/*
* Route: DELETE /vps/:containerId/subusers/:email
* Description: Remove a subuser from server + remove server from their `servers` list.
*/
router.delete("/vps/:containerId/subusers/:email", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId, email } = req.params;
    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { id: serverId, server } = result;
    if (!server.subusers) return res.status(404).json({ error: "No subusers found" });

    const before = server.subusers.length;
    server.subusers = server.subusers.filter(su => su.email !== email);

    if (before === server.subusers.length) {
      return res.status(404).json({ error: "Subuser not found" });
    }

    await serversDB.set(serverId, server);

    const subuserResult = await findUserByEmail(email);
    if (subuserResult) {
      const { id: subuserId, user: subuser } = subuserResult;

      if (!Array.isArray(subuser.servers)) subuser.servers = [];

      subuser.servers = subuser.servers.filter(s => s.containerId !== containerId);
      await users.set(subuserId, subuser);
    }

    res.json({ message: "Subuser removed successfully", subusers: server.subusers });
  } catch (err) {
    logger.error("[Delete Subuser] error:", err);
    res.status(500).json({ error: "Failed to delete subuser", details: err.message });
  }
});

/*
* Route: GET /vps/:containerId/subusers
* Description: Render VPS Subusers management page.
* Validations: Owner or subuser access required.
*/
router.get("/vps/:containerId/subusers", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const user = req.user;
    const server = req.server;
    res.render("vps_subusers", {
      user,
      server,
      subusers: server.subusers || [],
      name: await getAppName(),
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("VPS Subusers page error:", err);
    res.status(500).send("Failed to load VPS Subusers page.");
  }
});

/*
* Route: POST /vps/:containerId/attach
* Description: Request an attach session for a VPS (creates an attachedId).
* Returns: { attachedId, expiresIn }
*/
router.post("/vps/:containerId/attach", requireLogin, requireServerAccess, async (req, res) => {
  try {
    const { containerId } = req.params;
    const server = req.server;
    const node = await nodes.get(server.node);

    if (!node) return res.status(500).json({ error: "Node not found" });

    const response = await fetch(
      buildNodeUrl(node, `/vps/container/attach/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`),
      { method: "POST" }
    );

    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: "Node request failed", details: text });
    }

    const data = await response.json();
    res.json({
      containerId,
      attachedId: data.attachedId,
      expiresIn: data.expiresIn,
      message: "Attach session created successfully"
    });
  } catch (err) {
    logger.error("[Attach] error:", err);
    res.status(500).json({ error: "Failed to create attach session", details: err.message });
  }
});

/*
* Route: POST /vps/:containerId/attached/:attachedId/:action
* Description: Interact with an active attach session (logs / execute).
* Body: { command } for execute
*/
// panel route
router.post("/vps/:containerId/attached/:attachedId/:action", requireLogin, requireServerAccess, async (req, res) => {
  const { containerId, attachedId, action } = req.params;
  const server = req.server;
  const node = await nodes.get(server.node);

  if (!node) return res.status(500).json({ error: "Node not found" });

  const response = await fetch(
    buildNodeUrl(
      node,
      `/vps/container/attached/${attachedId}/${action}?x-verification-key=${encodeURIComponent(node.token)}`
    ),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body || {})
    }
  );

  if (!response.ok) {
    const text = await response.text();
    return res.status(response.status).json({ error: "Node request failed", details: text });
  }

  const data = await response.json();
  res.json(data);
});


const ploxora_route = "User Pages | Author: ma4z | V1"
module.exports = { router, ploxora_route };

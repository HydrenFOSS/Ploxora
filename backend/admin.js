/*
|--------------------------------------------------------------------------
| Ploxora Admin Routes
| Author: ma4z
| Version: v1
|--------------------------------------------------------------------------
| This file contains all admin-related routes for managing:
| - Overview dashboard
| - Nodes
| - Servers
| - Settings
| - Users
|--------------------------------------------------------------------------
*/

const router = require("express").Router();
const Logger = require("../utilities/logger");
const logDiscord = require("../utilities/discordLogging");
const logger = new Logger({ prefix: "Ploxora-Admin-Router", level: "debug" });
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Keyv = require("keyv");
const package = require("../package.json")
const nodes = new Keyv(process.env.NODES_DB || "sqlite://nodes.sqlite");
const servers = new Keyv(process.env.SERVERS_DB || "sqlite://servers.sqlite");
const settings = new Keyv(process.env.SETTINGS_DB || "sqlite://settings.sqlite");
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv(process.env.SESSIONS_DB || 'sqlite://sessions.sqlite');
const crypto = require("crypto");
const addonManager = require("../addons/addon_manager");

const adminEmails = (process.env.ADMIN_USERS || "")
  .split(",")
  .map(e => e.trim().toLowerCase());

  const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = path.join(__dirname, "../public/uploads");
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, `logo${ext}`);
  }
});
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
/*
* Route: /admin/overview
* Description: Admin Overview Dashboard for displaying the latest Ploxora version and related details.
* Version: v1.0.0
* Request: GET
*/
router.get("/admin/overview", requireAdmin, requireLogin, async (req, res) => {
  res.render("admin/overview", { name: await getAppName(), user: req.user, version: package.version, addons: addonManager.loadedAddons })
});

/*
* Route: /admin/node/:id/data
* Description: Get A Specific Node Details 
* Version: v1.0.0
* Params: id
* Request: GET
*/
router.get("/admin/node/:id/data", requireAdmin, async (req, res) => {
  try {
    const nodeId = req.params.id;

    const node = await nodes.get(nodeId);

    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    let status = "Offline";

    try {
      const response = await fetch(
        `http://${node.address}:${node.port}/checkdockerrunning?x-verification-key=${node.token}`,
        { timeout: 3000 }
      );

      if (response.ok) {
        const data = await response.json();
        if (data.docker === "running") {
          status = "Online";
        } else {
          status = "Offline";
        }
      }
    } catch (err) {
      //logger.error(`Health check failed for node ${nodeId}:`, err.message);
      status = "Offline";
    }

    // Update DB if status changed
    if (node.status !== status) {
      node.status = status;
      await nodes.set(nodeId, node);
    }

    // Respond with JSON
    res.json({
      success: true,
      node: {
        id: node.id,
        token: node.token,
        ram: node.ram,
        cores: node.cores,
        name: node.name,
        address: node.address,
        port: node.port,
        location: node.location,
        status: node.status,
        createdAt: node.createdAt
      }
    });
  } catch (err) {
    logger.error("Error loading node details:", err);
    res.status(500).json({ error: "Error loading node details" });
  }
});

const upload = multer({ storage });

/*
* Route: /admin/settings/upload-logo
* Description: Route for Uploading logo or updating the existing logo
* Version: v1.0.0
* Request: POST
*/
router.post("/admin/settings/upload-logo", requireLogin, requireAdmin, upload.single("Logo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    // Save logo path to settings
    const logoPath = `/uploads/logo.png`;
    await settings.set("Logo", logoPath);

    res.json({ success: true, logoUrl: logoPath });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Failed to upload logo" });
  }
});
/*
* Route: /admin/settings
* Description: Admin Settings
* Version: v1.0.0
* Request: GET
*/
router.get("/admin/settings", requireLogin, requireAdmin, async (req, res) => {
  try {
    const allSettings = {};
    for await (const [key, value] of settings.iterator()) {
      if (key !== "__initialized__") allSettings[key] = value;
    }
     const logoPath = path.join(__dirname, "../public/uploads/logo.png");
    const logoExists = fs.existsSync(logoPath);
    res.render("admin/settings", {
      name: await getAppName(),
      user: req.user,
      settings: allSettings,
      req,
      logoExists,
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("Error loading settings:", err);
    res.status(500).send("Error loading settings");
  }
});
/*
* Route: /admin/settings/:key/:value
* Description: Admin Settings Router for updating an value of a key
* Version: v1.0.0
* Params: key,value
* Request: GET
*/
router.get("/admin/settings/update/:key/:value", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { key, value } = req.params;

    // Update the setting
    await settings.set(key, value);

    res.redirect("/admin/settings?msg=SETTINGS_UPDATED");
  } catch (err) {
    logger.error("Error updating settings via URL:", err);
    res.status(500).send("Failed to update settings");
  }
});
/*
* Route: /admin/nodes/json
* Description: Admin Fetch Nodes from the nodes database
* Version: v1.0.0
* Request: GET
*/
router.get("/admin/nodes/json", requireAdmin, async (req, res) => {
  try {
    const allNodes = [];
    for await (const [key, value] of nodes.iterator()) {
      let status = "Offline";

      try {
        const response = await fetch(
          `http://${value.address}:${value.port}/checkdockerrunning?x-verification-key=${value.token}`,
          { timeout: 3000 }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.docker === "running") {
            status = "Online";
          }
        }
      } catch (err) {
        //logger.error(`Health check failed for node ${key}: ${err.message}`);
      }

      // Update DB if status changed
      if (value.status !== status) {
        value.status = status;
        await nodes.set(key, value);
      }

      allNodes.push({ id: key, ...value });
    }

    res.json({
      success: true,
      nodes: allNodes,
    });
  } catch (err) {
    logger.error("Error loading node details:", err);
    res.status(500).json({ error: "Error loading nodes details" });
  }
});

/*
* Route: /admin/nodes
* Method: GET
* Description: Render the admin nodes page with live node status and versions.
* Version: v1.0.0
*/
router.get("/admin/nodes", requireLogin, requireAdmin, async (req, res) => {
  try {
    const allNodes = [];

    for await (const [key, value] of nodes.iterator()) {
      let status = "Offline";

      // Check Docker status
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(
          `http://${value.address}:${value.port}/checkdockerrunning?x-verification-key=${value.token}`,
          { signal: controller.signal }
        );
        clearTimeout(timeout);

        if (response.ok) {
          const data = await response.json();
          if (data.docker === "running") {
            status = "Online";
          }
        }
      } catch (err) {
        status = "Offline";
      }

      // Fetch Node version
      let version = "Unknown";
      try {
        const ver_res = await fetch(
          `http://${value.address}:${value.port}/version?x-verification-key=${value.token}`,
          { timeout: 3000 }
        );
        if (ver_res.ok) {
          const ver_data = await ver_res.json();
          version = ver_data.version || "Unknown";
        }
      } catch (err) {
        version = "Unknown";
      }

      // Update DB if status changed
      if (value.status !== status) {
        value.status = status;
        await nodes.set(key, value);
      }

      // Push node with version
      allNodes.push({ id: key, ...value, version });
    }

    res.render("admin/nodes", {
      name: await getAppName(),
      user: req.user,
      nodes: allNodes,
      req,
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("Error loading nodes:", err);
    res.status(500).send("Error loading nodes");
  }
});

/*
* Route: /admin/servers
* Method: GET
* Description: Render the admin servers page with all servers, users, and nodes.
* Version: v1.0.0
*/
router.get("/admin/servers", requireLogin, requireAdmin, async (req, res) => {
  try {
    const allServers = [];
    for await (const [key, value] of servers.iterator()) {
      allServers.push({ id: key, ...value });
    }

    const allUsers = [];
    for await (const [key, value] of users.iterator()) {
     allUsers.push({ id: key, ...value, banned: value.banned || false });
    }
    
    const allNodes = [];
    for await (const [key, value] of nodes.iterator()) {
      allNodes.push({ id: key, ...value });
    }
    res.render("admin/servers", {
      name: await getAppName(),
      user: req.user,
      servers: allServers,
      users: allUsers,
      nodes: allNodes,
      req,
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    res.status(500).send("Error loading servers");
  }
});
/*
* Route: /admin/servers/create
* Method: POST
* Description: Create and deploy a new server for a specific user on a node.
* Body: { name, gb, cores, userId, nodeId }
* Version: v1.0.0
*/
router.post("/admin/servers/create", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { name, gb, cores, port, userId, nodeId } = req.body;

    const node = await nodes.get(nodeId);
    if (!node) return res.status(404).send("Node not found");
    
    const user = await users.get(userId);
    if (!user) return res.status(404).send("User not found");

    if (!Array.isArray(user.servers)) {
      user.servers = [];
    }

    const deployRes = await fetch(
      `http://${node.address}:${node.port}/deploy?x-verification-key=${node.token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ram: gb, cores, name, port }),
      }
    );

    const result = await deployRes.json();
    if (!deployRes.ok) {
      return res.status(500).send(result.message || "Failed to create server");
    }

    const server = {
      id: uuid(),
      name,
      ssh: result.ssh,
      port,
      containerId: result.containerId,
      createdAt: new Date(),
      status: "online",
      user: userId,
      node: nodeId
    };

    user.servers.push(server);
    await users.set(userId, user);

    await servers.set(server.id, server);
    logDiscord(`Server Created for ${user.username} as ${name}`, "info")
    res.redirect("/admin/servers?msg=SERVER_CREATED");
  } catch (err) {
    logger.error("Error creating server:", err);
    res.status(500).send("Error creating server");
  }
});


/*
* Route: /admin/servers/delete/:id
* Method: POST
* Description: Delete an existing server and remove it from its node and user.
* Params: id (Server ID)
* Version: v1.0.0
*/
router.post("/admin/servers/delete/:id", requireLogin, requireAdmin, async (req, res) => {
  try {
    const serverId = req.params.id;

    const server = await servers.get(serverId);
    if (!server) {
      return res.status(404).send("Server not found");
    }

    const node = await nodes.get(server.node);
    if (!node) {
      return res.status(404).send("Node not found for this server");
    }

    // Tell node to delete container
    try {
      await fetch(
        `http://${node.address}:${node.port}/vps/delete?x-verification-key=${node.token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ containerId: server.containerId }),
        }
      );
    } catch (err) {
      logger.error(`Failed to delete container on node:`, err.message);
    }

    // Remove server from user
    const user = await users.get(server.user);
    if (user && Array.isArray(user.servers)) {
      user.servers = user.servers.filter(s => s.id !== serverId);
      await users.set(server.user, user);
    }

    // Remove from servers DB
    await servers.delete(serverId);
    logDiscord(`Server Deleted of ${user.username} as ${serverId}`, "info")
    res.redirect("/admin/servers?msg=SERVER_DELETED");
  } catch (err) {
    logger.error("Error deleting server:", err);
    res.status(500).send("Error deleting server");
  }
});

/*
* Route: /admin/nodes/delete/:id
* Method: POST
* Description: Delete a node and all associated servers linked to it.
* Params: id (Node ID)
* Version: v1.0.0
*/
router.post("/admin/nodes/delete/:id", requireLogin, requireAdmin, async (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = await nodes.get(nodeId);

    if (!node) return res.status(404).send("Node not found");

    // Collect all servers associated with this node
    const linkedServers = [];
    for await (const [key, value] of servers.iterator()) {
      if (value.node === nodeId) linkedServers.push({ id: key, ...value });
    }

    // Delete all linked servers
    for (const server of linkedServers) {
      try {
         await fetch(
            `http://${node.address}:${node.port}/vps/delete?x-verification-key=${node.token}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ containerId: server.containerId }),
            }
          );

        const user = await users.get(server.user);
        if (user && Array.isArray(user.servers)) {
          user.servers = user.servers.filter(s => s.id !== server.id);
          await users.set(server.user, user);
        }

        await servers.delete(server.id);
        logDiscord(`Server ${server.name || server.id} deleted due to node deletion`, "warn");

      } catch (err) {
        logger.error(`Failed to delete server ${server.id} on node ${nodeId}:`, err.message);
      }
    }
    await nodes.delete(nodeId);
    logDiscord(`Node ${node.name} and all its servers were deleted`, "warn");

    res.redirect("/admin/nodes?msg=NODE_DELETED_WITH_SERVERS");
  } catch (err) {
    logger.error("Error deleting node and linked servers:", err);
    res.status(500).send("Error deleting node and linked servers");
  }
});

/*
* Route: /admin/nodes/create
* Method: POST
* Description: Create a new node and save it to the database.
* Body: { name, address, port, ram, cores }
* Version: v1.0.0
*/
router.post("/admin/nodes/create",requireLogin, requireAdmin, async (req, res) => {
  try {
    const { name, address, port, ram,cores } = req.body;

    // Generate random ID + token
    const id = Math.random().toString(36).substring(2, 10);
    const token = Math.random().toString(36).substring(2, 20);

    // Try to get location from IP address
    let location = "UNKNOWN";
    try {
      const response = await fetch(`http://ip-api.com/json/${address}`);
      const data = await response.json();
      if (data && data.countryCode) {
        location = data.countryCode; // like "US", "DE"
      }
    } catch (err) {
      logger.error("Location lookup failed:", err.message);
    }

    // Node object
    const node = {
      id,
      token,
      ram,
      cores,
      name,
      address,
      port,
      location,
      status: "Offline",
      createdAt: new Date().toISOString()
    };

    // Save node into DB (key = id)
    await nodes.set(id, node);

    // Redirect back to nodes page
    res.redirect("/admin/nodes?msg=NODE-CREATED");
  } catch (error) {
    logger.error("Error creating node:", error);
    res.redirect("/admin/nodes?err=FAILED-CREATE");
  }
});

/*
* Route: /admin/node/:id
* Method: GET
* Description: Render details page for a specific node, including servers, status, and version.
* Params: id (Node ID)
* Version: v1.0.0
*/
router.get("/admin/node/:id", requireAdmin, requireLogin, async (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = await nodes.get(nodeId);

    if (!node) {
      return res.status(404).send("Node not found");
    }

    // --- Node Docker Status ---
    let status = "Offline";
    try {
      const response = await fetch(
        `http://${node.address}:${node.port}/checkdockerrunning?x-verification-key=${node.token}`,
        { timeout: 3000 }
      );

      if (response.ok) {
        const data = await response.json();
        status = data.docker === "running" ? "Online" : "Offline";
      }
    } catch (err) {
      //logger.error(`Health check failed for node ${nodeId}:`, err.message);
      status = "Offline";
    }

    // --- Update DB if status changed ---
    if (node.status !== status) {
      node.status = status;
      await nodes.set(nodeId, node);
    }
    let version = "Unknown";
    let fewdata = {}
    try {
      const ver_res = await fetch(
        `http://${node.address}:${node.port}/version?x-verification-key=${node.token}`,
        { timeout: 3000 }
      );
      if (ver_res.ok) {
        const ver_data = await ver_res.json();
        version = ver_data.version || "Unknown";
        fewdata = ver_data
      }
    } catch (err) {
    //  logger.error(`Failed to fetch version for node ${nodeId}:`, err.message);
      version = "Unknown";
    }
    // --- Collect servers assigned to this node ---
    const allServers = [];
    for await (const [key, server] of servers.iterator()) {
      if (server.node === nodeId) {
        allServers.push({ id: key, ...server });
      }
    }

    // --- Render page ---
    res.render("admin/node", {
      name: await getAppName(),
      user: {
        ...req.user,
        admin: adminEmails.includes(req.user.email.toLowerCase()),
      },
      req,
      node: {
        ...node,
        status,
        fewdata,
      },
      servers: allServers,
      addons: addonManager.loadedAddons
    });

  } catch (err) {
    logger.error("Error in /admin/node/:id:", err);
    res.status(500).send("Failed to fetch node info");
  }
});
/*
* Route: /admin/node/:id/docker-usage
* Method: GET
* Description: Fetch real-time Docker usage stats (CPU, memory, disk) from a node.
* Params: id (Node ID)
* Version: v1.0.0
*/
router.get("/admin/node/:id/docker-usage", requireAdmin, async (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = await nodes.get(nodeId);

    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    let usageData = {
      totalCPU: 0,
      totalMemoryUsedMB: 0,
      totalDiskMB: 0
    };

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); 

      const response = await fetch(
        `http://${node.address}:${node.port}/docker-usage?x-verification-key=${node.token}`,
        { signal: controller.signal }
      );

      clearTimeout(timeout);

      if (response.ok) {
        usageData = await response.json();
      } else {
      //  logger.error(`Failed to fetch Docker usage from node ${nodeId}: ${response.statusText}`);
      }
    } catch (err) {
     // logger.error(`Error fetching Docker usage from node ${nodeId}: ${err.message}`);
    }

    res.json({
      success: true,
      nodeId,
      usage: usageData
    });
  } catch (err) {
    logger.error("Error in /admin/node/:id/docker-usage:", err);
    res.status(500).json({ error: "Failed to fetch Docker usage" });
  }
});

/*
* Route: /admin/users
* Method: GET
* Description: Render the admin users page with all registered users.
* Version: v1.0.0
*/
router.get("/admin/users", requireAdmin, requireLogin, async (req, res) => {
  try {
    const allUsers = [];
    for await (const [key, value] of users.iterator()) {
      allUsers.push({ id: key, ...value, banned: value.banned || false });
    }

    res.render("admin/users", {
      name: await getAppName(),
      users: allUsers,
      req,
      user: req.user,
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("Error fetching users:", err);
    res.status(500).send("Error loading users");
  }
});
/*
* Route: /admin/users/ban/:id
* Method: POST
* Description: Ban a user from the platform.
* Params: id (User ID)
* Version: v1.0.0
*/
router.post("/admin/users/ban/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await users.get(id);
    if (!user) return res.status(404).send("User not found");

    user.banned = true; // mark as banned
    await users.set(id, user);

    res.redirect("/admin/users?msg=USER_BANNED");
  } catch (err) {
    logger.error("Ban user error:", err);
    res.status(500).send("Failed to ban user");
  }
});

/*
* Route: /admin/users/unban/:id
* Method: POST
* Description: Unban a previously banned user.
* Params: id (User ID)
* Version: v1.0.0
*/
router.post("/admin/users/unban/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const user = await users.get(id);
    if (!user) return res.status(404).send("User not found");

    user.banned = false; // remove ban
    await users.set(id, user);

    res.redirect("/admin/users?msg=USER_UNBANNED");
  } catch (err) {
    logger.error("Unban user error:", err);
    res.status(500).send("Failed to unban user");
  }
});
/*
* Route: /admin/users/delete/:id
* Method: POST
* Description: Permanently delete a user from the system.
* Params: id (User ID)
* Version: v1.0.0
*/
router.post("/admin/users/delete/:id", requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await users.delete(id);
    res.redirect("/admin/users");
  } catch (err) {
    logger.error("Delete user error:", err);
    res.status(500).send("Failed to delete user");
  }
});
const ploxora_route = "Admin | Author: ma4z | V1"
module.exports = { router,ploxora_route };

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
const AuditLogger = require("../utilities/al");
const audit = new AuditLogger();
const logger = new Logger({ prefix: "Ploxora-Admin-Router", level: "debug" });
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const package = require("../package.json")
const { nodes, servers, settings, users, sessions, nestbits, theme } = require('../utilities/db');
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
function buildNodeUrl(node, path) {
    // DEBUG: process.stdout.write('executed\n'); // flushes immediately
    const base = `${node.protocol || "http"}://${node.address}`;
    const portPart = node.portEnabled && node.port ? `:${node.port}` : "";
    try {
        // DEBUG: logger.init(`${base}${portPart}${path}`);
    } catch (e) {
        console.error('logger.init failed:', e);
    }
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

    req.user = user; 
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
         buildNodeUrl(node, `/checkdockerrunning?x-verification-key=${node.token}`),
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
      logger.error(`Health check failed for node ${nodeId}:`, err.message);
      status = "Offline";
    }
    
    if (node.status !== status) {
      node.status = status;
      await nodes.set(nodeId, node);
    }

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
          buildNodeUrl(node, `/checkdockerrunning?x-verification-key=${node.token}`),
          { timeout: 3000 }
        );

        if (response.ok) {
          const data = await response.json();
          if (data.docker === "running") {
            status = "Online";
          }
        }
      } catch (err) {
        logger.error(`Health check failed for node ${key}: ${err.message}`);
      }

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

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(
          buildNodeUrl(value, `/checkdockerrunning?x-verification-key=${value.token}`),
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
        const verController = new AbortController();
        const verTimeout = setTimeout(() => verController.abort(), 3000);

        const ver_res = await fetch(
          buildNodeUrl(value, `/version?x-verification-key=${value.token}`),
          { signal: verController.signal }
        );
        clearTimeout(verTimeout);

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
    const allNestBits = [];
    for await (const [id, value] of nestbits.iterator()) {
      allNestBits.push({ id, ...value });
    }
    res.render("admin/servers", {
      name: await getAppName(),
      user: req.user,
      servers: allServers,
      nestbits: allNestBits,
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
    const { name, gb, cores, userId, nodeId, nestbitId, allocationId } = req.body;

    const node = await nodes.get(nodeId);
    if (!node) return res.status(404).send("Node not found");

    const nestbit = await nestbits.get(nestbitId);
    if (!nestbit) return res.status(404).send("Nestbit not found");

    const port = parseInt(allocationId, 10);
    const allocation = node.allocations.find(a => a.allocation_port === port);
    if (!allocation || allocation.isBeingUsed) {
      return res.status(400).send("Invalid allocation or is being used");
    }

    const user = await users.get(userId);
    if (!user) return res.status(404).send("User not found");

    if (!Array.isArray(user.servers)) user.servers = [];

    const deployRes = await fetch(
      buildNodeUrl(node, `/deploy?x-verification-key=${node.token}`),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ram: gb,
          cores,
          name,
          port: allocation.allocation_port,
          nbimg: nestbit.dockerimage,
        })
      }
    );

    const result = await deployRes.json();
    if (!deployRes.ok) {
      return res.status(500).send(result.message || "Failed to create server");
    }
    let serverip = `ssh root@${allocation.domain || allocation.ip} -p ${allocation.allocation_port}`;
    if (result.port) {
      serverip = `https://${allocation.domain}:${result.port}/vnc.html`;
    } else {
      // does nothing...
    }
    const server = {
      id: uuid(),
      name,
      ssh: serverip,
      containerId: result.containerId,
      createdAt: new Date(),
      status: "online",
      user: userId,
      node: node.id,
      allocation: { domain: allocation.domain, ip: allocation.ip, port: allocation.allocation_port },
      nestbit,
    };

    user.servers.push(server);
    await users.set(userId, user);
    await servers.set(server.id, server);
    allocation.isBeingUsed = true;
    await nodes.set(node.id, node);

    logDiscord(
      `Server Created for ${user.username} with ${allocation.ip || allocation.domain}:${allocation.allocation_port}`,
      "info"
    );
    await audit.log(req.user, "CREATE_SERVER", `Created server ${server.name} (${server.id}) for ${user.username}`);
    res.redirect("/admin/servers?msg=SERVER_CREATED");
  } catch (err) {
    console.log(err)
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
        buildNodeUrl(node, `/vps/delete?x-verification-key=${node.token}`),
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
    const allocation = node.allocations.find(a => a.allocation_port === server.allocation.port);
    if (allocation) {
      allocation.isBeingUsed = false;
      await nodes.set(node.id, node);
    }
    logDiscord(`Server Deleted of ${user.username} as ${serverId}`, "info")
    await audit.log(req.user, "DELETE_SERVER", `Deleted server ${server.name} (${server.id}) of user ${user.username}`);
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
            buildNodeUrl(node, `/vps/delete?x-verification-key=${node.token}`),
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
    await audit.log(req.user, "DELETE_NODE", `Deleted node ${node.name} (${nodeId}) and all linked servers`);
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
* Body: { name, address, port, ram, cores, protocol, portEnabled }
* Version: v1.1.0
*/
router.post("/admin/nodes/create", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { name, address, port, ram, cores, protocol, portEnabled } = req.body;

    const id = Math.random().toString(36).substring(2, 10);
    const token = Math.random().toString(36).substring(2, 20);

    let location = "UNKNOWN";
    try {
      const response = await fetch(`http://ip-api.com/json/${address}`);
      const data = await response.json();
      if (data && data.countryCode) {
        location = data.countryCode;
      }
    } catch (err) {
      logger.error("Location lookup failed:", err.message);
    }

    const finalProtocol = protocol && ["http", "https"].includes(protocol) ? protocol : "http";
    const finalPortEnabled = portEnabled === "true" || portEnabled === true;

    const node = {
      id,
      token,
      ram,
      cores,
      name,
      address,
      port: finalPortEnabled ? port : null,
      protocol: finalProtocol,
      portEnabled: finalPortEnabled,
      allocations: [],
      location,
      status: "Offline",
      createdAt: new Date().toISOString()
    };

    await nodes.set(id, node);
    await audit.log(req.user, "CREATE_NODE", `Created node ${node.name} (${node.id}) at ${node.address}:${node.port || "no-port"} [${finalProtocol}]`);

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
        buildNodeUrl(node, `/checkdockerrunning?x-verification-key=${node.token}`),
        { timeout: 3000 }
      );

      if (response.ok) {
        const data = await response.json();
        status = data.docker === "running" ? "Online" : "Offline";
      }
    } catch (err) {
      logger.error(`Health check failed for node ${nodeId}:`, err.message);
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
        buildNodeUrl(node, `/version?x-verification-key=${node.token}`),
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
* Route: /admin/nodes/:id/allocations/add
* Method: POST
* Description: Add new allocations (supports single port or range).
* Body: { portRange, domain?, ip? }
* Params: id (Node ID)
*/
router.post("/admin/nodes/:id/allocations/add", requireLogin, requireAdmin, async (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = await nodes.get(nodeId);
    if (!node) return res.status(404).send("Node not found");

    const { portRange, domain, ip } = req.body;
    if (!portRange) return res.status(400).send("Port range required");

    let ports = [];

    if (portRange.includes("-")) {
      // Range e.g. 3000-3200
      const [start, end] = portRange.split("-").map(p => parseInt(p, 10));
      if (isNaN(start) || isNaN(end) || start > end) {
        return res.status(400).send("Invalid port range");
      }
      for (let p = start; p <= end; p++) {
        ports.push(p);
      }
    } else {
      // Single port
      const p = parseInt(portRange, 10);
      if (isNaN(p)) return res.status(400).send("Invalid port");
      ports.push(p);
    }

    // Ensure allocations array exists
    if (!Array.isArray(node.allocations)) {
      node.allocations = [];
    }

    // Add each port as allocation
    for (const port of ports) {
      node.allocations.push({
        name: `alloc-${port}`,
        allocation_port: port,
        domain: domain || null,
        ip: ip || null,
        isBeingUsed: false,
        createdAt: new Date().toISOString(),
      });
    }

    await nodes.set(nodeId, node);

    logDiscord(`Allocations added to node ${node.name}: ${ports.join(", ")}`, "info");
    res.redirect(`/admin/node/${nodeId}?msg=ALLOCATIONS_ADDED`);
  } catch (err) {
    logger.error("Error adding allocations:", err);
    res.status(500).send("Failed to add allocations");
  }
});

/*
* Route: /admin/nodes/edit/:id
* Method: POST
* Description: Edit a node’s details.
* Body: { name?, address?, port?, ram?, cores? }
* Params: id (Node ID)
* Version: v1.0.0
*/
router.post("/admin/nodes/edit/:id", requireLogin, requireAdmin, async (req, res) => {
  try {
    const nodeId = req.params.id;
    const node = await nodes.get(nodeId);

    if (!node) return res.status(404).send("Node not found");

    const { name, address, port, ram, cores } = req.body;

    if (name) node.name = name;
    if (address) node.address = address;
    if (port) node.port = port;
    if (ram) node.ram = ram;
    if (cores) node.cores = cores;

    await nodes.set(nodeId, node);

    logDiscord(`Node ${node.name} updated (details edited).`, "info");
    await audit.log(req.user, "EDIT_NODE", `Updated node ${node.name} (${node.id}) with new details`);
    res.redirect(`/admin/node/${nodeId}?msg=NODE_UPDATED`);
  } catch (err) {
    logger.error("Error updating node:", err);
    res.status(500).send("Failed to update node");
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
        buildNodeUrl(node, `/docker-usage?x-verification-key=${node.token}`),
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
* Route: /admin/users/new
* Method: POST
* Description: Create a new user
* Body: { username, email, password }
*/
router.post("/admin/users/new", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }

    for await (const [id, user] of users.iterator()) {
      if (user.email.toLowerCase() === email.toLowerCase()) {
        return res.status(400).json({ success: false, error: "Email already in use" });
      }
    }

    const userId = uuid();
    const hashedPassword = crypto.createHash("sha256").update(password).digest("hex");

    const newUser = {
      id: userId,
      username,
      email: email.toLowerCase(),
      password: hashedPassword,
      servers: [],
      banned: false,
      profilePicture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(username)}`,
      createdAt: new Date().toISOString(),
    };

    await users.set(userId, newUser);
    await audit.log(req.user, "CREATE_USER", `Created new user ${username} (${userId})`);

    res.redirect("/admin/users?msg=USER_CREATED")
  } catch (err) {
    logger.error("Error creating user:", err);
    res.status(500).json({ success: false, error: "Failed to create user" });
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
    await audit.log(req.user, "BAN_USER", `Banned user ${user.username} (${id})`);
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
    await audit.log(req.user, "UNBAN_USER", `Unbanned user ${user.username} (${id})`);
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
router.post("/admin/users/delete/:id", requireAdmin, requireLogin, async (req, res) => {
  try {
    const { id } = req.params;
    await users.delete(id);
    await audit.log(req.user, "DELETE_USER", `Deleted user with ID ${id}`);
    res.redirect("/admin/users?msg=USER_DELETED");
  } catch (err) {
    console.log(err)
    logger.error("Delete user error:", err.message || err || err.stack);
    res.status(500).send("Failed to delete user");
  }
});
/*
* Route: /admin/audit-logs
* Method: GET
* Description: Render the admin audit logs page.
* Version: v1.0.0
*/
router.get("/admin/audit-logs", requireLogin, requireAdmin, async (req, res) => {
  try {
    const logs = await audit.getLogs();
    res.render("admin/audit_logs", {
      name: await getAppName(),
      user: req.user,
      logs: logs.reverse(),
      req,
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("Error loading audit logs:", err);
    res.status(500).send("Failed to load audit logs");
  }
});
/*
* Route: /admin/nestbits
* Description: List all NestBits
* Method: GET
*/
router.get("/admin/nestbits", requireLogin, requireAdmin, async (req, res) => {
  try {
    const allNestBits = [];
    for await (const [id, value] of nestbits.iterator()) {
      allNestBits.push({ id, ...value });
    }
    res.render("admin/nestbits", { user: req.user, nestbits: allNestBits,name: await getAppName(), req, addons: addonManager.loadedAddons });
  } catch (err) {
    logger.error("Error loading NestBits:", err);
    res.status(500).send("Failed to load NestBits");
  }
});

/*
* Route: /admin/nestbits/new
* Description: Create a new NestBit
* Method: POST
* Body: { dockerimage, name, description, version, author }
*/
router.post("/admin/nestbits/new", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { dockerimage, name, description, version, author } = req.body;
    if (!dockerimage || !name || !version) {
      return res.status(400).send("Missing required fields");
    }

    const id = Math.random().toString(36).substring(2, 10);
    const newNestBit = { dockerimage, name, description, version, author, createdAt: new Date().toISOString() };

    await nestbits.set(id, newNestBit);
    await audit.log(req.user, "CREATE_NESTBIT", `Created NestBit ${name} (${id})`);

    res.redirect("/admin/nestbits?msg=NESTBIT_CREATED");
  } catch (err) {
    logger.error("Error creating NestBit:", err);
    res.status(500).send("Failed to create NestBit");
  }
});

/*
* Route: /admin/nestbits/delete
* Description: Delete a NestBit by ID
* Method: POST
* Body: { id }
*/
router.post("/admin/nestbits/delete", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ success: false, error: "Missing NestBit ID" });

    const existing = await nestbits.get(id);
    if (!existing) return res.status(404).json({ success: false, error: "NestBit not found" });

    await nestbits.delete(id);
    await audit.log(req.user, "DELETE_NESTBIT", `Deleted NestBit ${existing.name} (${id})`);
    res.redirect("/admin/nestbits?msg=NESTBIT_DELETED");
  } catch (err) {
    logger.error("Error deleting NestBit:", err);
    res.status(500).json({ success: false, error: "Failed to delete NestBit" });
  }
});
/*
* Route: /admin/nestbits/export/:id
* Description: Export a specific NestBit as JSON by ID
* Method: GET
* Params: id
*/
router.get("/admin/nestbits/export/:id", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const nestbit = await nestbits.get(id);

    if (!nestbit) {
      return res.status(404).json({ success: false, error: "NestBit not found" });
    }

    res.setHeader('Content-Disposition', `attachment; filename=nestbit-${nestbit.name}.json`);
    res.setHeader('Content-Type', 'application/json');
    res.send(JSON.stringify({ id, ...nestbit }, null, 2));
  } catch (err) {
    logger.error(`Error exporting NestBit ${req.params.id}:`, err);
    res.status(500).json({ success: false, error: "Failed to export NestBit" });
  }
});
/*
* Route: /admin/theme
* Method: GET
* Description: List the single theme (auto-create default if none) and show active theme/classes.
* Version: v1.1.0
*/
router.get("/admin/theme", requireLogin, requireAdmin, async (req, res) => {
  try {
    const allThemes = [];
    for await (const [id, value] of theme.iterator()) {
      allThemes.push({ id, ...value });
    }

    // If there is no theme stored, create a single default theme automatically
    if (allThemes.length === 0) {
      const defaultId = "default";
      const defaultTheme = {
        id: defaultId,
        name: "Default",
        background: "bg-neutral-950",
        textColor: "text-white",
        buttonColor: "bg-neutral-800",
        createdAt: new Date().toISOString(),
      };
      await theme.set(defaultId, defaultTheme);
      allThemes.push({ id: defaultId, ...defaultTheme });

      // ensure settings default values exist
      await settings.set("ACTIVE_THEME", `${defaultTheme.background} ${defaultTheme.textColor}`);
      await settings.set("ACTIVE_BUTTON", defaultTheme.buttonColor);
    }

    // Active theme/classes (fallback to defaults if settings are missing)
    const activeTheme = await settings.get("ACTIVE_THEME") || "bg-neutral-950 text-white";
    const activeButton = await settings.get("ACTIVE_BUTTON") || "bg-neutral-800";

    res.render("admin/theme", {
      name: await getAppName(),
      user: req.user,
      themes: allThemes,
      activeTheme,
      activeButton,
      req,
      addons: addonManager.loadedAddons
    });
  } catch (err) {
    logger.error("Error loading themes:", err);
    res.status(500).send("Failed to load themes");
  }
});

/*
* Route: /admin/theme/edit/:id
* Method: POST
* Description: Edit/update the theme (TailwindCSS format)
* Body: { name, background, textColor, buttonColor }
* Params: id
*/
router.post("/admin/theme/edit/:id", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, background, textColor, buttonColor } = req.body;

    const existing = await theme.get(id);
    if (!existing) return res.status(404).send("Theme not found");

    const updatedTheme = {
      ...existing,
      name: name || existing.name,
      background: background || existing.background,
      textColor: textColor || existing.textColor,
      buttonColor: buttonColor || existing.buttonColor,
      updatedAt: new Date().toISOString()
    };

    await theme.set(id, updatedTheme);
    await audit.log(req.user, "EDIT_THEME", `Edited theme ${updatedTheme.name} (${id})`);

    // If the edited theme was active before (or there was no active theme), update settings to reflect changes.
    const prevActive = await settings.get("ACTIVE_THEME");
    const prevActiveString = `${existing.background} ${existing.textColor}`;
    if (!prevActive || prevActive === prevActiveString) {
      const cssClass = `${updatedTheme.background} ${updatedTheme.textColor}`;
      await settings.set("ACTIVE_THEME", cssClass);
      await settings.set("ACTIVE_BUTTON", updatedTheme.buttonColor);
    }

    res.redirect("/admin/theme?msg=THEME_UPDATED");
  } catch (err) {
    logger.error("Error editing theme:", err);
    res.status(500).send("Failed to edit theme");
  }
});

/*
* Route: /admin/theme/set/:id
* Method: POST
* Description: Set the theme as active (applied site-wide). Also store active button color.
* Params: id
*/
router.post("/admin/theme/set/:id", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const selectedTheme = await theme.get(id);
    if (!selectedTheme) return res.status(404).send("Theme not found");

    // Active CSS includes background + textColor for the body
    const cssClass = `${selectedTheme.background} ${selectedTheme.textColor}`;
    await settings.set("ACTIVE_THEME", cssClass);
    // Store button/display color separately so templates can read it
    await settings.set("ACTIVE_BUTTON", selectedTheme.buttonColor);

    await audit.log(req.user, "SET_THEME", `Set theme ${selectedTheme.name} (${id}) as active`);
    res.redirect("/admin/theme?msg=THEME_SET");
  } catch (err) {
    logger.error("Error setting theme:", err);
    res.status(500).send("Failed to set theme");
  }
});

const ploxora_route = "Admin | Author: ma4z | V1"
module.exports = { router,ploxora_route };

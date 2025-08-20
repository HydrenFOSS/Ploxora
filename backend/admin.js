const router = require("express").Router();
const Logger = require("../utilities/logger");
const logger = new Logger({ prefix: "Ploxora", level: "debug" });
const Keyv = require("keyv");
const net = require("net");
const nodes = new Keyv(process.env.NODES_DB || "sqlite://nodes.sqlite");
const servers = new Keyv(process.env.SERVERS_DB || "sqlite://servers.sqlite");
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv(process.env.SESSIONS_DB || 'sqlite://sessions.sqlite');
const images = new Keyv(process.env.IMAGES_DB || "sqlite://images.sqlite");
const crypto = require("crypto");

const adminEmails = (process.env.ADMIN_USERS || "")
  .split(",")
  .map(e => e.trim().toLowerCase());

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
    return res.status(403).send("Access denied: Admins only");
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
async function ensureDefaultImage() {
  try {
    // Fetch all images
    const allImages = [];
    for await (const [key, value] of images.iterator()) {
      allImages.push(value);
    }

    // Check if Ubuntu:latest exists
    const ubuntuImage = allImages.find(
      (img) => img.name === "Ubuntu:latest with SystemCTL/SSH Tmate"
    );

    if (!ubuntuImage) {
      logger.info("Default Ubuntu:latest image not found, adding default...");

      // Fetch JSON from default URL
      const url = "https://raw.githubusercontent.com/HydrenFOSS/PloxoraImages/refs/heads/main/default.json";
      const response = await fetch(url);
      const jsonData = await response.json();

      // Add full response fields to Keyv
      const id = uuid();
      const image = {
        id,
        name: jsonData.name || "Ubuntu:latest",
        version: jsonData.version || "latest",
        image: jsonData.image || "",          // 👈 keep actual docker image string
        description: jsonData.description || "SystemCTL/SSH Tmate",
        author: jsonData.author || "HydrenFOSS",
        createdAt: new Date().toISOString(),
        sourceUrl: url                        // optional: keep track of where it came from
      };

      await images.set(id, image);
      logger.info("Default image added successfully:", image);
    } else {
      logger.info("Required image exists, no action needed.");
    }
  } catch (err) {
    logger.error("Error checking/adding default image:", err);
  }
}

ensureDefaultImage();
router.get("/admin/node/:id", requireAdmin, async (req, res) => {
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
      logger.error(`Health check failed for node ${nodeId}:`, err.message);
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
        logger.error(`Health check failed for node ${key}: ${err.message}`);
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

// ---------- Admin Nodes Page ----------
router.get("/admin/nodes", requireLogin, requireAdmin, async (req, res) => {
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
        logger.error(`Health check failed for node ${key}:`, err.message);
        status = "Offline";
      }

      // Update DB if status changed
      if (value.status !== status) {
        value.status = status;
        await nodes.set(key, value);
      }

      allNodes.push({ id: key, ...value });
    }

    res.render("admin/nodes", {
      name: process.env.APP_NAME,
      user: req.user,
      nodes: allNodes,
      req,
    });
  } catch (err) {
    logger.error("Error loading nodes:", err);
    res.status(500).send("Error loading nodes");
  }
});


// ---------- Admin Servers Page ----------
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
    
    const allImages = [];
    for await (const [key, value] of images.iterator()) {
      allImages.push({ id: key, ...value });
    }
    const allNodes = [];
    for await (const [key, value] of nodes.iterator()) {
      allNodes.push({ id: key, ...value });
    }
    res.render("admin/servers", {
      name: process.env.APP_NAME,
      user: req.user,
      servers: allServers,
      users: allUsers,
      nodes: allNodes,
      req,
      images: allImages
    });
  } catch (err) {
    res.status(500).send("Error loading servers");
  }
});
router.post("/admin/servers/create", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { name, gb, cores, userId, nodeId, imageId } = req.body;

    const node = await nodes.get(nodeId);
    if (!node) return res.status(404).send("Node not found");
    
    const image = await images.get(imageId);
    if (!image) return res.status(404).send("Image not found");

    const user = await users.get(userId);
    if (!user) return res.status(404).send("User not found");

    // Default empty servers array if none
    if (!Array.isArray(user.servers)) {
      user.servers = [];
    }

    // Deploy to node
    const deployRes = await fetch(
      `http://${node.address}:${node.port}/deploy?x-verification-key=${node.token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ram: gb, cores, name }),
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
      containerId: result.containerId,
      createdAt: new Date(),
      status: "online",
      user: userId,
      node: nodeId,
      image: imageId
    };

    // Save in user
    user.servers.push(server);
    await users.set(userId, user);

    // Save in servers db
    await servers.set(server.id, server);

    res.redirect("/admin/servers?msg=SERVER_CREATED");
  } catch (err) {
    logger.error("Error creating server:", err);
    res.status(500).send("Error creating server");
  }
});
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

    res.redirect("/admin/servers?msg=SERVER_DELETED");
  } catch (err) {
    logger.error("Error deleting server:", err);
    res.status(500).send("Error deleting server");
  }
});
router.post("/admin/nodes/delete/:id", requireLogin, requireAdmin, async (req, res) => {
  try {
    const nodeId = req.params.id;

    const node = await nodes.get(nodeId);
    if (!node) {
      return res.status(404).send("Node not found");
    }

    // Optional: Check if there are servers linked to this node
    const linkedServers = [];
    for await (const [key, value] of servers.iterator()) {
      if (value.node === nodeId) {
        linkedServers.push(key);
      }
    }

    if (linkedServers.length > 0) {
      return res.status(400).send("Cannot delete node: servers are still linked to it");
    }

    // Remove node from DB
    await nodes.delete(nodeId);

    res.redirect("/admin/nodes?msg=NODE_DELETED");
  } catch (err) {
    logger.error("Error deleting node:", err);
    res.status(500).send("Error deleting node");
  }
});

router.post("/admin/nodes/create",requireLogin, requireAdmin, async (req, res) => {
  try {
    const { name, address, port } = req.body;

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
router.get("/admin/images", requireLogin, requireAdmin, async (req, res) => {
  try {
    const allImages = [];
    for await (const [key, value] of images.iterator()) {
      allImages.push({ id: key, ...value });
    }

    res.render("admin/images", {
      name: process.env.APP_NAME,
      user: req.user,
      images: allImages,
      req,
    });
  } catch (err) {
    logger.error("Error loading images:", err);
    res.status(500).send("Error loading images");
  }
});
router.post("/admin/images/create", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).send("Missing JSON URL");

    // Fetch the JSON from the given URL
    const response = await fetch(url);
    if (!response.ok) return res.status(400).send("Invalid JSON URL");

    const data = await response.json();

    // Validate required fields inside JSON
    const { image, description, name, version, author } = data;
    if (!image || !name || !version) {
      return res.status(400).send("JSON missing required fields (image, name, version)");
    }

    const id = uuid();
    const imageEntry = {
      id,
      image,
      description: description || "",
      name,
      version,
      author: author || "CarbonLabs",
      url,
      createdAt: new Date().toISOString()
    };

    await images.set(id, imageEntry);
    res.redirect("/admin/images?msg=IMAGE_CREATED");
  } catch (err) {
    logger.error("Error creating image:", err);
    res.status(500).send("Error creating image");
  }
});

router.post("/admin/images/delete/:id", requireLogin, requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    await images.delete(id);
    res.redirect("/admin/images?msg=IMAGE_DELETED");
  } catch (err) {
    logger.error("Error deleting image:", err);
    res.status(500).send("Error deleting image");
  }
});

router.get("/admin/users", requireAdmin, requireLogin, async (req, res) => {
  try {
    const allUsers = [];
    for await (const [key, value] of users.iterator()) {
      allUsers.push({ id: key, ...value, banned: value.banned || false });
    }

    res.render("admin/users", {
      name: process.env.APP_NAME,
      users: allUsers,
      req,
      user: req.user,
    });
  } catch (err) {
    logger.error("Error fetching users:", err);
    res.status(500).send("Error loading users");
  }
});
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

// POST /admin/users/unban/:id
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
// POST /admin/users/delete/:id
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

module.exports = router;

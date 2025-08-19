const router = require("express").Router();
const Catloggr = require("cat-loggr");
const logger = new Catloggr({ prefix: "Ploxora" });
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

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.email) {
    return res.redirect("/?err=NO-USER");
  }

  const isAdmin = adminEmails.includes(req.user.email.toLowerCase());
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
      const jsonData = await response.json(); // <- fix here

      // Add image to Keyv
      const id = crypto.randomBytes(4).toString("hex");
      const image = {
        id,
        name: jsonData.name || "Ubuntu:latest",
        version: jsonData.version || "latest",
        url: url,
        description: jsonData.description || "SystemCTL/SSH Tmate",
        author: jsonData.author || "HydrenFOSS",
        createdAt: new Date().toISOString(),
      };

      await images.set(id, image);
      logger.info("Default image added successfully.");
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
      nodes: allNodes
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
      allUsers.push({ id: key, ...value });
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
      nodes: allNodes
    });
  } catch (err) {
    res.status(500).send("Error loading servers");
  }
});
router.post("/admin/servers/create", requireLogin, requireAdmin, async (req, res) => {
  try {
    const { name, gb, cores, userId, nodeId } = req.body;

    const node = await nodes.get(nodeId);
    if (!node) return res.status(404).send("Node not found");

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
      id: crypto.randomBytes(4).toString("hex"),
      name,
      ssh: result.ssh,
      containerId: result.containerId,
      createdAt: new Date(),
      status: "online",
      user: userId,
      node: nodeId,
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
      images: allImages
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

    const id = crypto.randomBytes(4).toString("hex");
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
module.exports = router;

const router = require("express").Router();
const Keyv = require("keyv");
const net = require("net");
const nodes = new Keyv(process.env.NODES_DB || "sqlite://nodes.sqlite");
const servers = new Keyv(process.env.SERVERS_DB || "sqlite://servers.sqlite");
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv(process.env.SESSIONS_DB || 'sqlite://sessions.sqlite');
const crypto = require("crypto");

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
    console.error("Auth error:", err);
    res.redirect("/?err=AUTH-FAILED");
  }
}
router.get("/admin/node/:id", async (req, res) => {
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
      console.error(`Health check failed for node ${nodeId}:`, err.message);
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
    console.error("Error loading node details:", err);
    res.status(500).json({ error: "Error loading node details" });
  }
});
// ---------- Admin Nodes Page ----------
router.get("/admin/nodes", requireLogin, async (req, res) => {
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
        console.error(`Health check failed for node ${key}:`, err.message);
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
    console.error("Error loading nodes:", err);
    res.status(500).send("Error loading nodes");
  }
});


// ---------- Admin Servers Page ----------
router.get("/admin/servers", requireLogin, async (req, res) => {
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
router.post("/admin/servers/create", requireLogin, async (req, res) => {
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
        body: JSON.stringify({ ram: gb, cores }),
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
    console.error("Error creating server:", err);
    res.status(500).send("Error creating server");
  }
});
router.post("/admin/nodes/create", async (req, res) => {
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
      console.error("Location lookup failed:", err.message);
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
    console.error("Error creating node:", error);
    res.redirect("/admin/nodes?err=FAILED-CREATE");
  }
});
module.exports = router;

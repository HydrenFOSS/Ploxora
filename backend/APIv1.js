const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const Logger = require("../utilities/logger");
const logger = new Logger({ prefix: "PloxoraAPI", level: "debug" });
const bcrypt = require("bcrypt");
const { nodes, servers, users, nestbits } = require('../utilities/db');
const AuditLogger = require("../utilities/al");
const audit = new AuditLogger();

const API_KEY = process.env.API_KEY;

// Middleware: Check API Key
function checkApiKey(req, res, next) {
  const key = req.query["x-api-key"];
  if (!key || key !== API_KEY) return res.status(403).json({ error: "Invalid API Key" });
  next();
}

// UUID generator
function uuid() {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return (
    hex.slice(0, 8) +
    "-" +
    hex.slice(8, 12) +
    "-" +
    hex.slice(12, 16) +
    "-" +
    hex.slice(16, 20) +
    "-" +
    hex.slice(20)
  );
}

// ----------------- LIST ENDPOINTS -----------------

// List all nodes
router.get("/api/v1/list/nodes", checkApiKey, async (req, res) => {
  try {
    const allNodes = [];
    for await (const [key, value] of nodes.iterator()) {
      allNodes.push({ id: key, ...value });
    }
    res.json({ success: true, nodes: allNodes });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch nodes" });
  }
});

// List all servers
router.get("/api/v1/list/servers", checkApiKey, async (req, res) => {
  try {
    const allServers = [];
    for await (const [key, value] of servers.iterator()) {
      allServers.push({ id: key, ...value });
    }
    res.json({ success: true, servers: allServers });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch servers" });
  }
});

// List all users
router.get("/api/v1/list/users", checkApiKey, async (req, res) => {
  try {
    const allUsers = [];
    for await (const [key, value] of users.iterator()) {
      allUsers.push({ id: key, ...value, banned: value.banned || false });
    }
    res.json({ success: true, users: allUsers });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// List all NestBits
router.get("/api/v1/list/nestbits", checkApiKey, async (req, res) => {
  try {
    const allNestBits = [];
    for await (const [key, value] of nestbits.iterator()) {
      allNestBits.push({ id: key, ...value });
    }
    res.json({ success: true, nestbits: allNestBits });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch NestBits" });
  }
});

// ----------------- NODES -----------------

// Create new node
router.post("/api/v1/nodes/new", checkApiKey, express.json(), async (req, res) => {
  try {
    const { name, address, port, ram, cores, protocol = "http", portEnabled = true } = req.body;

    const id = Math.random().toString(36).substring(2, 10);
    const token = Math.random().toString(36).substring(2, 20);

    let location = "UNKNOWN";
    try {
      const response = await fetch(`http://ip-api.com/json/${address}`);
      const data = await response.json();
      if (data && data.countryCode) location = data.countryCode;
    } catch {}

    const node = {
      id,
      token,
      name,
      address,
      port: portEnabled ? port : null,
      ram,
      cores,
      protocol: ["http", "https"].includes(protocol) ? protocol : "http",
      portEnabled,
      allocations: [],
      status: "Offline",
      location,
      createdAt: new Date().toISOString()
    };

    await nodes.set(id, node);
    await audit.log({ username: "API" }, "CREATE_NODE", `Created node ${node.name} (${node.id})`);

    res.json({ success: true, node });
  } catch (err) {
    res.status(500).json({ error: "Failed to create node" });
  }
});

// Delete node
router.post("/api/v1/nodes/delete", checkApiKey, express.json(), async (req, res) => {
  try {
    const { nodeId } = req.body;

    const linkedServers = [];
    for await (const [key, value] of servers.iterator()) {
      if (value.node === nodeId) linkedServers.push(key);
    }

    if (linkedServers.length > 0)
      return res.status(400).json({ error: "Cannot delete node: servers linked" });

    await nodes.delete(nodeId);
    await audit.log({ username: "API" }, "DELETE_NODE", `Deleted node ${nodeId}`);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete node" });
  }
});

// Add allocations to a node
router.post("/api/v1/nodes/:id/allocations/add", checkApiKey, express.json(), async (req, res) => {
  try {
    const nodeId = req.params.id;
    const { portRange, domain, ip } = req.body;

    const node = await nodes.get(nodeId);
    if (!node) return res.status(404).json({ error: "Node not found" });

    let ports = [];
    if (portRange.includes("-")) {
      const [start, end] = portRange.split("-").map(Number);
      if (isNaN(start) || isNaN(end) || start > end) return res.status(400).json({ error: "Invalid port range" });
      for (let p = start; p <= end; p++) ports.push(p);
    } else {
      const p = parseInt(portRange, 10);
      if (isNaN(p)) return res.status(400).json({ error: "Invalid port" });
      ports.push(p);
    }

    if (!Array.isArray(node.allocations)) node.allocations = [];
    for (const port of ports) {
      node.allocations.push({ name: `alloc-${port}`, allocation_port: port, domain: domain || null, ip: ip || null, isBeingUsed: false, createdAt: new Date().toISOString() });
    }

    await nodes.set(nodeId, node);
    await audit.log({ username: "API" }, "ADD_ALLOCATIONS", `Added allocations ${ports.join(", ")} to node ${nodeId}`);

    res.json({ success: true, allocations: node.allocations });
  } catch (err) {
    res.status(500).json({ error: "Failed to add allocations" });
  }
});

// ----------------- SERVERS -----------------

// Deploy server
router.post("/api/v1/servers/deploy", checkApiKey, express.json(), async (req, res) => {
  try {
    const { name, gb, cores, userId, nodeId, allocationId, nestbitId } = req.body;

    const node = await nodes.get(nodeId);
    if (!node) return res.status(404).json({ error: "Node not found" });

    const nestbit = await nestbits.get(nestbitId);
    if (!nestbit) return res.status(404).json({ error: "NestBit not found" });

    const port = parseInt(allocationId, 10);
    const allocation = node.allocations.find(a => a.allocation_port === port && !a.isBeingUsed);
    if (!allocation) return res.status(400).json({ error: "Invalid allocation or is being used" });

    const user = await users.get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });
    if (!Array.isArray(user.servers)) user.servers = [];

    const deployRes = await fetch(
      `http://${node.address}:${node.port}/deploy?x-verification-key=${node.token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ram: gb,
          cores,
          name,
          port: allocation.allocation_port,
          nbimg: nestbit.dockerimage
        })
      }
    );

    const result = await deployRes.json();
    if (!deployRes.ok) return res.status(500).json({ error: result.message || "Failed to deploy server" });

    const server = {
      id: uuid(),
      name,
      ssh: `ssh root@${allocation.domain || allocation.ip} -p ${allocation.allocation_port}`,
      containerId: result.containerId,
      createdAt: new Date(),
      status: "online",
      user: userId,
      node: nodeId,
      allocation: { domain: allocation.domain, ip: allocation.ip, port: allocation.allocation_port },
      nestbit
    };

    allocation.isBeingUsed = true;
    user.servers.push(server);

    await users.set(userId, user);
    await servers.set(server.id, server);
    await nodes.set(nodeId, node);
    await audit.log({ username: "API" }, "DEPLOY_SERVER", `Deployed server ${server.name} (${server.id})`);

    res.json({ success: true, server });
  } catch (err) {
    res.status(500).json({ error: "Failed to deploy server" });
  }
});

// Delete server
router.post("/api/v1/servers/delete", checkApiKey, express.json(), async (req, res) => {
  try {
    const { serverId } = req.body;
    const server = await servers.get(serverId);
    if (!server) return res.status(404).json({ error: "Server not found" });

    const node = await nodes.get(server.node);
    if (node) {
      try {
        await fetch(
          `http://${node.address}:${node.port}/vps/delete?x-verification-key=${node.token}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ containerId: server.containerId }) }
        );
      } catch {}
    }

    const user = await users.get(server.user);
    if (user && Array.isArray(user.servers)) {
      user.servers = user.servers.filter(s => s.id !== serverId);
      await users.set(server.user, user);
    }

    await servers.delete(serverId);
    await audit.log({ username: "API" }, "DELETE_SERVER", `Deleted server ${server.name} (${serverId})`);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete server" });
  }
});

// ----------------- USERS -----------------

// Create user
router.post("/api/v1/users/new", checkApiKey, express.json(), async (req, res) => {
  try {
    const { username, email, password, admin = false } = req.body;
    if (!username || !email || !password) return res.status(400).json({ error: "Missing fields" });

    for await (const [id, user] of users.iterator()) {
      if (user.email && user.email.toLowerCase() === email.toLowerCase()) return res.status(409).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const id = uuid();

    const newUser = { id, username, email, password: hashedPassword, profilePicture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(username)}`, admin: Boolean(admin), servers: [] };

    await users.set(id, newUser);
    await audit.log({ username: "API" }, "CREATE_USER", `Created user ${username} (${id})`);

    res.status(201).json({ success: true, user: { id, username, email, admin } });
  } catch (err) {
    res.status(500).json({ error: "Failed to create user" });
  }
});

// Ban user
router.post("/api/v1/users/ban", checkApiKey, express.json(), async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await users.get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.banned = true;
    await users.set(userId, user);
    await audit.log({ username: "API" }, "BAN_USER", `Banned user ${user.username} (${userId})`);

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: "Failed to ban user" });
  }
});

// Unban user
router.post("/api/v1/users/unban", checkApiKey, express.json(), async (req, res) => {
  try {
    const { userId } = req.body;
    const user = await users.get(userId);
    if (!user) return res.status(404).json({ error: "User not found" });

    user.banned = false;
    await users.set(userId, user);
    await audit.log({ username: "API" }, "UNBAN_USER", `Unbanned user ${user.username} (${userId})`);

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: "Failed to unban user" });
  }
});

// Delete user
router.post("/api/v1/users/delete", checkApiKey, express.json(), async (req, res) => {
  try {
    const { userId } = req.body;
    await users.delete(userId);
    await audit.log({ username: "API" }, "DELETE_USER", `Deleted user ${userId}`);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});

const ploxora_route = "API | Author: ma4z | V1"
module.exports = { router,ploxora_route };

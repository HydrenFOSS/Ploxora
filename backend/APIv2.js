// routes/api/v2.js
const express = require("express");
const router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const Keyv = require("keyv");
require("dotenv").config();

const Logger = require("../utilities/logger");
const addonManager = require("../addons/addon_manager");
const logger = new Logger({ prefix: "Ploxora-APIv2", level: "debug" });

const nodes = new Keyv(process.env.NODES_DB || "sqlite://nodes.sqlite");
const servers = new Keyv(process.env.SERVERS_DB || "sqlite://servers.sqlite");
const settings = new Keyv(process.env.SETTINGS_DB || "sqlite://settings.sqlite");
const users = new Keyv(process.env.USERS_DB || "sqlite://users.sqlite");

const API_KEY = process.env.API_KEY;

// ---------- Middleware ----------
function checkApiKey(req, res, next) {
  const key = req.query["x-api-key"];
  if (!key || key !== API_KEY) return res.status(403).json({ error: "INVALID_API_KEY" });
  next();
}

// ---------- Utils ----------
function uuid() {
  const bytes = crypto.randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function getAppName() {
  return await settings.get("NAME") || "Ploxora";
}

// ---------- Multer for logo uploads ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = path.join(__dirname, "../public/uploads");
    if (!fs.existsSync(uploadPath)) fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => cb(null, `logo${path.extname(file.originalname)}`)
});
const upload = multer({ storage });

// ---------- App Info ----------
router.get("/api/v2/info", checkApiKey, async (req, res) => {
  const name = await getAppName();
  res.json({ success: true, name, version: require("../package.json").version, addons: addonManager.loadedAddons });
});

// ---------- Settings ----------
router.get("/api/v2/settings", checkApiKey, async (req, res) => {
  const allSettings = {};
  for await (const [key, value] of settings.iterator()) {
    if (key !== "__initialized__") allSettings[key] = value;
  }
  res.json({ success: true, settings: allSettings });
});

router.post("/api/v2/settings/update", checkApiKey, express.json(), async (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: "Missing key" });
  await settings.set(key, value);
  res.json({ success: true, key, value });
});

router.post("/api/v2/settings/upload-logo", checkApiKey, upload.single("Logo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });
  const logoPath = `/uploads/logo${path.extname(req.file.originalname)}`;
  await settings.set("Logo", logoPath);
  res.json({ success: true, logoUrl: logoPath });
});

// ---------- Nodes ----------
router.get("/api/v2/nodes", checkApiKey, async (req, res) => {
  const allNodes = [];
  for await (const [id, node] of nodes.iterator()) {
    allNodes.push({ id, ...node });
  }
  res.json({ success: true, nodes: allNodes });
});

router.get("/api/v2/nodes/:id", checkApiKey, async (req, res) => {
  const node = await nodes.get(req.params.id);
  if (!node) return res.status(404).json({ error: "NODE_NOT_FOUND" });
  res.json({ success: true, node });
});

router.post("/api/v2/nodes/create", checkApiKey, express.json(), async (req, res) => {
  const { name, address, port } = req.body;
  if (!name || !address || !port) return res.status(400).json({ error: "Missing fields" });

  const id = uuid();
  const token = crypto.randomBytes(12).toString("hex");

  const node = { id, name, address, port, token, status: "Offline", createdAt: new Date().toISOString() };
  await nodes.set(id, node);
  res.json({ success: true, node });
});

router.post("/api/v2/nodes/delete/:id", checkApiKey, async (req, res) => {
  const node = await nodes.get(req.params.id);
  if (!node) return res.status(404).json({ error: "NODE_NOT_FOUND" });

  // Delete all servers on this node
  for await (const [id, server] of servers.iterator()) {
    if (server.node === node.id) await servers.delete(id);
  }
  await nodes.delete(req.params.id);
  res.json({ success: true, message: "Node and linked servers deleted" });
});

router.get("/api/v2/nodes/:id/docker-usage", checkApiKey, async (req, res) => {
  const node = await nodes.get(req.params.id);
  if (!node) return res.status(404).json({ error: "NODE_NOT_FOUND" });

  try {
    const response = await fetch(`http://${node.address}:${node.port}/docker-usage?x-verification-key=${node.token}`);
    const data = await response.json();
    res.json({ success: true, usage: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch Docker usage", details: err.message });
  }
});

// ---------- Users ----------
router.get("/api/v2/users", checkApiKey, async (req, res) => {
  const allUsers = [];
  for await (const [id, user] of users.iterator()) allUsers.push({ id, ...user, banned: user.banned || false });
  res.json({ success: true, users: allUsers });
});

router.post("/api/v2/users/ban/:id", checkApiKey, async (req, res) => {
  const user = await users.get(req.params.id);
  if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
  user.banned = true;
  await users.set(req.params.id, user);
  res.json({ success: true, user });
});

router.post("/api/v2/users/unban/:id", checkApiKey, async (req, res) => {
  const user = await users.get(req.params.id);
  if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });
  user.banned = false;
  await users.set(req.params.id, user);
  res.json({ success: true, user });
});

router.post("/api/v2/users/delete/:id", checkApiKey, async (req, res) => {
  await users.delete(req.params.id);
  res.json({ success: true, message: "User deleted" });
});

// ---------- Servers ----------
router.get("/api/v2/servers", checkApiKey, async (req, res) => {
  const allServers = [];
  for await (const [id, server] of servers.iterator()) allServers.push({ id, ...server });
  res.json({ success: true, servers: allServers });
});

router.post("/api/v2/servers/create", checkApiKey, express.json(), async (req, res) => {
  const { name, userId, nodeId, gb, cores } = req.body;
  if (!name || !userId || !nodeId) return res.status(400).json({ error: "Missing fields" });

  const node = await nodes.get(nodeId);
  if (!node) return res.status(404).json({ error: "NODE_NOT_FOUND" });

  const user = await users.get(userId);
  if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

  // Deploy container on node
  const deployResp = await fetch(`http://${node.address}:${node.port}/deploy?x-verification-key=${node.token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ram: gb, cores }),
  });
  const deployData = await deployResp.json();
  if (!deployResp.ok) return res.status(500).json({ error: "Failed to deploy", details: deployData });

  const server = {
    id: uuid(),
    name,
    containerId: deployData.containerId,
    ssh: deployData.ssh,
    user: userId,
    node: nodeId,
    status: "online",
    createdAt: new Date().toISOString()
  };

  user.servers = user.servers || [];
  user.servers.push(server);
  await users.set(userId, user);
  await servers.set(server.id, server);

  res.json({ success: true, server });
});

router.post("/api/v2/servers/delete/:id", checkApiKey, async (req, res) => {
  const server = await servers.get(req.params.id);
  if (!server) return res.status(404).json({ error: "SERVER_NOT_FOUND" });

  const node = await nodes.get(server.node);
  if (node) {
    try {
      await fetch(`http://${node.address}:${node.port}/vps/delete?x-verification-key=${node.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ containerId: server.containerId }),
      });
    } catch {}
  }

  const user = await users.get(server.user);
  if (user && Array.isArray(user.servers)) {
    user.servers = user.servers.filter(s => s.id !== server.id);
    await users.set(user.id, user);
  }

  await servers.delete(server.id);
  res.json({ success: true, message: "Server deleted" });
});

// Server actions: start/stop/restart
router.post("/api/v2/server/action/:containerId/:action", checkApiKey, async (req, res) => {
  const { containerId, action } = req.params;
  const allowed = ["start", "stop", "restart"];
  if (!allowed.includes(action)) return res.status(400).json({ error: "Invalid action" });

  let serverFound = null;
  for await (const [id, server] of servers.iterator()) {
    if (server.containerId === containerId) {
      serverFound = server;
      break;
    }
  }
  if (!serverFound) return res.status(404).json({ error: "Server not found" });

  const node = await nodes.get(serverFound.node);
  if (!node) return res.status(500).json({ error: "Node not found" });

  try {
    await fetch(`http://${node.address}:${node.port}/action/${action}/${containerId}?x-verification-key=${node.token}`, { method: "POST" });
    res.json({ success: true, containerId, action });
  } catch (err) {
    res.status(500).json({ error: "Node request failed", details: err.message });
  }
});

// --------------------------- VPS Stats & SSH ---------------------------
async function getServerByContainerId(containerId) {
  for await (const [id, server] of servers.iterator()) {
    if (server.containerId === containerId) return { id, server };
  }
  return null;
}

// Get VPS info
router.get("/api/v2/server/:containerId", checkApiKey, async (req, res) => {
  const { containerId } = req.params;
  const result = await getServerByContainerId(containerId);
  if (!result) return res.status(404).json({ error: "Server not found" });

  res.json({ success: true, server: result.server });
});

// VPS stats
router.get("/api/v2/server/:containerId/stats", checkApiKey, async (req, res) => {
  try {
    const { containerId } = req.params;
    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { server } = result;
    const node = await nodes.get(server.node);
    if (!node) return res.status(500).json({ error: "Node not found" });

    const response = await fetch(
      `http://${node.address}:${node.port}/stats/${containerId}?x-verification-key=${node.token}`
    );
    if (!response.ok) {
      const text = await response.text();
      return res.status(response.status).json({ error: "Failed to fetch stats", details: text });
    }

    const data = await response.json();
    res.json({ success: true, stats: data });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats", details: err.message });
  }
});

// VPS SSH info (ressh)
router.post("/api/v2/server/:containerId/ressh", checkApiKey, async (req, res) => {
  try {
    const { containerId } = req.params;
    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { id: serverId, server } = result;
    const node = await nodes.get(server.node);
    if (!node) return res.status(500).json({ error: "Node not found" });

    // Request SSH info from node
    const sshResp = await fetch(
      `http://${node.address}:${node.port}/ressh?x-verification-key=${node.token}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ containerId }) }
    );

    if (!sshResp.ok) {
      const text = await sshResp.text();
      return res.status(sshResp.status).json({ error: "Node request failed", details: text });
    }

    let sshData = { ssh: "N/A" };
    const rawText = await sshResp.text();
    if (rawText) {
      try {
        sshData = JSON.parse(rawText);
      } catch {
        sshData = { ssh: rawText };
      }
    }

    // Update DB
    server.ssh = sshData.ssh || "N/A";
    await servers.set(serverId, server);

    res.json({ success: true, containerId, ssh: server.ssh });
  } catch (err) {
    res.status(500).json({ error: "Failed to get SSH info", details: err.message });
  }
});

const ploxora_route = "API | Author: ma4z | V2"
module.exports = { router,ploxora_route };

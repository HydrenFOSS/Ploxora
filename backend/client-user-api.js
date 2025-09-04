/*
|--------------------------------------------------------------------------
| Ploxora Client API - VPS Management
| Author: ma4z
| Version: v1
|--------------------------------------------------------------------------
| Exposes VPS-related routes (stats, actions, SSH regen) secured with 
| Client API keys instead of user login sessions.
|--------------------------------------------------------------------------
*/
const router = require("express").Router();
const Keyv = require("keyv");
require("dotenv").config();
const Logger = require("../utilities/logger");
const { CheckClientAPI } = require("../utilities/cv");

// DBs
const users = new Keyv(process.env.USERS_DB || "sqlite://users.sqlite");
const serversDB = new Keyv(process.env.SERVERS_DB || "sqlite://servers.sqlite");
const nodes = new Keyv(process.env.NODES_DB || "sqlite://nodes.sqlite");

// Logger
const logger = new Logger({ prefix: "Ploxora-ClientAPI-VPS", level: "debug" });

/*
* Helper: getServerByContainerId(containerId)
*/
async function getServerByContainerId(containerId) {
  try {
    for await (const [id, server] of serversDB.iterator()) {
      if (server?.containerId === containerId) return { id, server };
    }
    return null;
  } catch (err) {
    logger.error("[getServerByContainerId] DB iteration failed:", err);
    throw err;
  }
}

/*
* Route: GET /clientapi/vps/list
* Description: List all VPS servers belonging to the API key owner.
* Security: Uses Client API key validation instead of login sessions.
* Returns: Array of server objects from serversDB (with fallback to user.servers).
* Version: v1.0.0
*/
router.get("/clientapi/vps/list", CheckClientAPI, async (req, res) => {
  try {
    const user = req.user;

    if (!user.servers || user.servers.length === 0) {
      return res.json({ servers: [], message: "No VPS servers found" });
    }

    const detailedServers = [];
    for (const s of user.servers) {
      const stored = await serversDB.get(s.id);
      if (stored) {
        detailedServers.push(stored);
      } else {
        detailedServers.push(s); // fallback if missing in serversDB
      }
    }

    res.json({ servers: detailedServers });
  } catch (err) {
    logger.error("[List] Unexpected error:", err);
    res.status(500).json({ error: "Failed to fetch VPS list", details: err.message });
  }
});
/*
* Route: GET /clientapi/server/stats/:containerId
*/
router.get("/clientapi/server/stats/:containerId", CheckClientAPI, async (req, res) => {
  const { containerId } = req.params;
  const user = req.user;

  try {
    const server = user.servers?.find(s => s.containerId === containerId);
    if (!server) {
      logger.warn(`[Stats] User ${user.id} tried accessing unauthorized server ${containerId}`);
      return res.status(403).json({ error: "Not allowed" });
    }

    const node = await nodes.get(server.node);
    if (!node) {
      logger.error("[Stats] Node not found for server:", server);
      return res.status(500).json({ error: "Node not found" });
    }

    const response = await fetch(
      `http://${node.address}:${node.port}/stats/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error(`[Stats] Node responded with ${response.status}: ${text}`);
      return res.status(response.status).json({ error: "Failed to fetch from node", details: text });
    }

    const data = await response.json();
    res.json(data);
  } catch (err) {
    logger.error("[Stats] Unexpected error:", err);
    res.status(500).json({ error: "Failed to fetch stats", details: err.message });
  }
});

/*
* Route: POST /clientapi/vps/action/:containerId/:action
*/
router.post("/clientapi/vps/action/:containerId/:action", CheckClientAPI, async (req, res) => {
  try {
    const { containerId, action } = req.params;
    const user = req.user;
    const allowedActions = ["start", "stop", "restart"];

    if (!allowedActions.includes(action)) {
      logger.warn(`[Action] Invalid action requested: ${action}`);
      return res.status(400).json({ error: "Invalid action. allowed: start, stop, restart" });
    }

    const result = await getServerByContainerId(containerId);
    if (!result) {
      logger.warn(`[Action] Server not found: ${containerId}`);
      return res.status(404).json({ error: "Server not found" });
    }

    const { id: serverId, server } = result;
    if (!user.servers?.some(s => s.id === serverId)) {
      logger.warn(`[Action] User ${user.id} unauthorized for server ${containerId}`);
      return res.status(403).json({ error: "Access denied" });
    }

    const node = await nodes.get(server.node);
    if (!node) {
      logger.error("[Action] Node not found:", server.node);
      return res.status(500).json({ error: "Node not found" });
    }

    const response = await fetch(
      `http://${node.address}:${node.port}/action/${action}/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`,
      { method: "POST" }
    );

    if (!response.ok) {
      const text = await response.text();
      logger.error(`[Action] Node request failed (${response.status}): ${text}`);
      return res.status(response.status).json({ error: "Node request failed", details: text });
    }

    res.json({ containerId, action, message: `Container ${action}ed successfully` });
  } catch (err) {
    logger.error("[Action] Unexpected error:", err);
    res.status(500).json({ error: "Failed to perform action", details: err.message });
  }
});

/*
* Route: POST /clientapi/vps/ressh/:containerId
*/
router.post("/clientapi/vps/ressh/:containerId", CheckClientAPI, async (req, res) => {
  try {
    const { containerId } = req.params;
    const user = req.user;

    const result = await getServerByContainerId(containerId);
    if (!result) {
      logger.warn(`[Ressh] Server not found: ${containerId}`);
      return res.status(404).json({ error: "Server not found" });
    }

    const { id: serverId, server } = result;
    if (!user.servers?.some(s => s.id === serverId)) {
      logger.warn(`[Ressh] User ${user.id} unauthorized for server ${containerId}`);
      return res.status(403).json({ error: "Access denied" });
    }

    const node = await nodes.get(server.node);
    if (!node) {
      logger.error("[Ressh] Node not found:", server.node);
      return res.status(500).json({ error: "Node not found" });
    }

    // Check container status
    const statusResp = await fetch(
      `http://${node.address}:${node.port}/stats/${containerId}?x-verification-key=${encodeURIComponent(node.token)}`
    );
    if (!statusResp.ok) {
      const text = await statusResp.text();
      logger.error(`[Ressh] Failed to fetch container status (${statusResp.status}): ${text}`);
      return res.status(statusResp.status).json({ error: "Failed to fetch container status", details: text });
    }
    await statusResp.json();

    // Regenerate SSH
    let sshData = { ssh: "N/A" };
    try {
      const sshResp = await fetch(
        `http://${node.address}:${node.port}/ressh?x-verification-key=${encodeURIComponent(node.token)}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ containerId }) }
      );

      if (!sshResp.ok) {
        const text = await sshResp.text();
        logger.error(`[Ressh] Node request failed (${sshResp.status}): ${text}`);
        return res.status(sshResp.status).json({ error: "Node request failed", details: text });
      }

      const rawText = await sshResp.text();
      try {
        sshData = rawText ? JSON.parse(rawText) : { ssh: "N/A" };
      } catch (e) {
        logger.warn("[Ressh] SSH response not JSON, using raw text");
        sshData = { ssh: rawText };
      }
    } catch (e) {
      logger.error("[Ressh] Fetch error:", e);
      return res.status(500).json({ error: "Node request failed", details: e.message });
    }

    // Update DBs
    server.ssh = sshData.ssh || "N/A";
    await serversDB.set(serverId, server);

    const userServer = user.servers.find(s => s.id === serverId);
    if (userServer) userServer.ssh = server.ssh;
    await users.set(user.id, user);

    res.json({ containerId, action: "ressh", ssh: server.ssh, message: "SSH info updated successfully" });
  } catch (err) {
    logger.error("[Ressh] Unexpected error:", err);
    res.status(500).json({ error: "Failed to regenerate SSH", details: err.message });
  }
});
/*
* Route: GET /clientapi/vps/:containerId
* Description: Fetch VPS info for a specific container.
* Security: API key required.
*/
router.get("/clientapi/vps/:containerId", CheckClientAPI, async (req, res) => {
  try {
    const { containerId } = req.params;
    const user = req.user;

    const server = user.servers?.find(s => s.containerId === containerId);
    if (!server) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json({ server });
  } catch (err) {
    logger.error("[VPS Info] error:", err);
    res.status(500).json({ error: "Failed to fetch VPS info", details: err.message });
  }
});

/*
* Route: GET /clientapi/vps/:containerId/network
* Description: Get network allocations for a VPS.
*/
router.get("/clientapi/vps/:containerId/network", CheckClientAPI, async (req, res) => {
  try {
    const { containerId } = req.params;
    const user = req.user;

    const server = user.servers?.find(s => s.containerId === containerId);
    if (!server) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json({ allocations: server.allocations || [] });
  } catch (err) {
    logger.error("[VPS Network] error:", err);
    res.status(500).json({ error: "Failed to fetch network allocations", details: err.message });
  }
});

/*
* Route: POST /clientapi/vps/:containerId/edit-name
* Description: Update VPS name.
*/
router.post("/clientapi/vps/:containerId/edit-name", CheckClientAPI, async (req, res) => {
  try {
    const { containerId } = req.params;
    const { name } = req.body;
    const user = req.user;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({ error: "Invalid name" });
    }

    const result = await getServerByContainerId(containerId);
    if (!result) return res.status(404).json({ error: "Server not found" });

    const { id: serverId, server } = result;
    if (!user.servers?.some(s => s.id === serverId)) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Update in DBs
    server.name = name.trim();
    await serversDB.set(serverId, server);

    const userServer = user.servers.find(s => s.id === serverId);
    if (userServer) userServer.name = server.name;
    await users.set(user.id, user);

    res.json({ containerId, name: server.name, message: "Server name updated successfully" });
  } catch (err) {
    logger.error("[Edit Name] error:", err);
    res.status(500).json({ error: "Failed to update server name", details: err.message });
  }
});

const ploxora_route = "ClientAPI | Author: ma4z | V3";
module.exports = { router, ploxora_route };

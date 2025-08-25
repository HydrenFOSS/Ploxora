const axios = require("axios");
const Logger = require("./logger");
const logger = new Logger({ prefix: "Ploxora", level: "debug" });
const settings = new (require("keyv"))(process.env.SETTINGS_DB || "sqlite://settings.sqlite");

/**
 * Logs a message to Discord via webhook if logging is enabled
 * @param {string} message - The message content
 * @param {"info"|"warn"|"error"|"debug"} [level="info"] - Log level
 */
async function logDiscord(message, level = "info") {
  try {
    const isLog = await settings.get("IsLogs");
    const webhookUrl = await settings.get("ifisLogs");

    if (!isLog || !webhookUrl) return; 

    // Prepare Discord embed
    const payload = {
      embeds: [
        {
          title: `Ploxora Log: ${level.toUpperCase()}`,
          description: message,
          color:
            level === "error" ? 0xff0000 :
            level === "warn" ? 0xffa500 :
            level === "debug" ? 0x808080 :
            0x00ff00,
          timestamp: new Date(),
        },
      ],
    };

    // Send to Discord via Axios
    await axios.post(webhookUrl, payload, {
      headers: { "Content-Type": "application/json" },
    });

    // Also log locally
    switch (level.toLowerCase()) {
      case "debug": logger.debug(message); break;
      case "warn": logger.warn(message); break;
      case "error": logger.error(message); break;
      default: logger.info(message); break;
    }
  } catch (err) {
    console.error("Failed to send Discord log:", err.message);
  }
}

module.exports = logDiscord;

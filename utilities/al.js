const fs = require("fs");
const path = require("path");

class AuditLogger {
  constructor(options = {}) {
    this.filePath = options.filePath || path.join(__dirname, "../logs/audit.log");
    if (!fs.existsSync(path.dirname(this.filePath))) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    }
  }

  async log(adminUser, action, details = "") {
    const entry = {
      timestamp: new Date().toISOString(),
      admin: adminUser.username || adminUser.email || "unknown",
      action,
      details,
    };
    const line = JSON.stringify(entry) + "\n";
    fs.appendFile(this.filePath, line, err => {
      if (err) console.error("Failed to write audit log:", err);
    });
  }

  async getLogs() {
    try {
      if (!fs.existsSync(this.filePath)) return [];
      const data = fs.readFileSync(this.filePath, "utf-8")
        .split("\n")
        .filter(Boolean)
        .map(line => JSON.parse(line));
      return data;
    } catch (err) {
      console.error("Failed to read audit logs:", err);
      return [];
    }
  }
}

module.exports = AuditLogger;
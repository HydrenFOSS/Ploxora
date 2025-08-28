const Logger = require("../../utilities/logger");
const logger = new Logger({ prefix: "ExamplePlugin", level: "debug" });
module.exports = {
  init: function () {
    logger.init("✅ Example Plugin initialized!");
  }
};

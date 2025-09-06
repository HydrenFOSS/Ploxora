const { users } = require("../utilities/db");

/*
* Middleware: CheckClientAPI
* Validates requests using API key in headers or query.
* Attaches user if valid.
*/
async function CheckClientAPI(req, res, next) {
  try {
    const apiKey = req.headers["x-client-key"] || req.query["x-client-key"];
    if (!apiKey) return res.status(401).json({ error: "Missing API key" });

    let owner = null;
    for await (const [id, user] of users.iterator()) {
      if (user.clientAPIs?.some(api => api.key === apiKey)) {
        owner = user;
        break;
      }
    }

    if (!owner) return res.status(403).json({ error: "Invalid API key" });

    req.user = owner;
   // req.apiKey = apiKey; ill use this shit later on
    next();
  } catch (err) {
    logger.error("CheckClientAPI error:", err);
    res.status(500).json({ error: "Internal error validating API key" });
  }
};

module.exports = { CheckClientAPI };
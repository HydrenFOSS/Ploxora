require("dotenv").config();
const fs = require("fs");
const express = require("express");
const app = express();
const path = require("path");
const Keyv = require("keyv");
const cookieParser = require("cookie-parser");
const Logger = require("./utilities/logger");
const { minify } = require("html-minifier-terser");
const logger = new Logger({ prefix: "Ploxora", level: "debug" });
const settings = new Keyv(process.env.SETTINGS_DB || "sqlite://settings.sqlite");
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/frontend"));
app.use(express.static(path.join(__dirname, "public")));
app.use((req, res, next) => {
  const originalRender = res.render;

  res.render = function (view, options = {}, callback) {
    originalRender.call(this, view, options, async (err, html) => {
      if (err) {
        return originalRender.call(
          res,
          "500",
          {
            ...options,
            err: process.env.NODE_ENV === "development" ? (err.stack || err.message) : null
          },
          (fallbackErr, errorHtml) => {
            if (fallbackErr) {
              return res.status(500).send("Render Error: " + fallbackErr);
            }
            res.status(500).send(errorHtml);
          }
        );
      }

      try {
        const minified = await minify(html, {
          collapseWhitespace: true,
          removeComments: true,
          minifyCSS: true,
          minifyJS: true,
        });
        res.send(minified);
      } catch (e) {
        res.send(html);
      }
    });
  };

  next();
});

// Middleware to add custom header
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "Hydren || Ploxora");
  next();
});
app.use(cookieParser());
async function ensureDefaultSettings() {
  const defaultSettings = {
    NAME: process.env.APP_NAME || "Ploxora",
    IsLogs: false,
    ifisLogs: "",
    Logo: ""
  };

  // Only set missing keys
  for (const key in defaultSettings) {
    const existing = await settings.get(key);
    if (existing === undefined || existing === null) {
      await settings.set(key, defaultSettings[key]);
    }
  }
}
ensureDefaultSettings().catch(err => console.error("Failed to initialize settings:", err));
async function getAppName() {
  const appName = await settings.get("NAME");
  return appName;
}
const loadedRoutes = []; // keep track here

// Load backend routes
const routeFiles = fs.readdirSync("./backend").filter(file => file.endsWith(".js"));

for (const file of routeFiles) {
  const routeModule = require(path.join(__dirname, "backend", file));

  const router = routeModule.router || routeModule;
  const name = routeModule.ploxora_route || file.replace(".js", "");

  app.use("/", router);
  loadedRoutes.push(name);
}

// 404 handler
app.use(async (req, res) => {
  res.status(404).render("404", {
    req,
    name: await getAppName(),
  });
});

const asciiart = `
  _____  _                          
 |  __ \\| |                         
 | |__) | | _____  _____  _ __ __ _ 
 |  ___/| |/ _ \\ \\/ / _ \\| '__/ _\` |
 | |    | | (_) >  < (_) | | | (_| |
 |_|    |_|\\___/_/\\_\\___/|_|  \\__,_|
`;

const PORT = process.env.APP_PORT || 3000;
console.log(asciiart)
app.listen(PORT, () => {
  logger.init(`Ploxora has been started on port ${PORT}!`);

  // Log loaded routes AFTER server started
  loadedRoutes.forEach(r => {
    logger.init(`Loaded Route - ${r}`);
  });
});
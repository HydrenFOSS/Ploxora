require("dotenv").config();
const fs = require("fs");
const path = require("path");
const express = require("express");
const app = express();
const Keyv = require("keyv");
const cookieParser = require("cookie-parser");
const Logger = require("./utilities/logger");
const { minify } = require("html-minifier-terser");
const logger = new Logger({ prefix: "Ploxora", level: "debug" });
const settings = new Keyv(process.env.SETTINGS_DB || "sqlite://settings.sqlite");

// --- Express setup ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/frontend"));
app.use(express.static(path.join(__dirname, "public")));

// --- Custom render middleware with minify ---
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
            if (fallbackErr) return res.status(500).send("Render Error: " + fallbackErr);
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

// --- Middleware header ---
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "Hydren || Ploxora");
  next();
});

// --- Ensure default settings ---
async function ensureDefaultSettings() {
  const defaultSettings = {
    NAME: process.env.APP_NAME || "Ploxora",
    IsLogs: false,
    ifisLogs: "",
    Logo: ""
  };
  for (const key in defaultSettings) {
    const existing = await settings.get(key);
    if (existing === undefined || existing === null) {
      await settings.set(key, defaultSettings[key]);
    }
  }
}
ensureDefaultSettings().catch(err => console.error("Failed to initialize settings:", err));

async function getAppName() {
  return await settings.get("NAME");
}

// --- Load Addons globally ---
const addonManager = require("./addons/addon_manager");
addonManager.loadAddons(); // load and init all addons
function attachRouters(app) {
  if (!app._router) {
    // nothing mounted yet, just mount new ones
    addonManager.getRouters().forEach(r => app.use("/", r));
    return;
  }
  app._router.stack = app._router.stack.filter(layer => {
    return !(layer.name === "router" && layer.handle.__addon);
  });
  addonManager.getRouters().forEach(r => {
    app.use("/", r);
  });
}
// Make it available to admin actions
app.set("attachRouters", () => attachRouters(app));
// Register all addon routers globally
addonManager.loadedAddons.forEach(addon => {
  app.use("/", addon.router);
});
const addonViews = addonManager.loadedAddons
  .map(a => path.join(__dirname, "addons", a.folder, "views"))
  .filter(p => fs.existsSync(p));

// Include the main frontend folder as well
app.set("views", [path.join(__dirname, "/frontend"), ...addonViews]);
// Register admin addon route
app.use("/", addonManager.router);

// --- Load backend routes ---
const loadedRoutes = [];
const routeFiles = fs.readdirSync("./backend").filter(file => file.endsWith(".js"));

for (const file of routeFiles) {
  const routeModule = require(path.join(__dirname, "backend", file));
  const router = routeModule.router || routeModule;
  const name = routeModule.ploxora_route || file.replace(".js", "");

  app.use("/", router);
  loadedRoutes.push(name);
}

// --- 404 handler ---
app.use(async (req, res) => {
  res.status(404).render("404", {
    req,
    name: await getAppName(),
  });
});

// --- Start server ---
const asciiart = `
  _____  _                          
 |  __ \\| |                         
 | |__) | | _____  _____  _ __ __ _ 
 |  ___/| |/ _ \\ \\/ / _ \\| '__/ _\` |
 | |    | | (_) >  < (_) | | | (_| |
 |_|    |_|\\___/_/\\_\\___/|_|  \\__,_|
`;

const PORT = process.env.APP_PORT || 3000;
console.log(asciiart);

app.listen(PORT, () => {
  logger.init(`Ploxora has been started on port ${PORT}!`);
  loadedRoutes.forEach(r => logger.init(`Loaded Route - ${r}`));
  addonManager.loadedAddons.forEach(a => logger.init(`Loaded Addon - ${a.name} v${a.version}`));
});

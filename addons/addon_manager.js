const fs = require('fs');
const path = require('path');
const express = require('express');
const Logger = require("../utilities/logger");
const logger = new Logger({ prefix: "Ploxora-Addon-Router", level: "debug" });
const Keyv = require("keyv");
const router = express.Router();

const settings = new Keyv(process.env.SETTINGS_DB || "sqlite://settings.sqlite");
const users = new Keyv(process.env.USERS_DB || 'sqlite://users.sqlite');
const sessions = new Keyv(process.env.SESSIONS_DB || 'sqlite://sessions.sqlite');

const loadedAddons = [];
const allAddons = [];
const adminEmails = (process.env.ADMIN_USERS || "")
  .split(",")
  .map(e => e.trim().toLowerCase());

async function getAppName() {
  return await settings.get("NAME");
}

// --- Auth middleware ---
async function requireAdmin(req, res, next) {
  const token = req.cookies["SESSION-COOKIE"];
  const userId = await sessions.get(token);
  const user = await users.get(userId);
  const isAdmin = user && adminEmails.includes(user.email.toLowerCase());
  if (!isAdmin) return res.redirect('/');
  req.user = user;
  next();
}
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
    req.user = user;
    next();
  } catch (err) {
    logger.error("Auth error:", err);
    res.redirect("/?err=AUTH-FAILED");
  }
}

// --- Loader ---
function loadAddons() {
  loadedAddons.length = 0; // reset
  allAddons.length = 0;    // reset

  const addonsPath = path.join(__dirname);
  const addonFolders = fs.readdirSync(addonsPath, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && dirent.name !== 'addons')
    .map(dirent => dirent.name);

  addonFolders.forEach(folder => {
    try {
      const infoPath = path.join(addonsPath, folder, 'information.json');
      const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));

      const addonData = {
        name: info.name,
        version: info.version,
        author: info.author,
        description: info.description,
        sidebar: info.sidebar || [],
        status: info.status || "enabled",
        folder
      };

      // Always push for admin page
      allAddons.push(addonData);

      // Only load if enabled
      if (addonData.status.toLowerCase() !== "disabled") {
        const mainFile = path.join(addonsPath, folder, info.main || 'index.js');
        const addonModule = require(mainFile);

        if (addonModule.init && typeof addonModule.init === 'function') {
          addonModule.init();
        }

        loadedAddons.push({
          ...addonData,
          module: addonModule,
          router: require(path.join(addonsPath, folder, 'router.js'))
        });

        logger.init(`Loaded addon: ${info.name} v${info.version}`);
      }
    } catch (err) {
      console.error(`Failed to load addon "${folder}":`, err);
    }
  });

  return { loadedAddons, allAddons };
}
function getRouters() {
  return loadedAddons.map(addon => {
    addon.router.__addon = true; // mark so we know it's addon-mounted
    return addon.router;
  });
}

// --- Admin routes ---
router.get('/admin/addons', requireLogin, requireAdmin, async (req, res) => {
  const { allAddons } = loadAddons();
  res.render('admin/addons', {
    addons: allAddons,
    user: req.user,
    name: await getAppName(),
  });
});

// Enable addon by writing to JSON
router.get('/admin/addon/:name/enable', requireLogin, requireAdmin, async (req, res) => {
  const addonName = req.params.name;
  const addonDir = path.join(__dirname, addonName);
  const infoPath = path.join(addonDir, "information.json");

  if (fs.existsSync(infoPath)) {
    let info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
    info.status = "enabled";
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
    logger.init(`Addon ${addonName} enabled by ${req.user.email}`);
  }

  loadAddons(); // reload addons
  req.app.get("attachRouters")();
  res.redirect('/admin/addons');
});

// Disable addon by writing to JSON
router.get('/admin/addon/:name/disable', requireLogin, requireAdmin, async (req, res) => {
  const addonName = req.params.name;
  const addonDir = path.join(__dirname, addonName);
  const infoPath = path.join(addonDir, "information.json");

  if (fs.existsSync(infoPath)) {
    let info = JSON.parse(fs.readFileSync(infoPath, "utf-8"));
    info.status = "disabled";
    fs.writeFileSync(infoPath, JSON.stringify(info, null, 2));
    logger.init(`Addon ${addonName} disabled by ${req.user.email}`);
  }

  loadAddons(); // reload addons
  req.app.get("attachRouters")();
  res.redirect('/admin/addons');
});

module.exports = { loadAddons, allAddons, getRouters, loadedAddons, router };

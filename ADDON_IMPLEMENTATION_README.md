# Ploxora Addon Implementation Guide

Ploxora supports a modular addon system. Addons allow you to extend the panel with custom pages, routes, and functionality.

## Addon Structure

Each addon should have the following structure:

```
example-addon/
├── index.js
├── router.js
├── information.json
└── views/
    └── example.ejs
```

### 1. `information.json`

This file contains metadata and sidebar integration for your addon:

```json
{
  "name": "Example Plugin",
  "description": "This is an example addon.",
  "author": "Your Name",
  "version": "1.0.0",
  "main": "index.js",
  "status": "disabled",
  "sidebar": [
    {
      "icon": "Activity",
      "text": "Example",
      "for": "user",
      "path": "/afkpage"
    },
    {
      "icon": "Activity",
      "text": "Example1",
      "for": "admin",
      "path": "/afkpage/settings"
    },
    {
      "icon": "Activity",
      "text": "Example2",
      "for": "vps",
      "path": "/vps/:id/example"
    }
  ]
}
```

* `main`: entry point of your addon.
* `status`: can be `"enabled"` or `"disabled"`.
* `sidebar`: define menu items, visibility (`for`) and paths.

---

### 2. `router.js`

Handles routing for your addon pages. You can integrate session checks or permission requirements.

```js
const express = require("express");
const router = express.Router();

const { sessions, users } = require("../../utilities/db");

// Middleware to require login
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
    console.error("Auth error:", err);
    res.redirect("/?err=AUTH-FAILED");
  }
}

// Routes
router.get("/example", requireLogin, (req, res) => {
  res.render("example", { name: 'Ploxora' });
});

router.get("/vps/:id/example", requireLogin, (req, res) => {
  res.send("Hello from Example Plugin!");
});

module.exports = router;
```

---

### 3. `index.js`

Addon initialization logic. Runs when the addon is loaded.

```js
const Logger = require("../../utilities/logger");
const logger = new Logger({ prefix: "ExamplePlugin", level: "debug" });

module.exports = {
  init: function () {
    logger.init("✅ Example Plugin initialized!");
  }
};
```

---

### 4. `views/example.ejs`

Your addon’s frontend page:

```html
<!DOCTYPE html>
<html lang="en">
<%- include('./components/head') %>
<body class="flex items-center justify-center min-h-screen bg-neutral-900 text-gray-300 font-[Figtree]">

  <div class="bg-neutral-800 border border-[#2a2a2a] p-10 rounded-2xl shadow-lg w-[450px] text-center">
    <img src="/uploads/logo.png" alt="Logo" class="h-14 mx-auto mb-6">

    <h1 class="text-6xl font-bold text-white">200</h1>
    <p class="text-gray-400 text-lg mt-3">Woah! The Example Plugin works! You can disable it in addon settings in admin.</p>

    <a href="/" 
       class="mt-6 inline-flex items-center justify-center w-full px-8 py-3 bg-neutral-700 hover:bg-neutral-600 text-white rounded-xl font-semibold transition">
       ⬅ Go Back Home
    </a>
  </div>

</body>
</html>
```

---

### Addon Integration Notes

1. Place your addon folder inside `addons/` in the Ploxora root.
2. Ensure `information.json` is valid — this is how Ploxora reads the addon’s metadata and sidebar items.
3. Enable the addon in the admin panel to load its routes and `init` function.
4. Routes in `router.js` are automatically mounted by Ploxora if the addon is enabled.

---

const express = require("express");
const router = express.Router();
const { users, sessions } = require("../../utilities/db")
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

    req.user = user; // attach user for later
    next();
  } catch (err) {
    logger.error("Auth error:", err);
    res.redirect("/?err=AUTH-FAILED");
  }
}

router.get("/example",requireLogin, (req, res) => {
  res.render("example",{name: 'Ploxora'});
});
router.get("/vps/:id/example",requireLogin, (req, res) => {
  res.send("Hello from Example Plugin!");
});

module.exports = router;

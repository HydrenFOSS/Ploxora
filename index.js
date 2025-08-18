require("dotenv").config();
const fs = require("fs");
const express = require("express");
const app = express();
const path = require("path");
const cookieParser = require("cookie-parser");

// Set up EJS
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/frontend"));

// Middleware to add custom header
app.use((req, res, next) => {
  res.setHeader("X-Powered-By", "Hydren || Ploxora");
  next();
});
app.use(cookieParser());
// Load all route files from ./backend (only .js files)
const routeFiles = fs.readdirSync("./backend").filter(file => file.endsWith(".js"));

for (const file of routeFiles) {
  const route = require(`./backend/${file}`);
  app.use("/", route); // mount route at root
}

// 404 handler
app.use((req, res) => {
  res.status(404).render("404", {
    req,
    name: process.env.APP_NAME || "Ploxora",
  });
});

// Start server
const PORT = process.env.APP_PORT || 3000;
app.listen(PORT, () => console.log(`Ploxora has been started on ${PORT}!`));

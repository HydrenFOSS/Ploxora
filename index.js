require("dotenv").config();
const fs = require("fs");
const express = require("express");
const app = express();
const path = require("path");
const cookieParser = require("cookie-parser");
const Logger = require("./utilities/logger");
const { minify } = require("html-minifier-terser");
const logger = new Logger({ prefix: "Ploxora", level: "debug" });
// Set up EJS
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "/frontend"));

app.use((req, res, next) => {
  const render = res.render;
  res.render = function (view, options, callback) {
    render.call(this, view, options, async (err, html) => {
      if (err) return res.status(500).send("Render Error");

      try {
        const minified = await minify(html, {
          collapseWhitespace: true,
          removeComments: true,
          minifyCSS: true,
          minifyJS: true,
        });

        res.send(minified);
      } catch (e) {
        res.send(html); // fallback if minify fails
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
app.listen(PORT, () => logger.init(`Ploxora has been started on ${PORT}!`));

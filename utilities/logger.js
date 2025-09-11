class Logger {
  constructor({ prefix = "App", level = "info", pcolo = "cyan" } = {}) {
    this.prefix = prefix;
    this.level = level;
    this.levels = ["debug", "info", "warn", "error", "init"];
    this.pcolo = pcolo

    this.colors = {
      // Reset
      reset: "\x1b[0m",

      // Regular colors
      black: "\x1b[30m",
      red: "\x1b[31m",
      green: "\x1b[32m",
      yellow: "\x1b[33m",
      blue: "\x1b[34m",
      magenta: "\x1b[35m",
      cyan: "\x1b[36m",
      white: "\x1b[37m",

      // Bright colors
      brightBlack: "\x1b[90m",
      brightRed: "\x1b[91m",
      brightGreen: "\x1b[92m",
      brightYellow: "\x1b[93m",
      brightBlue: "\x1b[94m",
      brightMagenta: "\x1b[95m",
      brightCyan: "\x1b[96m",
      brightWhite: "\x1b[97m",

      // Background colors (never used)
      bgBlack: "\x1b[40m",
      bgRed: "\x1b[41m",
      bgGreen: "\x1b[42m",
      bgYellow: "\x1b[43m",
      bgBlue: "\x1b[44m",
      bgMagenta: "\x1b[45m",
      bgCyan: "\x1b[46m",
      bgWhite: "\x1b[47m",

      // Bright background colors
      bgBrightBlack: "\x1b[100m",
      bgBrightRed: "\x1b[101m",
      bgBrightGreen: "\x1b[102m",
      bgBrightYellow: "\x1b[103m",
      bgBrightBlue: "\x1b[104m",
      bgBrightMagenta: "\x1b[105m",
      bgBrightCyan: "\x1b[106m",
      bgBrightWhite: "\x1b[107m",

      // Styles
      dim: "\x1b[2m",
      bold: "\x1b[1m",
      underline: "\x1b[4m",
      inverse: "\x1b[7m",
      hidden: "\x1b[8m",
      strikethrough: "\x1b[9m",
    };

  }

  format(level, msg) {
    const c = this.colors;
    const timestamp = `${c.dim}[${new Date().toLocaleTimeString()}]${c.reset}`;
    const prefix = `${c[this.pcolo] || ""}[${this.prefix}]${c.reset}`;

    const levelDots = {
      debug: c.gray + "●" + c.reset,
      info: c.cyan + "●" + c.reset,
      warn: c.yellow + "●" + c.reset,
      error: c.red + "●" + c.reset,
      init: c.green + "●" + c.reset,
    };

    return `${timestamp} ${prefix} ${levelDots[level]} ${msg}`;
  }

  log(level, msg = "") {
    if (this.levels.indexOf(level) >= this.levels.indexOf(this.level)) {
      console.log(this.format(level, msg));
    }
  }

  debug(msg) {
    this.log("debug", msg);
  }

  info(msg) {
    this.log("info", msg);
  }

  warn(msg) {
    this.log("warn", msg);
  }

  error(msg) {
    this.log("error", msg);
  }

  init(msg) {
    this.log("init", msg);
  }
  table(items) {
    if (process.env.NODE_ENV === "production") return;
    if (!Array.isArray(items) || items.length === 0) return;

    // Build table rows: split route string into name/version
    const rows = items.map((item, idx) => {
      const [namePart, authorPart, versionPart] = item.split("|").map(s => s.trim());
      return { "#": idx + 1, Name: namePart, Version: versionPart };
    });

    console.table(rows);
  }
}

module.exports = Logger;

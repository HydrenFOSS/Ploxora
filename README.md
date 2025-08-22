# Ploxora 🚀

Ploxora is a lightweight VPS panel that lets you manage nodes and deploy servers with a simple web interface.

---

## 📦 Requirements

* [Node.js](https://nodejs.org/) (v18+ recommended)
* [npm](https://www.npmjs.com/)
* [PM2](https://pm2.keymetrics.io/) (for production)
---

## ⚙️ Environment Setup

Create a `.env` file in the root of your project:

```ini
APP_PORT=6000
APP_NAME=Ploxora
API_KEY=MAKE_SURE_TO_CHANGE_THIS

DISCORD_CLIENT_ID=YOUR_DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET=YOUR_DISCORD_CLIENT_SECRET
DISCORD_CALLBACK_URL=http://localhost:6000/auth/discord/callback

# Admin accounts (comma separated emails)
ADMIN_USERS=example@gmail.com,example2@gmail.com

# Database files (DO NOT CHANGE THESE IF YOU DONT KNOW WHAT UR DOING..)
DATABASE_FILE_NAME=sqlite://users.sqlite
SESSIONS_FILE_NAME=sqlite://sessions.sqlite
NODES_DB=sqlite://nodes.sqlite
SETTINGS_DB=sqlite://settings.sqlite
SERVERS_DB=sqlite://servers.sqlite
```

---

## 🚀 Running Locally (Node.js)

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the app:

   ```bash
   node index.js
   ```

3. Open in browser:

   ```
   http://localhost:6000
   ```

---

## 🔥 Running in Production with PM2

1. Install PM2 globally:

   ```bash
   npm install -g pm2
   ```

2. Start the app with PM2:

   ```bash
   pm2 start index.js --name ploxora
   ```

3. Check logs:

   ```bash
   pm2 logs ploxora
   ```

4. Auto-start PM2 on reboot:

   ```bash
   pm2 startup
   pm2 save
   ```

---

## 🛠️ Development Notes

* Default authentication is via Discord OAuth2
* Admins are defined by `ADMIN_USERS` in `.env`
* SQLite is the default DB, but you can replace `sqlite://` with another supported Keyv backend

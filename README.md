# Ploxora

Ploxora is a lightweight VPS panel that lets you manage nodes and deploy servers with a simple web interface.

---

## Requirements

* [Node.js](https://nodejs.org/) (v18 or higher recommended)
* [npm](https://www.npmjs.com/)
* [PM2](https://pm2.keymetrics.io/) (for production)

---

## Environment Setup

Create a `.env` file in the root of your project:

```ini
APP_PORT=6000
APP_NAME=Ploxora
DESCRIPTION=Ploxora is a lightweight VPS panel that lets you manage nodes and deploy servers with a simple web interface.

DISCORD_CLIENT_ID=YOUR_DISCORD_CLIENT_ID
DISCORD_CLIENT_SECRET=YOUR_DISCORD_CLIENT_SECRET
DISCORD_CALLBACK_URL=http://localhost:6000/auth/discord/callback
ADMIN_USERS=example@gmail.com,example2@gmail.com
API_KEY=MAKE_SURE_TO_CHANGE_THIS
SESSION_SECRET=supersecret

# Do not edit below unless necessary
NODE_ENV=development
```

---

## Running Locally (Node.js)

1. Install dependencies:

```bash
npm install
```

2. Start the application:

```bash
node index.js
```

3. Open your browser:

```
http://localhost:6000
```

---

## Creating a New User via CLI

You can create a new user interactively using the CLI:

```bash
npm run new:user
```

The CLI will prompt you for:

* **Username**
* **Email**
* **Password**

---

## Running in Production with PM2

1. Install PM2 globally:

```bash
npm install -g pm2
```

2. Start the app with PM2:

```bash
pm2 start index.js --name ploxora
```

3. View logs:

```bash
pm2 logs ploxora
```

4. Enable auto-start on reboot:

```bash
pm2 startup
pm2 save
```

---

## Development Notes

* Default authentication is via Discord OAuth2
* Admin users are defined in `.env` under `ADMIN_USERS`

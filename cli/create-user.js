#!/usr/bin/env node
const readline = require("readline");
const bcrypt = require("bcrypt");
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();
const { users } = require('../utilities/db');
const adminEmails = (process.env.ADMIN_USERS || "").split(",").map(e => e.trim().toLowerCase());
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});
function question(prompt) {
  return new Promise(resolve => rl.question(prompt, resolve));
}

async function main() {
  try {
    const username = await question("Enter username: ");
    const email = await question("Enter email: ");
    const password = await question("Enter password: ");
    for await (const [id, user] of users.iterator()) {
      if (user.email && user.email.toLowerCase() === email.toLowerCase()) {
        console.log("Error: Email already registered.");
        process.exit(1);
      }
    }

    const hashedPassword = await bcrypt.hash(password, 12);
    const id = uuidv4();

    const isAdmin = adminEmails.includes(email.toLowerCase());

    const newUser = {
      id,
      username,
      email,
      password: hashedPassword,
      profilePicture: `https://api.dicebear.com/7.x/adventurer/svg?seed=${encodeURIComponent(username)}`,
      admin: isAdmin,
      servers: {}
    };

    await users.set(id, newUser);

    console.log("User created successfully!");
    console.log(`ID: ${id}`);
    console.log(`Username: ${username}`);
    console.log(`Email: ${email}`);
    console.log(`Admin: ${isAdmin}`);

  } catch (err) {
    console.error("Error creating user:", err);
  } finally {
    rl.close();
  }
}

main();

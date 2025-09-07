#!/usr/bin/env node
/*
|---------------------------------------------------------------------------
| CLI Script: nestbits
| Author: ma4z
| Version: 1.0.0
| Description: Fetch images from a JSON URL and add them to nestbits DB
|---------------------------------------------------------------------------
*/

const { nestbits } = require("../utilities/db"); 
const Logger = require("../utilities/logger");
const logger = new Logger({ prefix: "Ploxora-NestBits", level: "debug" });
const JSON_URL = "https://ma4z.pages.dev/repo/ploxora/nestbits.json";

async function fetchImages() {
  try {
    const res = await fetch(JSON_URL);
    if (!res.ok) throw new Error(`Failed to fetch: ${res.statusText}`);
    const data = await res.json();
    for (const item of data) {
      const id = Math.random().toString(36).substring(2, 10);
      const nestbit = {
        dockerimage: item.dockerimage || item.image || "default/image",
        name: item.name || `NestBit-${id}`,
        description: item.description || "No description",
        version: item.version || "1.0.0",
        author: item.author || "Unknown",
        createdAt: new Date().toISOString()
      };
      await nestbits.set(id, nestbit);
      logger.info(`Added NestBit: ${nestbit.name} (${id})`);
    }

    logger.info("All nestbits added successfully!");
  } catch (err) {
    cloggeronsole.error("Error fetching or adding nestbits:", err);
  }
}

fetchImages();

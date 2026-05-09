import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { createApp } from "./app";

const port = Number(process.env.PORT || 8787);
const uploadDir = path.join(process.cwd(), "server", "uploads");
const distDir = path.join(process.cwd(), "dist");

fs.mkdirSync(uploadDir, { recursive: true });

const app = createApp();

if (process.env.SERVE_WEB_DIST === "true" && fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (_request, response) => {
    response.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(port, () => {
  console.log(`Shazam For Quran API listening on http://localhost:${port}`);
});

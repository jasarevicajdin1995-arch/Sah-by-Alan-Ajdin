import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const port = 4173;

const mimeTypes = {
  ".css":  "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs":  "text/javascript; charset=utf-8",
  ".mp3":  "audio/mpeg",
  ".ogg":  "audio/ogg",
  ".wav":  "audio/wav",
  ".png":  "image/png",
  ".svg":  "image/svg+xml",
};

const server = http.createServer((request, response) => {
  // API: return list of songs from assets/music/
  if (request.url === "/api/songs") {
    const musicDir = path.join(__dirname, "assets", "music");
    fs.readdir(musicDir, (err, files) => {
      const songs = err ? [] : files
        .filter(f => /\.(mp3|ogg|wav)$/i.test(f))
        .map(f => ({
          name: f.replace(/\.(mp3|ogg|wav)$/i, ""),
          file: `assets/music/${f}`
        }));
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      });
      response.end(JSON.stringify(songs));
    });
    return;
  }

  const requestPath = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const safePath = path.normalize(requestPath).replace(/^(\.\.[\\/])+/, "");
  const filePath = path.join(__dirname, safePath);

  if (!filePath.startsWith(__dirname)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, file) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500);
      response.end(error.code === "ENOENT" ? "Not found" : "Server error");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] ?? "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(file);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`\n  Sah app radi na  http://127.0.0.1:${port}\n`);
  console.log(`  Dodaj MP3 pjesme u:  assets/music/\n`);
});

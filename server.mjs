import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4173);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const SEED_FILE = path.join(DATA_DIR, "seed.json");
const UPLOAD_DIR = path.join(__dirname, "uploads");

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".webp", "image/webp"],
  [".txt", "text/plain; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".pdf", "application/pdf"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]
]);

await ensureRuntimeFiles();

function nowIso() {
  return new Date().toISOString();
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function text(res, status, body) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

async function ensureRuntimeFiles() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fs.access(DB_FILE);
  } catch {
    const seed = await fs.readFile(SEED_FILE, "utf8");
    await fs.writeFile(DB_FILE, seed, "utf8");
  }
}

async function readDb() {
  await ensureRuntimeFiles();
  return JSON.parse(await fs.readFile(DB_FILE, "utf8"));
}

async function writeDb(db) {
  db.updatedAt = nowIso();
  await fs.writeFile(DB_FILE, `${JSON.stringify(db, null, 2)}\n`, "utf8");
  return db;
}

async function readRequestBody(req, limit = 25 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const error = new Error("Request body is too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(req) {
  const body = await readRequestBody(req, 2 * 1024 * 1024);
  if (!body.length) return {};
  return JSON.parse(body.toString("utf8"));
}

function safeFileName(name) {
  const parsed = path.parse(name || "upload.bin");
  const base = parsed.name.replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "file";
  const ext = parsed.ext.replace(/[^\w.]+/g, "").slice(0, 12);
  return `${base}${ext}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function extToKind(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".pdf") return "pdf";
  if (ext === ".doc" || ext === ".docx") return "word";
  if (ext === ".xls" || ext === ".xlsx") return "xls";
  if (ext === ".fig") return "fig";
  if (ext === ".md" || ext === ".txt") return "md";
  return "file";
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) {
    const error = new Error("Missing multipart boundary");
    error.status = 400;
    throw error;
  }
  const boundary = Buffer.from(`--${match[1] || match[2]}`, "utf8");
  const parts = [];
  let cursor = buffer.indexOf(boundary);
  while (cursor !== -1) {
    let partStart = cursor + boundary.length;
    if (buffer.slice(partStart, partStart + 2).toString() === "--") break;
    if (buffer.slice(partStart, partStart + 2).toString() === "\r\n") partStart += 2;
    const next = buffer.indexOf(boundary, partStart);
    if (next === -1) break;
    let part = buffer.slice(partStart, next);
    if (part.slice(-2).toString() === "\r\n") part = part.slice(0, -2);
    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd !== -1) {
      const headerText = part.slice(0, headerEnd).toString("latin1");
      const data = part.slice(headerEnd + 4);
      const disposition = /content-disposition:\s*([^\r\n]+)/i.exec(headerText)?.[1] || "";
      const name = /name="([^"]+)"/i.exec(disposition)?.[1] || "";
      const filename = /filename="([^"]*)"/i.exec(disposition)?.[1] || "";
      const type = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim() || "application/octet-stream";
      parts.push({ name, filename, type, data });
    }
    cursor = next;
  }
  return parts;
}

async function saveUploadedFile(req, db) {
  const body = await readRequestBody(req);
  const parts = parseMultipart(body, req.headers["content-type"]);
  const filePart = parts.find((part) => part.filename && part.data.length);
  if (!filePart) {
    const error = new Error("No file found in upload");
    error.status = 400;
    throw error;
  }
  const originalName = safeFileName(Buffer.from(filePart.filename, "latin1").toString("utf8"));
  const id = randomUUID();
  const storedName = `${id}-${originalName}`;
  const storedPath = path.join(UPLOAD_DIR, storedName);
  await fs.writeFile(storedPath, filePart.data);
  const document = {
    id,
    title: originalName,
    kind: extToKind(originalName),
    size: formatBytes(filePart.data.length),
    updatedAt: nowIso(),
    source: "upload",
    storedName,
    mime: filePart.type
  };
  db.documents.unshift(document);
  await writeDb(db);
  return document;
}

function publicState(db) {
  return {
    settings: db.settings,
    documents: db.documents,
    favorites: db.favorites,
    mails: db.mails.filter((mail) => !mail.archived),
    todos: db.todos,
    notes: db.notes,
    music: db.music,
    updatedAt: db.updatedAt
  };
}

const weatherCodes = new Map([
  [0, "晴"],
  [1, "大部晴朗"],
  [2, "多云"],
  [3, "阴"],
  [45, "雾"],
  [48, "雾凇"],
  [51, "小毛毛雨"],
  [53, "毛毛雨"],
  [55, "强毛毛雨"],
  [61, "小雨"],
  [63, "雨"],
  [65, "大雨"],
  [80, "阵雨"],
  [95, "雷雨"]
]);

async function getWeather(query) {
  const lat = Number(query.searchParams.get("lat") || 31.2304);
  const lon = Number(query.searchParams.get("lon") || 121.4737);
  const location = query.searchParams.get("location") || "上海市 · 浦东新区";
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m");
  url.searchParams.set("timezone", "Asia/Taipei");
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error(`weather ${response.status}`);
    const data = await response.json();
    const current = data.current || {};
    return {
      location,
      temperature: current.temperature_2m ?? 22,
      apparent: current.apparent_temperature ?? current.temperature_2m ?? 22,
      humidity: current.relative_humidity_2m ?? 56,
      wind: current.wind_speed_10m ?? 12,
      code: current.weather_code ?? 2,
      label: weatherCodes.get(current.weather_code) || "多云",
      live: true,
      checkedAt: nowIso()
    };
  } catch {
    return {
      location,
      temperature: 22,
      apparent: 21,
      humidity: 56,
      wind: 12,
      code: 2,
      label: "多云",
      live: false,
      checkedAt: nowIso()
    };
  }
}

async function routeApi(req, res, url) {
  const db = await readDb();
  const method = req.method || "GET";
  const segments = url.pathname.split("/").filter(Boolean);
  const [api, resource, id] = segments;
  if (api !== "api") return false;

  if (method === "GET" && resource === "state") return json(res, 200, publicState(db));
  if (method === "GET" && resource === "weather") return json(res, 200, await getWeather(url));

  if (method === "POST" && resource === "upload") {
    const document = await saveUploadedFile(req, db);
    return json(res, 201, document);
  }

  if (method === "GET" && resource === "files" && id) {
    const document = db.documents.find((item) => item.id === id);
    if (!document?.storedName) return json(res, 404, { error: "File not found" });
    const filePath = path.join(UPLOAD_DIR, document.storedName);
    try {
      const file = await fs.readFile(filePath);
      res.writeHead(200, {
        "content-type": document.mime || "application/octet-stream",
        "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(document.title)}`
      });
      return res.end(file);
    } catch {
      return json(res, 404, { error: "File not found" });
    }
  }

  if (method === "POST" && resource === "documents") {
    const body = await readJson(req);
    const title = String(body.title || "未命名文档").trim().slice(0, 120);
    const id = randomUUID();
    const content = String(body.content || "");
    const storedName = `${id}-${safeFileName(title)}.md`;
    if (content) await fs.writeFile(path.join(UPLOAD_DIR, storedName), content, "utf8");
    const document = {
      id,
      title,
      kind: body.kind || extToKind(title),
      size: content ? formatBytes(Buffer.byteLength(content)) : "0 KB",
      updatedAt: nowIso(),
      source: content ? "created" : "metadata",
      storedName: content ? storedName : "",
      mime: "text/markdown; charset=utf-8"
    };
    db.documents.unshift(document);
    await writeDb(db);
    return json(res, 201, document);
  }

  if (method === "DELETE" && resource === "documents" && id) {
    const index = db.documents.findIndex((item) => item.id === id);
    if (index === -1) return json(res, 404, { error: "Document not found" });
    const [removed] = db.documents.splice(index, 1);
    if (removed.storedName) fs.unlink(path.join(UPLOAD_DIR, removed.storedName)).catch(() => {});
    await writeDb(db);
    return json(res, 200, removed);
  }

  if (method === "POST" && resource === "favorites") {
    const body = await readJson(req);
    const favorite = {
      id: randomUUID(),
      title: String(body.title || "新收藏").trim().slice(0, 60),
      url: String(body.url || "https://example.com").trim(),
      icon: String(body.icon || "★").trim().slice(0, 2),
      color: String(body.color || "#3b8cff"),
      createdAt: nowIso()
    };
    db.favorites.unshift(favorite);
    await writeDb(db);
    return json(res, 201, favorite);
  }

  if (method === "PATCH" && resource === "music" && id) {
    const track = db.music.find((item) => item.id === id);
    if (!track) return json(res, 404, { error: "Track not found" });
    const body = await readJson(req);
    if (typeof body.liked === "boolean") track.liked = body.liked;
    await writeDb(db);
    return json(res, 200, track);
  }

  if (method === "DELETE" && resource === "favorites" && id) {
    const index = db.favorites.findIndex((item) => item.id === id);
    if (index === -1) return json(res, 404, { error: "Favorite not found" });
    const [removed] = db.favorites.splice(index, 1);
    await writeDb(db);
    return json(res, 200, removed);
  }

  if (method === "POST" && resource === "mails") {
    const body = await readJson(req);
    const mail = {
      id: randomUUID(),
      sender: String(body.sender || "本地通知").slice(0, 60),
      subject: String(body.subject || "新消息").slice(0, 100),
      body: String(body.body || "").slice(0, 1000),
      time: nowIso(),
      read: false,
      archived: false,
      icon: "✉"
    };
    db.mails.unshift(mail);
    await writeDb(db);
    return json(res, 201, mail);
  }

  if (method === "PATCH" && resource === "mails" && id) {
    const mail = db.mails.find((item) => item.id === id);
    if (!mail) return json(res, 404, { error: "Mail not found" });
    const body = await readJson(req);
    if (typeof body.read === "boolean") mail.read = body.read;
    if (typeof body.archived === "boolean") mail.archived = body.archived;
    await writeDb(db);
    return json(res, 200, mail);
  }

  if (method === "POST" && resource === "todos") {
    const body = await readJson(req);
    const todo = {
      id: randomUUID(),
      title: String(body.title || "新的待办").trim().slice(0, 120),
      done: false,
      createdAt: nowIso()
    };
    db.todos.unshift(todo);
    await writeDb(db);
    return json(res, 201, todo);
  }

  if (method === "PATCH" && resource === "todos" && id) {
    const todo = db.todos.find((item) => item.id === id);
    if (!todo) return json(res, 404, { error: "Todo not found" });
    const body = await readJson(req);
    if (typeof body.done === "boolean") todo.done = body.done;
    if (body.title) todo.title = String(body.title).trim().slice(0, 120);
    await writeDb(db);
    return json(res, 200, todo);
  }

  if (method === "DELETE" && resource === "todos" && id) {
    const index = db.todos.findIndex((item) => item.id === id);
    if (index === -1) return json(res, 404, { error: "Todo not found" });
    const [removed] = db.todos.splice(index, 1);
    await writeDb(db);
    return json(res, 200, removed);
  }

  if (method === "POST" && resource === "notes") {
    const body = await readJson(req);
    const note = {
      id: randomUUID(),
      title: String(body.title || "灵感记录").trim().slice(0, 100),
      body: String(body.body || "").trim().slice(0, 2000),
      createdAt: nowIso()
    };
    db.notes.unshift(note);
    await writeDb(db);
    return json(res, 201, note);
  }

  if (method === "PATCH" && resource === "settings") {
    const body = await readJson(req);
    db.settings = { ...db.settings, ...body };
    await writeDb(db);
    return json(res, 200, db.settings);
  }

  return json(res, 404, { error: "API route not found" });
}

async function serveStatic(req, res, url) {
  let relativePath = decodeURIComponent(url.pathname);
  if (relativePath === "/") relativePath = "/index.html";
  const filePath = path.normalize(path.join(__dirname, relativePath));
  if (!filePath.startsWith(__dirname)) return text(res, 403, "Forbidden");
  try {
    const stats = await fs.stat(filePath);
    if (stats.isDirectory()) return text(res, 403, "Forbidden");
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": mimeTypes.get(ext) || "application/octet-stream",
      "cache-control": ext === ".html" ? "no-store" : "public, max-age=3600"
    });
    res.end(await fs.readFile(filePath));
  } catch {
    text(res, 404, "Not found");
  }
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "127.0.0.1"}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
    } else {
      await serveStatic(req, res, url);
    }
  } catch (error) {
    json(res, error.status || 500, { error: error.message || "Internal server error" });
  }
}).listen(PORT, () => {
  console.log(`Sakura Home running at http://127.0.0.1:${PORT}`);
});

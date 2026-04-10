const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { spawn, execFile } = require("child_process");

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  // Avoid stale browser cache for management UI and APIs
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

const ROOT = path.resolve(__dirname, "..", "..");
const DB = require(path.join(ROOT, "includes", "database", "index.js"));
const models = require(path.join(ROOT, "includes", "database", "model.js"))(DB);
const { sequelize } = DB;
const Threads = models.use("Threads");
const Users = models.use("Users");


const PATHS = {
  cookie: path.join(ROOT, "cookies.txt"),
  config: path.join(ROOT, "config.json"),
  thuebot: path.join(ROOT, "data", "thuebot.json"),
  rentKey: path.join(ROOT, "data", "RentKey.json"),
  disableCommand: path.join(ROOT, "data", "disable-command.json"),
  commandBanned: path.join(ROOT, "modules", "data", "commands-banned.json"),
  leaveThread: path.join(ROOT, "data", "leave_threads.json")
};

const WEB_DIR = path.resolve(__dirname, "..");

let botProcess = null;
let botStartedAt = null;
let botExit = null;
let logSeq = 0;
const botLogs = [];
const MAX_LOGS = 3000;

function pushBotLog(stream, text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  for (const line of lines) {
    logSeq += 1;
    botLogs.push({ id: logSeq, stream, text: line, time: new Date().toISOString() });
  }
  if (botLogs.length > MAX_LOGS) {
    botLogs.splice(0, botLogs.length - MAX_LOGS);
  }
}

function readConfig() {
  return readJson(PATHS.config, {});
}

function writeConfig(nextConfig) {
  writeJson(PATHS.config, nextConfig);
}

function getAdminUid() {
  const cfg = readConfig();
  const list = Array.isArray(cfg.ADMINBOT) ? cfg.ADMINBOT.map(String).filter(Boolean) : [];
  return list[0] || "";
}

function setAdminUid(uid) {
  const cfg = readConfig();
  const current = Array.isArray(cfg.ADMINBOT) ? cfg.ADMINBOT.map(String).filter(Boolean) : [];
  const next = [String(uid || "").trim(), ...current].filter(Boolean);
  cfg.ADMINBOT = Array.from(new Set(next));
  writeConfig(cfg);
  return cfg.ADMINBOT[0] || "";
}

function isBotRunning() {
  return !!(botProcess && !botProcess.killed);
}

function killBotProcess() {
  return new Promise((resolve) => {
    if (!botProcess) return resolve();
    const target = botProcess;

    const done = () => {
      botProcess = null;
      botStartedAt = null;
      resolve();
    };

    target.once("exit", done);

    try {
      if (process.platform === "win32") {
        execFile("taskkill", ["/PID", String(target.pid), "/T", "/F"], () => {});
      } else {
        target.kill("SIGTERM");
      }
    } catch (_err) {
      done();
    }
  });
}

function startBotProcess() {
  if (isBotRunning()) return;

  botExit = null;
  botStartedAt = new Date().toISOString();
  pushBotLog("system", "Starting bot process...");

  const child = spawn(process.execPath, ["index"], {
    cwd: ROOT,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  botProcess = child;
  pushBotLog("system", `Bot PID: ${child.pid}`);

  child.stdout.on("data", (buf) => pushBotLog("stdout", buf.toString("utf8")));
  child.stderr.on("data", (buf) => pushBotLog("stderr", buf.toString("utf8")));

  child.on("exit", (code, signal) => {
    botExit = { code, signal, at: new Date().toISOString() };
    pushBotLog("system", `Bot exited (code=${code}, signal=${signal || "none"})`);
    botProcess = null;
    botStartedAt = null;
  });
}

function todayString() {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function addDaysString(days) {
  const now = new Date();
  now.setDate(now.getDate() + Number(days));
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function randomKey(days) {
  const suffix = Math.random().toString(36).slice(2, 9);
  return `kzi_${days}_${suffix}`;
}

function ensureFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
  }
}

function readJson(filePath, fallback) {
  ensureFile(filePath, fallback);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function listAllCommandFiles() {
  const root = path.join(ROOT, "modules", "commands");
  const results = [];

  function extractCommandName(filePath, fallbackName) {
    try {
      const content = fs.readFileSync(filePath, "utf8");
      const match = content.match(/name\s*:\s*['\"`]([^'\"`]+)['\"`]/);
      if (match && match[1]) return String(match[1]).trim();
    } catch (_err) {}
    return fallbackName;
  }

  function walk(dir, category) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.toLowerCase() === "data" || entry.name.toLowerCase() === "cache") {
          continue;
        }
        walk(fullPath, category || entry.name);
        continue;
      }

      if (!entry.name.endsWith(".js")) continue;
      const cmdName = entry.name.replace(/\.js$/i, "");
      const realName = extractCommandName(fullPath, cmdName);
      const relativePath = path.relative(ROOT, fullPath).replace(/\\/g, "/");
      results.push({
        name: realName,
        fileName: cmdName,
        category: category || "Khac",
        file: relativePath
      });
    }
  }

  walk(root, "");
  return results.sort((a, b) => a.name.localeCompare(b.name));
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/cookie", (_req, res) => {
  const cookie = fs.existsSync(PATHS.cookie) ? fs.readFileSync(PATHS.cookie, "utf8") : "";
  res.json({ cookie });
});

app.put("/api/cookie", (req, res) => {
  const cookie = String(req.body.cookie || "").trim();
  fs.writeFileSync(PATHS.cookie, cookie, "utf8");
  res.json({ ok: true });
});

app.get("/api/config/admin", (_req, res) => {
  res.json({ adminUid: getAdminUid() });
});

app.put("/api/config/admin", (req, res) => {
  const adminUid = String(req.body.adminUid || "").trim();
  if (!adminUid) {
    return res.status(400).json({ error: "Thieu adminUid" });
  }
  const saved = setAdminUid(adminUid);
  res.json({ ok: true, adminUid: saved });
});

app.get("/api/bot/status", (_req, res) => {
  res.json({
    running: isBotRunning(),
    pid: botProcess ? botProcess.pid : null,
    startedAt: botStartedAt,
    exit: botExit
  });
});

app.get("/api/bot/logs", (req, res) => {
  const after = Number(req.query.after || 0);
  const items = botLogs.filter((x) => x.id > after);
  res.json({
    items,
    lastId: logSeq,
    running: isBotRunning()
  });
});

app.post("/api/bot/start", (req, res) => {
  const adminUid = String(req.body.adminUid || "").trim();
  const cookie = typeof req.body.cookie === "string" ? req.body.cookie.trim() : "";

  if (adminUid) setAdminUid(adminUid);
  if (cookie) fs.writeFileSync(PATHS.cookie, cookie, "utf8");

  if (isBotRunning()) {
    return res.json({ ok: true, running: true, pid: botProcess.pid, message: "Bot da dang chay" });
  }

  startBotProcess();
  res.json({ ok: true, running: true, pid: botProcess ? botProcess.pid : null });
});

app.post("/api/bot/stop", async (_req, res) => {
  if (!isBotRunning()) {
    return res.json({ ok: true, running: false, message: "Bot da dung" });
  }

  pushBotLog("system", "Stopping bot process...");
  await killBotProcess();
  res.json({ ok: true, running: false });
});

app.get("/api/groups", async (_req, res) => {
  const rent = readJson(PATHS.thuebot, []);
  const rentSet = new Set(rent.map((x) => String(x.t_id)));
  const rows = await Threads.findAll();
  const items = rows.map((row) => {
    const item = row.get({ plain: true });
    return {
      threadID: String(item.threadID),
      threadName: item.threadInfo?.threadName || "",
      memberCount: item.threadInfo?.participantIDs?.length || 0,
      isRented: rentSet.has(String(item.threadID))
    };
  });
  res.json({ items });
});

app.post("/api/groups/:threadId/leave", async (req, res) => {
  const threadId = String(req.params.threadId || "").trim();
  if (!threadId) {
    return res.status(400).json({ error: "Thieu threadId" });
  }

  const rent = readJson(PATHS.thuebot, []).filter((x) => String(x.t_id) !== threadId);
  writeJson(PATHS.thuebot, rent);

  const disabled = readJson(PATHS.disableCommand, {});
  if (disabled[threadId]) {
    delete disabled[threadId];
    writeJson(PATHS.disableCommand, disabled);
  }

  const commandBanned = readJson(PATHS.commandBanned, {});
  if (commandBanned[threadId]) {
    delete commandBanned[threadId];
    writeJson(PATHS.commandBanned, commandBanned);
  }

  // Xóa record thread khỏi DB để danh sách groups cập nhật ngay.
  // Dùng API của Sequelize trước (tương thích nhiều dialect), fallback sang query có replacements.
  try {
    const affected = await Threads.destroy({ where: { threadID: threadId } });
    if (!affected) {
      try {
        await sequelize.query('DELETE FROM "Threads" WHERE CAST("threadID" AS TEXT) = :tid', {
          replacements: { tid: threadId }
        });
      } catch (_e2) {
        try {
          await sequelize.query('DELETE FROM Threads WHERE threadID = :tid', {
            replacements: { tid: threadId }
          });
        } catch (_e3) {}
      }
    }
  } catch (_err) {}


  const leaveList = readJson(PATHS.leaveThread, []);
  if (!leaveList.includes(threadId)) {
    leaveList.push(threadId);
    writeJson(PATHS.leaveThread, leaveList);
  }

  res.json({ ok: true, message: "Da roi nhom trong du lieu quan ly" });
});

app.get("/api/rental/groups", (_req, res) => {
  res.json({ items: readJson(PATHS.thuebot, []) });
});

app.post("/api/rental/groups", (req, res) => {
  const current = readJson(PATHS.thuebot, []);
  const t_id = String(req.body.t_id || "").trim();
  const uid_renter = String(req.body.uid_renter || "").trim();
  const days = Number(req.body.days_rented || 30);

  if (!t_id) return res.status(400).json({ error: "Thieu t_id" });
  if (current.find((x) => String(x.t_id) === t_id)) {
    return res.status(400).json({ error: "Nhom nay da ton tai trong danh sach thue" });
  }

  current.push({
    t_id,
    uid_renter,
    time_start: todayString(),
    time_end: addDaysString(days),
    days_rented: days
  });
  writeJson(PATHS.thuebot, current);
  res.json({ ok: true });
});

app.delete("/api/rental/groups/:tid", (req, res) => {
  const tid = String(req.params.tid);
  const current = readJson(PATHS.thuebot, []);
  const next = current.filter((x) => String(x.t_id) !== tid);
  writeJson(PATHS.thuebot, next);
  res.json({ ok: true });
});

app.get("/api/rental/keys", (_req, res) => {
  const data = readJson(PATHS.rentKey, { used_keys: [], unUsed_keys: [] });
  res.json(data);
});

app.post("/api/rental/keys", (req, res) => {
  const action = String(req.body?.action || "create").trim().toLowerCase();
  if (action === "delete") {
    const key = String(req.body?.key || "").trim();
    if (!key) {
      return res.status(400).json({ error: "Thieu key" });
    }

    const data = readJson(PATHS.rentKey, { used_keys: [], unUsed_keys: [] });
    const beforeUnused = Array.isArray(data.unUsed_keys) ? data.unUsed_keys.length : 0;
    const beforeUsed = Array.isArray(data.used_keys) ? data.used_keys.length : 0;

    data.unUsed_keys = (Array.isArray(data.unUsed_keys) ? data.unUsed_keys : []).filter((x) => String(x) !== key);
    data.used_keys = (Array.isArray(data.used_keys) ? data.used_keys : []).filter((x) => String(x) !== key);

    const removed = beforeUnused !== data.unUsed_keys.length || beforeUsed !== data.used_keys.length;
    writeJson(PATHS.rentKey, data);
    return res.json({ ok: true, removed });
  }

  const days = Number(req.body.days || 30);
  const data = readJson(PATHS.rentKey, { used_keys: [], unUsed_keys: [] });
  const key = randomKey(days);
  data.unUsed_keys = Array.isArray(data.unUsed_keys) ? data.unUsed_keys : [];
  data.unUsed_keys.push(key);
  writeJson(PATHS.rentKey, data);
  res.json({ ok: true, key });
});

app.delete("/api/rental/keys", (req, res) => {
  const key = String(req.body?.key || "").trim();
  if (!key) {
    return res.status(400).json({ error: "Thieu key" });
  }

  const data = readJson(PATHS.rentKey, { used_keys: [], unUsed_keys: [] });
  const beforeUnused = Array.isArray(data.unUsed_keys) ? data.unUsed_keys.length : 0;
  const beforeUsed = Array.isArray(data.used_keys) ? data.used_keys.length : 0;

  data.unUsed_keys = (Array.isArray(data.unUsed_keys) ? data.unUsed_keys : []).filter((x) => String(x) !== key);
  data.used_keys = (Array.isArray(data.used_keys) ? data.used_keys : []).filter((x) => String(x) !== key);

  const removed = beforeUnused !== data.unUsed_keys.length || beforeUsed !== data.used_keys.length;
  writeJson(PATHS.rentKey, data);
  res.json({ ok: true, removed });
});

// Backward-compatible endpoint in case some environments/proxies block DELETE with JSON body
app.post("/api/rental/keys/delete", (req, res) => {
  const key = String(req.body?.key || "").trim();
  if (!key) {
    return res.status(400).json({ error: "Thieu key" });
  }

  const data = readJson(PATHS.rentKey, { used_keys: [], unUsed_keys: [] });
  const beforeUnused = Array.isArray(data.unUsed_keys) ? data.unUsed_keys.length : 0;
  const beforeUsed = Array.isArray(data.used_keys) ? data.used_keys.length : 0;

  data.unUsed_keys = (Array.isArray(data.unUsed_keys) ? data.unUsed_keys : []).filter((x) => String(x) !== key);
  data.used_keys = (Array.isArray(data.used_keys) ? data.used_keys : []).filter((x) => String(x) !== key);

  const removed = beforeUnused !== data.unUsed_keys.length || beforeUsed !== data.used_keys.length;
  writeJson(PATHS.rentKey, data);
  res.json({ ok: true, removed });
});

app.get("/api/commands/disabled", (_req, res) => {
  const data = readJson(PATHS.disableCommand, {});
  res.json({ items: data });
});

app.get("/api/commands/all", (_req, res) => {
  const items = listAllCommandFiles();
  res.json({ items });
});

app.get("/api/commands/banned/:threadId", (req, res) => {
  const threadId = String(req.params.threadId || "").trim();
  const data = readJson(PATHS.commandBanned, {});
  const threadData = data[threadId] || { cmds: [], users: {} };
  const banned = Array.isArray(threadData.cmds) ? threadData.cmds : [];
  res.json({ items: banned });
});

app.put("/api/commands/banned/:threadId", (req, res) => {
  const threadId = String(req.params.threadId || "").trim();
  const command = String(req.body.command || "").trim();
  const banned = Boolean(req.body.banned);

  if (!threadId || !command) {
    return res.status(400).json({ error: "Thieu threadId hoac command" });
  }

  const data = readJson(PATHS.commandBanned, {});
  if (!data[threadId]) {
    data[threadId] = { cmds: [], users: {} };
  }

  if (!Array.isArray(data[threadId].cmds)) {
    data[threadId].cmds = [];
  }

  if (banned) {
    const exists = data[threadId].cmds.find((x) => String(x.cmd) === command);
    if (!exists) {
      data[threadId].cmds.push({
        cmd: command,
        author: "web-manager",
        time: new Date().toLocaleString("vi-VN")
      });
    }
  } else {
    data[threadId].cmds = data[threadId].cmds.filter((x) => String(x.cmd) !== command);
  }

  writeJson(PATHS.commandBanned, data);
  res.json({ ok: true });
});

app.put("/api/commands/disabled/:threadId", (req, res) => {
  const threadId = String(req.params.threadId || "").trim();
  const category = String(req.body.category || "").trim();
  const disabled = Boolean(req.body.disabled);
  if (!threadId || !category) {
    return res.status(400).json({ error: "Thieu threadId hoac category" });
  }

  const data = readJson(PATHS.disableCommand, {});
  if (!data[threadId]) data[threadId] = {};
  data[threadId][category] = disabled;
  writeJson(PATHS.disableCommand, data);
  res.json({ ok: true });
});

app.get("/api/ban/users", async (_req, res) => {
  const rows = await Users.findAll();
  const items = rows
    .map((r) => r.get({ plain: true }))
    .filter((r) => r.data && r.data.banned)
    .map((r) => ({
      userID: String(r.userID),
      reason: r.data.reason || "",
      dateAdded: r.data.dateAdded || ""
    }));
  res.json({ items });
});

app.post("/api/ban/users", async (req, res) => {
  const userId = String(req.body.userId || "").trim();
  const reason = String(req.body.reason || "").trim() || "Ban tu web manager";
  if (!userId) return res.status(400).json({ error: "Thieu userId" });

  const exist = await Users.findOne({ where: { userID: userId } });
  const nextData = {
    ...(exist?.get({ plain: true })?.data || {}),
    banned: true,
    reason,
    dateAdded: new Date().toISOString()
  };

  if (exist) {
    await exist.update({ data: nextData });
  } else {
    await Users.create({ userID: userId, name: "", gender: "", data: nextData });
  }

  res.json({ ok: true });
});

app.delete("/api/ban/users/:userId", async (req, res) => {
  const userId = String(req.params.userId || "").trim();
  const exist = await Users.findOne({ where: { userID: userId } });
  if (!exist) return res.json({ ok: true });

  const plain = exist.get({ plain: true });
  const nextData = { ...(plain.data || {}) };
  delete nextData.banned;
  delete nextData.reason;
  delete nextData.dateAdded;
  await exist.update({ data: nextData });
  res.json({ ok: true });
});

app.get("/api/ban/threads", async (_req, res) => {
  const rows = await Threads.findAll();
  const items = rows
    .map((r) => r.get({ plain: true }))
    .filter((r) => r.data && r.data.banned)
    .map((r) => ({
      threadID: String(r.threadID),
      reason: r.data.reason || "",
      dateAdded: r.data.dateAdded || ""
    }));
  res.json({ items });
});

app.post("/api/ban/threads", async (req, res) => {
  const threadId = String(req.body.threadId || "").trim();
  const reason = String(req.body.reason || "").trim() || "Ban tu web manager";
  if (!threadId) return res.status(400).json({ error: "Thieu threadId" });

  const exist = await Threads.findOne({ where: { threadID: threadId } });
  const nextData = {
    ...(exist?.get({ plain: true })?.data || {}),
    banned: true,
    reason,
    dateAdded: new Date().toISOString()
  };

  if (exist) {
    await exist.update({ data: nextData });
  } else {
    await Threads.create({ threadID: threadId, threadInfo: {}, data: nextData });
  }

  res.json({ ok: true });
});

app.delete("/api/ban/threads/:threadId", async (req, res) => {
  const threadId = String(req.params.threadId || "").trim();
  const exist = await Threads.findOne({ where: { threadID: threadId } });
  if (!exist) return res.json({ ok: true });

  const plain = exist.get({ plain: true });
  const nextData = { ...(plain.data || {}) };
  delete nextData.banned;
  delete nextData.reason;
  delete nextData.dateAdded;
  await exist.update({ data: nextData });
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.use(express.static(WEB_DIR));
app.get("/", (_req, res) => {
  res.sendFile(path.join(WEB_DIR, "index.html"));
});

const BASE_PORT = Number(process.env.PORT || 7070);

function listenWithFallback(port) {
  const server = app
    .listen(port, () => {
      console.log(`Web manager API running on http://localhost:${port}`);
    })
    .on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        const nextPort = port + 1;
        console.log(`Port ${port} dang duoc su dung, thu lai voi port ${nextPort}...`);
        listenWithFallback(nextPort);
        return;
      }
      console.error(err);
      process.exit(1);
    });

  return server;
}

listenWithFallback(BASE_PORT);

process.on("SIGINT", async () => {
  await killBotProcess();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await killBotProcess();
  process.exit(0);
});

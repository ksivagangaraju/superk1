const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: [
      "https://your-netlify-site.netlify.app",
      "https://superk1.netlify.app",
    ],
    credentials: true,
  },
});

app.use(express.json());
app.use(
  cors({ origin: ["https://your-netlify-site.netlify.app", "https://superk1.netlify.app"], credentials: true })
);

// Serve static admin assets from ./public
app.use(express.static(path.join(__dirname, "public")));

// DB path: prefer server/data.sqlite, but if it's not a valid SQLite file
// fall back to project-root data.sqlite
const fs = require("fs");
function isSqliteFile(p) {
  try {
    const fd = fs.openSync(p, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);
    return buf.toString("utf8", 0, 15) === "SQLite format 3\u0000";
  } catch (e) {
    return false;
  }
}

let DB_PATH = path.join(__dirname, "data.sqlite");
if (!isSqliteFile(DB_PATH)) {
  const alt = path.join(__dirname, "..", "data.sqlite");
  if (isSqliteFile(alt)) {
    DB_PATH = alt;
  } else {
    // neither path has a valid sqlite file — prefer server path (will create a new DB later)
    // remove placeholder text files if present
    if (
      fs.existsSync(path.join(__dirname, "data.sqlite")) &&
      !isSqliteFile(path.join(__dirname, "data.sqlite"))
    ) {
      try {
        fs.unlinkSync(path.join(__dirname, "data.sqlite"));
      } catch (e) {}
    }
    DB_PATH = path.join(__dirname, "data.sqlite");
  }
}
const db = new sqlite3.Database(DB_PATH);

// Simple admin auth config (change via environment variables)
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "password";
const AUTH_SECRET = process.env.AUTH_SECRET || "change_this_secret";
const TOKEN_MAX_AGE = parseInt(
  process.env.TOKEN_MAX_AGE || String(24 * 60 * 60 * 1000)
); // ms

function signToken(obj) {
  const payload = Buffer.from(JSON.stringify(obj)).toString("base64");
  const sig = crypto
    .createHmac("sha256", AUTH_SECRET)
    .update(payload)
    .digest("base64");
  return payload + "." + sig;
}

function verifyToken(token) {
  try {
    const [payloadB64, sig] = token.split(".");
    const expected = crypto
      .createHmac("sha256", AUTH_SECRET)
      .update(payloadB64)
      .digest("base64");
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString());
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function parseCookies(cookieHeader) {
  const list = {};
  if (!cookieHeader) return list;
  cookieHeader.split(";").forEach(function (cookie) {
    const parts = cookie.split("=");
    const key = parts.shift().trim();
    const val = decodeURI(parts.join("="));
    list[key] = val;
  });
  return list;
}

function requireAdmin(req, res, next) {
  const cookies = parseCookies(req.headers.cookie || "");
  const token = cookies.admin_token;
  if (!token) return res.status(401).json({ error: "unauthorized" });
  const payload = verifyToken(token);
  if (!payload || payload.user !== ADMIN_USER)
    return res.status(401).json({ error: "unauthorized" });
  req.admin = payload.user;
  next();
}

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS state (
    id INTEGER PRIMARY KEY,
    rows INTEGER,
    cols INTEGER,
    blocked TEXT,
    names TEXT
  )`);

  db.get("SELECT COUNT(1) as cnt FROM state WHERE id = 1", (err, row) => {
    if (err) return console.error(err);
    if (!row || row.cnt === 0) {
      db.run(
        `INSERT OR REPLACE INTO state (id, rows, cols, blocked, names) VALUES (1,?,?,?,?)`,
        [3, 3, JSON.stringify([]), JSON.stringify({})]
      );
    }
  });
});

function getState(cb) {
  db.get(
    "SELECT rows, cols, blocked, names FROM state WHERE id = 1",
    (err, row) => {
      if (err) return cb(err);
      if (!row) return cb(null, { rows: 3, cols: 3, blocked: [], names: {} });
      try {
        const state = {
          rows: row.rows,
          cols: row.cols,
          blocked: JSON.parse(row.blocked || "[]"),
          names: JSON.parse(row.names || "{}"),
        };
        cb(null, state);
      } catch (e) {
        cb(e);
      }
    }
  );
}

function saveState(state, cb) {
  db.run(
    "UPDATE state SET rows = ?, cols = ?, blocked = ?, names = ? WHERE id = 1",
    [
      state.rows,
      state.cols,
      JSON.stringify(state.blocked || []),
      JSON.stringify(state.names || {}),
    ],
    function (err) {
      if (cb) cb(err);
    }
  );
}

function computeSnakeMapping(rows, cols, blockedArray) {
  const blockedSet = new Set(blockedArray || []);
  const coordToNumber = {};
  const numberToCoord = {};
  let count = 1;

  for (let c = 0; c < cols; c++) {
    if (c % 2 === 0) {
      for (let r = rows - 1; r >= 0; r--) {
        const cid = `${r}-${c}`;
        if (!blockedSet.has(cid)) {
          coordToNumber[cid] = count;
          numberToCoord[count] = cid;
          count++;
        }
      }
    } else {
      for (let r = 0; r < rows; r++) {
        const cid = `${r}-${c}`;
        if (!blockedSet.has(cid)) {
          coordToNumber[cid] = count;
          numberToCoord[count] = cid;
          count++;
        }
      }
    }
  }
  return { coordToNumber, numberToCoord };
}

app.get("/state", (req, res) => {
  getState((err, state) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(state);
  });
});

app.post("/generate", requireAdmin, (req, res) => {
  const { rows, cols } = req.body;
  if (!rows || !cols)
    return res.status(400).json({ error: "rows and cols required" });
  const newState = {
    rows: parseInt(rows),
    cols: parseInt(cols),
    blocked: [],
    names: {},
  };
  saveState(newState, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    io.emit("stateUpdated", newState);
    res.json(newState);
  });
});

app.post("/reset", requireAdmin, (req, res) => {
  getState((err, state) => {
    if (err) return res.status(500).json({ error: err.message });
    state.blocked = [];
    state.names = {};
    saveState(state, (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      io.emit("stateUpdated", state);
      res.json(state);
    });
  });
});

app.post("/update", requireAdmin, (req, res) => {
  const { boxNum, subtitle, visibility } = req.body;
  if (!boxNum) return res.status(400).json({ error: "boxNum required" });
  getState((err, state) => {
    if (err) return res.status(500).json({ error: err.message });
    const mapping = computeSnakeMapping(state.rows, state.cols, state.blocked);
    const targetCoord = mapping.numberToCoord[boxNum];
    if (!targetCoord && visibility === "hide")
      return res
        .status(400)
        .json({ error: "Box number not found or already hidden" });

    if (visibility === "hide") {
      if (!state.blocked.includes(targetCoord)) state.blocked.push(targetCoord);
      delete state.names[boxNum];
    } else {
      if (!subtitle || subtitle.toString().trim() === "")
        delete state.names[boxNum];
      else state.names[boxNum] = subtitle.toString().trim();
    }

    saveState(state, (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      io.emit("stateUpdated", state);
      res.json(state);
    });
  });
});

app.post("/admin/login", (req, res) => {
  const { user, pass } = req.body || {};
  if (user !== ADMIN_USER || pass !== ADMIN_PASS)
    return res.status(401).json({ error: "invalid credentials" });
  const payload = { user: ADMIN_USER, exp: Date.now() + TOKEN_MAX_AGE };
  const token = signToken(payload);
  res.setHeader(
    "Set-Cookie",
    `admin_token=${token}; HttpOnly; Path=/; Max-Age=${Math.floor(
      TOKEN_MAX_AGE / 1000
    )}`
  );
  res.json({ ok: true });
});

app.post("/admin/logout", (req, res) => {
  res.setHeader("Set-Cookie", `admin_token=; HttpOnly; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

io.on("connection", (socket) => {
  getState((err, state) => {
    if (!err) socket.emit("state", state);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);

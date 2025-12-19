const express = require("express");
const cors = require("cors");
const { nanoid } = require("nanoid");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const db = require("./db");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || "0.0.0.0";
const JWT_SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Helper to run queries.
const statements = {
  insertUser: db.prepare(
    "INSERT INTO users (id, name, email, passwordHash, createdAt) VALUES (@id, @name, @email, @passwordHash, @createdAt)"
  ),
  insertContract: db.prepare(
    `INSERT INTO contracts
    (id, ownerId, partnerId, title, topicCategory, description, frequencyPerWeek, durationDays, stakesLevel, status, startDate, createdAt, inviteCode)
    VALUES (@id, @ownerId, @partnerId, @title, @topicCategory, @description, @frequencyPerWeek, @durationDays, @stakesLevel, @status, @startDate, @createdAt, @inviteCode)`
  ),
  updateContractMatch: db.prepare(
    "UPDATE contracts SET partnerId=@partnerId, status=@status WHERE id=@id"
  ),
  findContractByInvite: db.prepare("SELECT * FROM contracts WHERE inviteCode = ?"),
  insertMessage: db.prepare(
    "INSERT INTO messages (id, contractId, senderId, text, createdAt) VALUES (@id, @contractId, @senderId, @text, @createdAt)"
  ),
  insertCheckin: db.prepare(
    `INSERT INTO checkins (id, contractId, userId, dateKey, done, createdAt)
     VALUES (@id, @contractId, @userId, @dateKey, @done, @createdAt)
     ON CONFLICT(contractId, userId, dateKey) DO UPDATE SET done=excluded.done`
  ),
  deleteMessages: db.prepare("DELETE FROM messages WHERE contractId = ?"),
  deleteCheckins: db.prepare("DELETE FROM checkins WHERE contractId = ?"),
  deleteContract: db.prepare("DELETE FROM contracts WHERE id = ?"),
};

function getUser(userId) {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
}

function getContractsForUser(userId) {
  const rows = db
    .prepare(
      `SELECT c.*, u.name as ownerName, p.name as partnerName
       FROM contracts c
       LEFT JOIN users u ON c.ownerId = u.id
       LEFT JOIN users p ON c.partnerId = p.id
       WHERE c.ownerId = ? OR c.partnerId = ?`
    )
    .all(userId, userId);
  return rows;
}

function tryMatchRandom(newContract) {
  // Pick first open contract in same topic and different owner.
  const candidate = db
    .prepare(
      `SELECT * FROM contracts
       WHERE status='open' AND partnerId IS NULL AND ownerId != ? AND topicCategory = ?
       ORDER BY createdAt ASC LIMIT 1`
    )
    .get(newContract.ownerId, newContract.topicCategory);
  if (!candidate) return null;

  // Mark both matched.
  statements.updateContractMatch.run({
    id: candidate.id,
    partnerId: newContract.ownerId,
    status: "matched",
  });
  statements.updateContractMatch.run({
    id: newContract.id,
    partnerId: candidate.ownerId,
    status: "matched",
  });

  // Welcome message to chat history for both.
  const welcomeText = `You've been matched! Say hi to your partner.`;
  const createdAt = new Date().toISOString();
statements.insertMessage.run({
    id: nanoid(),
    contractId: candidate.id,
    senderId: candidate.ownerId,
    text: welcomeText,
    createdAt,
  });
statements.insertMessage.run({
    id: nanoid(),
    contractId: newContract.id,
    senderId: newContract.ownerId,
    text: welcomeText,
    createdAt,
  });

  const candidateOwner = getUser(candidate.ownerId);
  return { candidate, candidateOwner };
}

function insertWelcomeMessage(contractId, senderId, text) {
  statements.insertMessage.run({
    id: nanoid(),
    contractId,
    senderId,
    text,
    createdAt: new Date().toISOString(),
  });
}

function signToken(user) {
  return jwt.sign({ sub: user.id, name: user.name, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = { id: payload.sub, name: payload.name, email: payload.email };
    next();
  } catch (e) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Seed a few demo users/contracts to make matching and browsing feel alive.
function seedDemoData() {
  const demos = [
    { id: "demo_alex", name: "Alex", email: null, passwordHash: null },
    { id: "demo_jamie", name: "Jamie", email: null, passwordHash: null },
    { id: "demo_riley", name: "Riley", email: null, passwordHash: null },
    { id: "demo_taylor", name: "Taylor", email: null, passwordHash: null },
  ];
  const existingUsers = db.prepare("SELECT id FROM users").all().map((u) => u.id);
  const now = new Date().toISOString();

  demos.forEach((u) => {
    if (!existingUsers.includes(u.id)) {
      statements.insertUser.run({ ...u, createdAt: now });
    }
  });

  // Seed open contracts if none exist for these demo users.
  const existingContracts = db.prepare("SELECT id FROM contracts").all();
  if (existingContracts.length < 2) {
    const demoContracts = [
      {
        id: "demo_contract_run",
        ownerId: "demo_alex",
        partnerId: null,
        title: "Morning runs 3x/week",
        topicCategory: "fitness",
        description: "5km runs before 8am, Tues/Thu/Sat.",
        frequencyPerWeek: 3,
        durationDays: 30,
        stakesLevel: "social",
        status: "open",
        startDate: now.slice(0, 10),
        createdAt: now,
        inviteCode: null,
      },
      {
        id: "demo_contract_sleep",
        ownerId: "demo_jamie",
        partnerId: null,
        title: "In bed by 23:00",
        topicCategory: "sleep",
        description: "No phone after 22:30, lights out by 23:00.",
        frequencyPerWeek: 6,
        durationDays: 21,
        stakesLevel: "reward",
        status: "open",
        startDate: now.slice(0, 10),
        createdAt: now,
        inviteCode: null,
      },
      {
        id: "demo_contract_study",
        ownerId: "demo_riley",
        partnerId: null,
        title: "Study 45m daily",
        topicCategory: "study",
        description: "Deep work on weekdays before noon.",
        frequencyPerWeek: 5,
        durationDays: 28,
        stakesLevel: "none",
        status: "open",
        startDate: now.slice(0, 10),
        createdAt: now,
        inviteCode: null,
      },
    ];
    demoContracts.forEach((c) => {
      const exists = db.prepare("SELECT 1 FROM contracts WHERE id = ?").get(c.id);
      if (!exists) statements.insertContract.run(c);
    });
  }
}
seedDemoData();

/* -------------------- Auth -------------------- */

app.post("/api/auth/register", (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: "Name, email, password required" });
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) return res.status(400).json({ error: "Email already registered" });
  const user = {
    id: nanoid(),
    name: name.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: bcrypt.hashSync(password, 10),
    createdAt: new Date().toISOString(),
  };
  statements.insertUser.run(user);
  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

app.post("/api/auth/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase());
  if (!user || !user.passwordHash || !bcrypt.compareSync(password, user.passwordHash)) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  const token = signToken(user);
  res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
});

/* -------------------- Routes -------------------- */

app.get("/api/me", requireAuth, (req, res) => {
  res.json(req.user);
});

app.get("/api/users/:id", requireAuth, (req, res) => {
  const user = getUser(req.params.id);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ id: user.id, name: user.name, email: user.email });
});

app.get("/api/users/:id/contracts", requireAuth, (req, res) => {
  if (req.user.id !== req.params.id) return res.status(403).json({ error: "Forbidden" });
  const list = getContractsForUser(req.params.id);
  res.json(list);
});

app.post("/api/contracts", requireAuth, (req, res) => {
  const {
    title,
    topicCategory,
    description,
    frequencyPerWeek,
    durationDays,
    stakesLevel,
    matchType,
  } = req.body;
  if (!title || !topicCategory || !frequencyPerWeek || !durationDays || !stakesLevel) {
    return res.status(400).json({ error: "Missing required fields" });
  }
  const owner = getUser(req.user.id);
  if (!owner) return res.status(404).json({ error: "Owner not found" });

  const now = new Date().toISOString();
  const contract = {
    id: nanoid(),
    ownerId: req.user.id,
    partnerId: null,
    title: title.trim(),
    topicCategory,
    description: description?.trim() || "",
    frequencyPerWeek: Number(frequencyPerWeek),
    durationDays: Number(durationDays),
    stakesLevel,
    status: "open",
    startDate: now.slice(0, 10),
    createdAt: now,
    inviteCode: matchType === "friend" ? nanoid(10) : null,
  };

  statements.insertContract.run(contract);

  let matchedWith = null;
  if (matchType === "random") {
    matchedWith = tryMatchRandom(contract);
  }

  const response = {
    contract: { ...contract, status: matchedWith ? "matched" : contract.status },
    inviteCode: contract.inviteCode,
    matchedWith: matchedWith
      ? { user: matchedWith.candidateOwner, contractId: matchedWith.candidate.id }
      : null,
  };
  res.json(response);
});

app.get("/api/contracts/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM contracts WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// Public explore: list open contracts (no partner yet).
app.get("/api/contracts", (req, res) => {
  const rows = db
    .prepare(
      `SELECT c.*, u.name as ownerName
       FROM contracts c
       LEFT JOIN users u ON c.ownerId = u.id
       WHERE c.status = 'open' AND c.partnerId IS NULL
       ORDER BY c.createdAt DESC
       LIMIT 50`
    )
    .all();
  res.json(rows);
});

app.post("/api/contracts/:id/checkins", requireAuth, (req, res) => {
  const { dateKey, done } = req.body;
  const contract = db.prepare("SELECT * FROM contracts WHERE id = ?").get(req.params.id);
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  const today = dateKey || new Date().toISOString().slice(0, 10);
  statements.insertCheckin.run({
    id: nanoid(),
    contractId: contract.id,
    userId: req.user.id,
    dateKey: today,
    done: done ? 1 : 0,
    createdAt: new Date().toISOString(),
  });
  res.json({ ok: true });
});

app.get("/api/contracts/:id/checkins", requireAuth, (req, res) => {
  const rows = db
    .prepare(
      "SELECT * FROM checkins WHERE contractId = ? ORDER BY dateKey ASC"
    )
    .all(req.params.id);
  res.json(rows);
});

app.get("/api/contracts/:id/messages", requireAuth, (req, res) => {
  const messages = db
    .prepare(
      `SELECT m.*, u.name as senderName
       FROM messages m
       LEFT JOIN users u ON m.senderId = u.id
       WHERE m.contractId = ?
       ORDER BY m.createdAt ASC`
    )
    .all(req.params.id);
  res.json(messages);
});

app.post("/api/contracts/:id/messages", requireAuth, (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: "text required" });
  const contract = db.prepare("SELECT * FROM contracts WHERE id = ?").get(req.params.id);
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  const msg = {
    id: nanoid(),
    contractId: contract.id,
    senderId: req.user.id,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };
  statements.insertMessage.run(msg);
  const sender = getUser(req.user.id);
  const withName = { ...msg, senderName: sender?.name || null };
  io.to(roomName(contract.id)).emit("new_message", withName);
  res.json(withName);
});

app.get("/api/invites/:code", (req, res) => {
  const contract = statements.findContractByInvite.get(req.params.code);
  if (!contract) return res.status(404).json({ error: "Invite not found" });
  res.json(contract);
});

app.post("/api/invites/:code/accept", requireAuth, (req, res) => {
  const userId = req.user.id;
  const contract = statements.findContractByInvite.get(req.params.code);
  if (!contract) return res.status(404).json({ error: "Invite not found" });
  if (contract.partnerId) return res.status(400).json({ error: "Already matched" });
  statements.updateContractMatch.run({
    id: contract.id,
    partnerId: userId,
    status: "matched",
  });
  const updated = db.prepare("SELECT * FROM contracts WHERE id = ?").get(contract.id);
  res.json(updated);
});

// Join an open contract directly (explore).
app.post("/api/contracts/:id/join", requireAuth, (req, res) => {
  const userId = req.user.id;
  const contract = db.prepare("SELECT * FROM contracts WHERE id = ?").get(req.params.id);
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  if (contract.ownerId === userId) return res.status(400).json({ error: "Cannot join your own contract" });
  if (contract.partnerId) return res.status(400).json({ error: "Already matched" });

  statements.updateContractMatch.run({
    id: contract.id,
    partnerId: userId,
    status: "matched",
  });

  // Welcome note for both sides.
  const owner = getUser(contract.ownerId);
  insertWelcomeMessage(contract.id, contract.ownerId, `${owner?.name || "Partner"} is ready to go!`);
  insertWelcomeMessage(contract.id, userId, "Thanks for joining this contract. Let's keep each other accountable.");

  const updated = db.prepare("SELECT * FROM contracts WHERE id = ?").get(contract.id);
  res.json(updated);
});

// Cancel/delete a contract (owner or partner).
app.delete("/api/contracts/:id", requireAuth, (req, res) => {
  const contract = db.prepare("SELECT * FROM contracts WHERE id = ?").get(req.params.id);
  if (!contract) return res.status(404).json({ error: "Contract not found" });
  if (contract.ownerId !== req.user.id && contract.partnerId !== req.user.id) {
    return res.status(403).json({ error: "Not allowed" });
  }
  statements.deleteMessages.run(contract.id);
  statements.deleteCheckins.run(contract.id);
  statements.deleteContract.run(contract.id);
  res.json({ ok: true });
});

// Simple health check for debugging connectivity.
app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

// Serve the built frontend for any non-API route.
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api") || req.path.startsWith("/socket.io")) return next();
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* -------------------- Socket.io -------------------- */
function roomName(contractId) {
  return `contract:${contractId}`;
}

io.on("connection", (socket) => {
  socket.on("join_contract", ({ contractId }) => {
    socket.join(roomName(contractId));
  });
  socket.on("send_message", ({ contractId, senderId, text }) => {
    if (!contractId || !senderId || !text) return;
    const msg = {
      id: nanoid(),
      contractId,
      senderId,
      text: text.trim(),
      createdAt: new Date().toISOString(),
    };
    statements.insertMessage.run(msg);
    const sender = getUser(senderId);
    const withName = { ...msg, senderName: sender?.name || null };
    io.to(roomName(contractId)).emit("new_message", withName);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`API listening on http://${HOST}:${PORT}`);
});

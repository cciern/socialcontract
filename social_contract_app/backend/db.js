const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "data.sqlite");
const db = new Database(dbPath);

// Initialize schema if missing.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  passwordHash TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY,
  ownerId TEXT NOT NULL,
  partnerId TEXT,
  title TEXT NOT NULL,
  topicCategory TEXT NOT NULL,
  description TEXT,
  frequencyPerWeek INTEGER NOT NULL,
  durationDays INTEGER NOT NULL,
  stakesLevel TEXT NOT NULL,
  status TEXT NOT NULL,
  startDate TEXT,
  createdAt TEXT NOT NULL,
  inviteCode TEXT,
  FOREIGN KEY(ownerId) REFERENCES users(id),
  FOREIGN KEY(partnerId) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  contractId TEXT NOT NULL,
  senderId TEXT NOT NULL,
  text TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  FOREIGN KEY(contractId) REFERENCES contracts(id),
  FOREIGN KEY(senderId) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS checkins (
  id TEXT PRIMARY KEY,
  contractId TEXT NOT NULL,
  userId TEXT NOT NULL,
  dateKey TEXT NOT NULL,
  done INTEGER NOT NULL,
  createdAt TEXT NOT NULL,
  UNIQUE(contractId, userId, dateKey),
  FOREIGN KEY(contractId) REFERENCES contracts(id),
  FOREIGN KEY(userId) REFERENCES users(id)
);
`);

// Backfill passwordHash column for existing DBs (no-op if already present).
try {
  const cols = db.prepare("PRAGMA table_info(users)").all();
  const hasPass = cols.some((c) => c.name === "passwordHash");
  if (!hasPass) {
    db.exec("ALTER TABLE users ADD COLUMN passwordHash TEXT");
  }
} catch (err) {
  // ignore if fails; startup will show errors otherwise
}

module.exports = db;

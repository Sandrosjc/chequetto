const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [], verifications: [] }, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

/* ---------------- USERS ---------------- */

function getUserById(id) {
  const db = readDb();
  return db.users.find(u => u.id === id);
}

function getUserByEmail(email) {
  const db = readDb();
  return db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

function createUser({ email, passwordHash }) {
  const db = readDb();

  const user = {
    id: Date.now().toString(),
    email: email.toLowerCase(),
    password_hash: passwordHash || null,
    email_verified_at: new Date().toISOString(),
    created_at: new Date().toISOString()
  };

  db.users.push(user);
  writeDb(db);
  return user;
}

/* ---------------- VERIFICATION (OTP) ---------------- */

function saveAuthVerification({ email, purpose, codeHash, payload, expiresAt }) {
  const db = readDb();

  db.verifications.push({
    email: email.toLowerCase(),
    purpose,
    code_hash: codeHash,
    payload: payload ? JSON.stringify(payload) : null,
    attempts: 0,
    expires_at: expiresAt
  });

  writeDb(db);
}

function getAuthVerification(email, purpose) {
  const db = readDb();
  return db.verifications.find(
    v =>
      v.email === email.toLowerCase() &&
      v.purpose === purpose
  );
}

function incrementAuthVerificationAttempts(email, purpose) {
  const db = readDb();
  const v = db.verifications.find(
    x => x.email === email.toLowerCase() && x.purpose === purpose
  );

  if (v) {
    v.attempts += 1;
    writeDb(db);
  }
}

function deleteAuthVerification(email, purpose) {
  const db = readDb();
  db.verifications = db.verifications.filter(
    v =>
      !(v.email === email.toLowerCase() && v.purpose === purpose)
  );
  writeDb(db);
}

function markEmailVerified(userId) {
  const db = readDb();
  const user = db.users.find(u => u.id === userId);

  if (user) {
    user.email_verified_at = new Date().toISOString();
    writeDb(db);
  }
}

module.exports = {
  getUserById,
  getUserByEmail,
  createUser,
  saveAuthVerification,
  getAuthVerification,
  incrementAuthVerificationAttempts,
  deleteAuthVerification,
  markEmailVerified
};

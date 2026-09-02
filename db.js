const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'database.json');

function readDb() {
  if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: [] }, null, 2));
  }
  try {
    const data = fs.readFileSync(DB_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { users: [] };
  }
}

function writeDb(data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUserById(id) {
  const db = readDb();
  return db.users.find(u => u.id === id);
}

function getUserByEmail(email) {
  const db = readDb();
  return db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

function createUser({ email, password, verificationCode }) {
  const db = readDb();
  const newUser = {
    id: Date.now().toString(),
    email,
    password,
    verification_code: verificationCode,
    email_verified_at: null,
    created_at: new Date().toISOString()
  };
  db.users.push(newUser);
  writeDb(db);
  return newUser;
}

function updateUserVerification(userId) {
  const db = readDb();
  const user = db.users.find(u => u.id === userId);
  if (user) {
    user.email_verified_at = new Date().toISOString();
    user.verification_code = null;
    writeDb(db);
  }
}

function saveAuthVerification(email, code) {
  const db = readDb();
  const user = db.users.find(u => u.email.toLowerCase() === email.toLowerCase());
  if (user) {
    user.verification_code = code;
    writeDb(db);
  }
}

module.exports = {
  getUserById,
  getUserByEmail,
  createUser,
  updateUserVerification,
  saveAuthVerification
};

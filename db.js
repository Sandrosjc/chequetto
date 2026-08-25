// db.js — banco de dados (SQLite local). Formato CommonJS.
const Database = require('better-sqlite3');
const crypto = require('crypto');

const db = new Database(process.env.DB_PATH || './oficina.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT,
  name TEXT,
  credits INTEGER NOT NULL DEFAULT 0,
  referral_code TEXT UNIQUE NOT NULL,
  referred_by TEXT,
  unlimited_credits INTEGER NOT NULL DEFAULT 0,
  is_admin INTEGER NOT NULL DEFAULT 0,
  signup_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  invited_user_id TEXT NOT NULL,
  credited INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ip_signups (
  ip TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  prompt TEXT NOT NULL,
  plano TEXT,
  html TEXT NOT NULL,
  nome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'BRL',
  status TEXT NOT NULL DEFAULT 'pending',
  gateway TEXT,
  gateway_checkout_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function genReferralCode() {
  return crypto.randomBytes(4).toString('hex');
}

const CREDIT_RULES = {
  SIGNUP_FREE: 20,
  SIGNUP_VIA_INVITE_BONUS: 6,
  INVITE_TIERS: [
    { tier: 1, invitesRequired: 1, bonus: 6 },
    { tier: 2, invitesRequired: 2, bonus: 12 },
    { tier: 3, invitesRequired: 3, bonus: 18 },
  ],
};

function createUser({ email, passwordHash, name, referredByCode, signupIp }) {
  const id = newId();
  const referralCode = genReferralCode();

  let referredBy = null;
  let startingCredits = CREDIT_RULES.SIGNUP_FREE;

  if (referredByCode) {
    const referrer = db.prepare('SELECT * FROM users WHERE referral_code = ?').get(referredByCode);
    if (referrer) {
      referredBy = referrer.id;
      startingCredits += CREDIT_RULES.SIGNUP_VIA_INVITE_BONUS;
    }
  }

  db.prepare(
    `INSERT INTO users (id, email, password_hash, name, credits, referral_code, referred_by, signup_ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, email, passwordHash || null, name || null, startingCredits, referralCode, referredBy, signupIp || null);

  if (signupIp) {
    db.prepare('INSERT INTO ip_signups (ip, user_id) VALUES (?, ?)').run(signupIp, id);
  }

  if (referredBy) {
    db.prepare(
      'INSERT INTO invites (id, inviter_id, invited_user_id, credited) VALUES (?, ?, ?, 0)'
    ).run(newId(), referredBy, id);
  }

  return getUserById(id);
}

function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function getUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function countSignupsByIp(ip) {
  return db.prepare('SELECT COUNT(*) as c FROM ip_signups WHERE ip = ?').get(ip).c;
}

function deductCredit(userId) {
  const user = getUserById(userId);
  if (!user) throw new Error('Usuário não encontrado');
  if (user.unlimited_credits) return user;
  if (user.credits <= 0) throw new Error('SEM_CREDITOS');
  db.prepare('UPDATE users SET credits = credits - 1 WHERE id = ?').run(userId);
  return getUserById(userId);
}

function applyInviteBonusIfNeeded(invitedUserId) {
  const invite = db.prepare('SELECT * FROM invites WHERE invited_user_id = ? AND credited = 0').get(invitedUserId);
  if (!invite) return;

  const inviterCreditedCount = db
    .prepare('SELECT COUNT(*) as c FROM invites WHERE inviter_id = ? AND credited = 1')
    .get(invite.inviter_id).c;

  const nextTierIndex = Math.min(inviterCreditedCount, CREDIT_RULES.INVITE_TIERS.length - 1);
  const bonus = CREDIT_RULES.INVITE_TIERS[nextTierIndex].bonus;

  db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(bonus, invite.inviter_id);
  db.prepare('UPDATE invites SET credited = 1 WHERE id = ?').run(invite.id);

  return bonus;
}

function invitesRequiredForNextTier(user) {
  const doneInvites = db
    .prepare('SELECT COUNT(*) as c FROM invites WHERE inviter_id = ? AND credited = 1')
    .get(user.id).c;
  const tierIndex = Math.min(doneInvites, CREDIT_RULES.INVITE_TIERS.length - 1);
  return CREDIT_RULES.INVITE_TIERS[tierIndex];
}

function setUnlimited(userId, value) {
  db.prepare('UPDATE users SET unlimited_credits = ? WHERE id = ?').run(value ? 1 : 0, userId);
  return getUserById(userId);
}

// ---------- Projetos salvos (o "guardar na plataforma") ----------

function saveProject({ userId, prompt, plano, html, nome }) {
  const id = newId();
  db.prepare(
    `INSERT INTO projects (id, user_id, prompt, plano, html, nome) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId || null, prompt, JSON.stringify(plano || []), html, nome || prompt.slice(0, 60));
  return getProjectById(id);
}

function getProjectById(id) {
  return db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
}

function listProjectsByUser(userId) {
  return db
    .prepare('SELECT id, prompt, plano, html, nome, created_at FROM projects WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId)
    .map((project) => ({
      ...project,
      plano: JSON.parse(project.plano || '[]'),
    }));
}

function createPendingSubscription({ userId, planId, amount, currency, gateway }) {
  const id = newId();
  db.prepare(
    `INSERT INTO subscriptions (id, user_id, plan_id, amount, currency, gateway)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, planId, amount, currency, gateway || null);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
}

module.exports = {
  CREDIT_RULES,
  createUser,
  getUserByEmail,
  getUserById,
  countSignupsByIp,
  deductCredit,
  applyInviteBonusIfNeeded,
  invitesRequiredForNextTier,
  setUnlimited,
  saveProject,
  getProjectById,
  listProjectsByUser,
  createPendingSubscription,
};

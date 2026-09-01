// db.js — banco de dados (SQLite local). Formato CommonJS.
//
// O SQLite não possui um tipo JSONB nativo como o PostgreSQL. A coluna
// `projects.files` usa a declaração JSONB (aceita pelo SQLite) e armazena
// JSON serializado. Todas as entradas e saídas passam pelos normalizadores
// abaixo, mantendo uma estrutura previsível e válida.
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

CREATE TABLE IF NOT EXISTS auth_verifications (
  email TEXT NOT NULL,
  purpose TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  payload TEXT,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (email, purpose)
);

CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at INTEGER NOT NULL,
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
  user_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  files JSONB NOT NULL DEFAULT '[]',
  prompt TEXT NOT NULL DEFAULT '',
  plano TEXT,
  html TEXT NOT NULL DEFAULT '',
  nome TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
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

try {
  db.exec('ALTER TABLE users ADD COLUMN email_verified_at TEXT');
} catch (error) {
  if (!String(error.message).includes('duplicate column name')) throw error;
}
try {
  db.exec('ALTER TABLE users ADD COLUMN is_verified INTEGER NOT NULL DEFAULT 0');
} catch (error) {
  if (!String(error.message).includes('duplicate column name')) throw error;
}

function getTableColumns(tableName) {
  return new Set(db.prepare(`PRAGMA table_info(${tableName})`).all().map((column) => column.name));
}

function addColumnIfMissing(tableName, columnName, definition) {
  if (!getTableColumns(tableName).has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

// Migração compatível com a tabela projects da versão anterior. A tabela
// antiga usava `nome`, `html` e `plano`; as colunas antigas permanecem para
// não quebrar instalações existentes, enquanto a API passa a usar `name`,
// `files` e `updated_at`.
addColumnIfMissing('projects', 'name', "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing('projects', 'files', "JSONB NOT NULL DEFAULT '[]'");
addColumnIfMissing('projects', 'updated_at', "TEXT NOT NULL DEFAULT ''");

db.exec(`
  UPDATE projects
     SET name = CASE
       WHEN trim(COALESCE(name, '')) <> '' THEN name
       WHEN trim(COALESCE(nome, '')) <> '' THEN nome
       ELSE substr(COALESCE(prompt, ''), 1, 60)
     END
   WHERE trim(COALESCE(name, '')) = '';

  UPDATE projects
     SET updated_at = COALESCE(NULLIF(updated_at, ''), created_at, datetime('now'))
   WHERE trim(COALESCE(updated_at, '')) = '';
`);

function invalidProjectData(message) {
  const error = new Error(message);
  error.code = 'INVALID_PROJECT';
  return error;
}

function parseJson(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    throw invalidProjectData(`O campo ${fieldName} contém JSON inválido.`);
  }
}

function stringifyJson(value, fieldName) {
  try {
    return JSON.stringify(value);
  } catch {
    throw invalidProjectData(`O campo ${fieldName} não pôde ser serializado.`);
  }
}

function normalizeFiles(files, fallbackHtml = '') {
  let parsed = parseJson(files, undefined, 'files');

  if (parsed === undefined || parsed === null) {
    return fallbackHtml
      ? [{ path: 'index.html', content: fallbackHtml, language: 'html' }]
      : [];
  }

  if (!Array.isArray(parsed)) {
    // Também aceita um mapa { "index.html": "<html>..." } para facilitar a
    // migração de clientes antigos, convertendo-o para o formato canônico.
    if (typeof parsed === 'object') {
      parsed = Object.entries(parsed).map(([filePath, content]) => ({ path: filePath, content }));
    } else {
      throw invalidProjectData('O campo files precisa ser uma lista de arquivos.');
    }
  }

  if (parsed.length === 0 && fallbackHtml) {
    return [{ path: 'index.html', content: fallbackHtml, language: 'html' }];
  }

  return parsed.map((file, index) => {
    if (!file || typeof file !== 'object' || Array.isArray(file)) {
      throw invalidProjectData(`O arquivo ${index + 1} possui uma estrutura inválida.`);
    }
    const filePath = file.path || file.name;
    if (typeof filePath !== 'string' || !filePath.trim()) {
      throw invalidProjectData(`O arquivo ${index + 1} precisa de path ou name.`);
    }
    if (typeof file.content !== 'string') {
      throw invalidProjectData(`O conteúdo de ${filePath} precisa ser texto.`);
    }

    // Reconstrói o objeto para eliminar referências inesperadas e preservar
    // metadados futuros sem alterar o objeto recebido pelo chamador.
    return { ...file, path: filePath.trim(), content: file.content };
  });
}

function normalizePlano(plano) {
  const parsed = parseJson(plano, [], 'plano');
  if (!Array.isArray(parsed)) throw invalidProjectData('O campo plano precisa ser uma lista.');
  return parsed.map((item) => String(item)).filter(Boolean).slice(0, 50);
}

function htmlFromFiles(files) {
  const htmlFile = files.find((file) => /(^|\/)index\.html?$/i.test(file.path))
    || files.find((file) => /\.html?$/i.test(file.path));
  return htmlFile?.content || '';
}

// Converte projetos legados que tinham somente html em um arquivo canônico.
for (const project of db.prepare('SELECT id, html, files, plano FROM projects').all()) {
  let files = [];
  try {
    files = normalizeFiles(project.files, project.html || '');
  } catch {
    files = project.html ? [{ path: 'index.html', content: project.html, language: 'html' }] : [];
  }
  let plano = [];
  try {
    plano = normalizePlano(project.plano);
  } catch {
    plano = [];
  }
  db.prepare('UPDATE projects SET files = ?, plano = ? WHERE id = ?').run(
    JSON.stringify(files),
    JSON.stringify(plano),
    project.id
  );
}

function newId() {
  return crypto.randomBytes(12).toString('hex');
}

function genReferralCode() {
  return crypto.randomBytes(4).toString('hex');
}

const CREDIT_RULES = {
  SIGNUP_FREE: 20,
  SIGNUP_VIA_INVITE_BONUS: 0,
  INVITE_TIERS: [
    { tier: 1, invitesRequired: 1, bonus: 20 },
    { tier: 2, invitesRequired: 2, bonus: 20 },
    { tier: 3, invitesRequired: 3, bonus: 20 },
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

function saveAuthVerification({ email, purpose, codeHash, payload, expiresAt }) {
  db.prepare(
    `INSERT INTO auth_verifications (email, purpose, code_hash, payload, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email, purpose) DO UPDATE SET
       code_hash = excluded.code_hash,
       payload = excluded.payload,
       expires_at = excluded.expires_at,
       attempts = 0,
       created_at = datetime('now')`
  ).run(email, purpose, codeHash, payload ? JSON.stringify(payload) : null, expiresAt);
}

function getAuthVerification(email, purpose) {
  return db.prepare('SELECT * FROM auth_verifications WHERE email = ? AND purpose = ?').get(email, purpose);
}

function incrementAuthVerificationAttempts(email, purpose) {
  db.prepare('UPDATE auth_verifications SET attempts = attempts + 1 WHERE email = ? AND purpose = ?').run(email, purpose);
}

function deleteAuthVerification(email, purpose) {
  db.prepare('DELETE FROM auth_verifications WHERE email = ? AND purpose = ?').run(email, purpose);
}

function markEmailVerified(userId) {
  db.prepare("UPDATE users SET email_verified_at = datetime('now'), is_verified = 1 WHERE id = ?").run(userId);
  return getUserById(userId);
}

function saveEmailToken({ userId, token, expiresAt }) {
  const tokenHash = crypto.createHash('sha256').update(String(token)).digest('hex');
  db.prepare('DELETE FROM email_tokens WHERE user_id = ? OR expires_at < ?').run(userId, Date.now());
  db.prepare(
    'INSERT INTO email_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)'
  ).run(newId(), userId, tokenHash, expiresAt);
}

function getEmailToken(token) {
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  return db.prepare('SELECT * FROM email_tokens WHERE token = ?').get(tokenHash);
}

function deleteEmailToken(token) {
  const tokenHash = crypto.createHash('sha256').update(String(token || '')).digest('hex');
  db.prepare('DELETE FROM email_tokens WHERE token = ?').run(tokenHash);
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

  const users = db.prepare('SELECT id, signup_ip FROM users WHERE id IN (?, ?)').all(invite.inviter_id, invitedUserId);
  const inviter = users.find((user) => user.id === invite.inviter_id);
  const invited = users.find((user) => user.id === invitedUserId);
  if (!inviter || !invited || !inviter.signup_ip || !invited.signup_ip || inviter.signup_ip === invited.signup_ip) return;

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

function projectRow(row) {
  if (!row) return null;
  const files = normalizeFiles(row.files, row.html || '');
  const plano = normalizePlano(row.plano);
  return {
    ...row,
    name: row.name || row.nome || row.prompt?.slice(0, 60) || 'Projeto sem nome',
    // `nome` é mantido na resposta por compatibilidade com clientes antigos.
    nome: row.name || row.nome || row.prompt?.slice(0, 60) || 'Projeto sem nome',
    files,
    plano,
  };
}

function saveProject({ id, userId, prompt, plano, html, files, name, nome }) {
  if (!userId) throw invalidProjectData('Um projeto precisa estar vinculado a um usuário.');

  const normalizedPrompt = typeof prompt === 'string' ? prompt.trim() : '';
  const normalizedFiles = normalizeFiles(files, html || '');
  const normalizedHtml = typeof html === 'string' && html
    ? html
    : htmlFromFiles(normalizedFiles);
  if (!normalizedHtml && normalizedFiles.length === 0) {
    throw invalidProjectData('O projeto precisa ter html ou pelo menos um arquivo.');
  }

  const normalizedPlano = normalizePlano(plano);
  const normalizedName = String(name || nome || normalizedPrompt.slice(0, 60) || 'Projeto sem nome').trim().slice(0, 120);
  const serializedFiles = stringifyJson(normalizedFiles, 'files');
  const serializedPlano = stringifyJson(normalizedPlano, 'plano');

  if (id) {
    const existing = db.prepare('SELECT id, user_id FROM projects WHERE id = ?').get(id);
    if (!existing || existing.user_id !== userId) {
      const error = new Error('Projeto não encontrado.');
      error.code = 'PROJECT_NOT_FOUND';
      throw error;
    }

    db.prepare(
      `UPDATE projects
          SET prompt = ?, plano = ?, html = ?, files = ?, name = ?, nome = ?, updated_at = datetime('now')
        WHERE id = ? AND user_id = ?`
    ).run(normalizedPrompt, serializedPlano, normalizedHtml, serializedFiles, normalizedName, normalizedName, id, userId);
    return getProjectById(id);
  }

  const projectId = newId();
  db.prepare(
    `INSERT INTO projects
      (id, user_id, name, files, prompt, plano, html, nome, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
  ).run(projectId, userId, normalizedName, serializedFiles, normalizedPrompt, serializedPlano, normalizedHtml, normalizedName);
  return getProjectById(projectId);
}

function getProjectById(id) {
  return projectRow(db.prepare('SELECT * FROM projects WHERE id = ?').get(id));
}

function listProjectsByUser(userId) {
  return db
    .prepare(
      `SELECT id, user_id, name, files, prompt, plano, html, nome, created_at, updated_at
         FROM projects
        WHERE user_id = ?
        ORDER BY updated_at DESC, created_at DESC`
    )
    .all(userId)
    .map(projectRow);
}

function renameProject({ id, userId, name }) {
  const normalizedName = String(name || '').trim().slice(0, 120);
  if (!normalizedName) throw invalidProjectData('Informe um nome para o projeto.');

  const result = db.prepare(
    `UPDATE projects
        SET name = ?, nome = ?, updated_at = datetime('now')
      WHERE id = ? AND user_id = ?`
  ).run(normalizedName, normalizedName, id, userId);

  if (!result.changes) {
    const error = new Error('Projeto não encontrado.');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }
  return getProjectById(id);
}

function deleteProject({ id, userId }) {
  const result = db.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').run(id, userId);
  if (!result.changes) {
    const error = new Error('Projeto não encontrado.');
    error.code = 'PROJECT_NOT_FOUND';
    throw error;
  }
  return true;
}

function createPendingSubscription({ userId, planId, amount, currency, gateway, gatewayCheckoutId }) {
  const id = newId();
  db.prepare(
     `INSERT INTO subscriptions (id, user_id, plan_id, amount, currency, gateway, gateway_checkout_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, userId, planId, amount, currency, gateway || null, gatewayCheckoutId || null);
  return db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(id);
}

module.exports = {
  CREDIT_RULES,
  createUser,
  getUserByEmail,
  getUserById,
  saveEmailToken,
  getEmailToken,
  deleteEmailToken,
  saveAuthVerification,
  getAuthVerification,
  incrementAuthVerificationAttempts,
  deleteAuthVerification,
  markEmailVerified,
  countSignupsByIp,
  deductCredit,
  applyInviteBonusIfNeeded,
  invitesRequiredForNextTier,
  setUnlimited,
  normalizeFiles,
  normalizePlano,
  saveProject,
  renameProject,
  deleteProject,
  getProjectById,
  listProjectsByUser,
  createPendingSubscription,
};

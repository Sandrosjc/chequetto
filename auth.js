// auth.js — login (JWT em cookie) + senha de hash. Formato CommonJS.
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não configurado no .env — gere um valor aleatório longo antes de rodar.');
}

function signUserToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: '30d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.oficina_token;
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Não autenticado' });
  req.userId = payload.uid;
  next();
}

function hashPassword(plain) {
  return bcrypt.hashSync(plain, 10);
}

function comparePassword(plain, hash) {
  return bcrypt.compareSync(plain, hash);
}

module.exports = { signUserToken, verifyToken, requireAuth, hashPassword, comparePassword };

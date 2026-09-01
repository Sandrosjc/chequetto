const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const archiver = require('archiver');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const dotenv = require('dotenv');
dotenv.config();
let nodemailer = null;
try {
  nodemailer = require('nodemailer');
} catch {
  // O envio por SMTP é opcional; o modo de desenvolvimento registra o link.
}
const cookieParser = require('cookie-parser');
const { gerarComGemini, refinarComGemini, getApiKeys } = require('./gemini-manager');
const {
  createUser,
  getUserByEmail,
  getUserById,
  applyInviteBonusIfNeeded,
  invitesRequiredForNextTier,
  countSignupsByIp,
  saveProject,
  renameProject,
  deleteProject,
  getProjectById,
  listProjectsByUser,
  createPendingSubscription,
  setUnlimited,
  saveAuthVerification,
  getAuthVerification,
  incrementAuthVerificationAttempts,
  deleteAuthVerification,
  markEmailVerified,
  saveEmailToken,
  getEmailToken,
  deleteEmailToken,
} = require('./db');
const { signUserToken, requireAuth, hashPassword, comparePassword } = require('./auth');
const plans = require('./plans.json');

const app = express();
const PORT = process.env.PORT || 10000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 50 * 1024 * 1024 },
});

const keys = getApiKeys();
const ASAAS_API_URL = process.env.ASAAS_API_URL || 'https://api.asaas.com/v3';

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
}

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    credits: user.credits,
    unlimited: !!user.unlimited_credits,
    referralCode: user.referral_code,
  };
}

async function asaasRequest(endpoint, options = {}) {
  if (!process.env.ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada no servidor.');
  const response = await fetch(`${ASAAS_API_URL}${endpoint}`, {
    ...options,
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      access_token: process.env.ASAAS_API_KEY,
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.errors?.map((item) => item.description).join(', ');
    throw new Error(detail || data.message || `Asaas respondeu com HTTP ${response.status}.`);
  }
  return data;
}

function asaasSubscriptionCycle(plan) {
  return { month: 'MONTHLY', quarter: 'QUARTERLY', year: 'ANNUALLY' }[plan.interval];
}

// tenta pegar o usuário logado, sem exigir login (gerar app funciona sem conta também)
function tryGetUser(req) {
  const token = req.cookies && req.cookies.oficina_token;
  if (!token) return null;
  const { verifyToken } = require('./auth');
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(payload.uid);
}

function projectSaveErrorStatus(error) {
  if (error.code === 'INVALID_PROJECT') return 400;
  if (error.code === 'PROJECT_NOT_FOUND') return 404;
  return 500;
}

const GITHUB_API_URL = 'https://api.github.com';
const GITHUB_MAX_FILES = 80;
const GITHUB_MAX_FILE_BYTES = 1024 * 1024;
const GITHUB_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

function parseGithubRepoUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch {
    throw new Error('Cole uma URL válida de um repositório do GitHub.');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'github.com') {
    throw new Error('Use uma URL https://github.com/usuario/repositorio.');
  }
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 2) throw new Error('A URL precisa conter usuário e repositório.');
  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, '');
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
    throw new Error('URL de repositório do GitHub inválida.');
  }
  return { owner, repo };
}

function githubHeaders(token) {
  return {
    accept: 'application/vnd.github+json',
    'content-type': 'application/json',
    'user-agent': 'Chequetto',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

async function githubRequest(endpoint, options = {}, token = '') {
  const response = await fetch(`${GITHUB_API_URL}${endpoint}`, {
    ...options,
    headers: { ...githubHeaders(token), ...(options.headers || {}) },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.message || `GitHub respondeu com HTTP ${response.status}.`;
    const error = new Error(detail);
    error.status = response.status;
    throw error;
  }
  return data;
}

function languageForGithubPath(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return {
    '.html': 'html', '.htm': 'html', '.css': 'css', '.js': 'javascript',
    '.jsx': 'javascript', '.ts': 'typescript', '.tsx': 'typescript',
    '.json': 'json', '.md': 'markdown', '.py': 'python', '.sql': 'sql',
    '.yaml': 'yaml', '.yml': 'yaml', '.xml': 'xml',
  }[extension] || 'text';
}

async function importGithubFiles(repoUrl, token = '') {
  const { owner, repo } = parseGithubRepoUrl(repoUrl);
  const repository = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {}, token);
  const branch = repository.default_branch || 'main';
  const tree = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    {},
    token
  );
  if (tree.truncated) throw new Error('Este repositório é grande demais para ser importado de uma vez.');

  const candidates = (tree.tree || [])
    .filter((item) => item.type === 'blob' && item.size <= GITHUB_MAX_FILE_BYTES)
    .filter((item) => !/(^|\/)(node_modules|\.git|dist|build)\//.test(item.path))
    .slice(0, GITHUB_MAX_FILES);
  const files = [];
  let totalBytes = 0;

  for (const item of candidates) {
    if (totalBytes + (item.size || 0) > GITHUB_MAX_TOTAL_BYTES) break;
    const blob = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(item.sha)}`,
      {},
      token
    );
    if (blob.encoding !== 'base64' || typeof blob.content !== 'string') continue;
    const buffer = Buffer.from(blob.content.replace(/\s/g, ''), 'base64');
    if (buffer.includes(0)) continue;
    const content = buffer.toString('utf8');
    files.push({ path: item.path, content, language: languageForGithubPath(item.path) });
    totalBytes += Buffer.byteLength(content, 'utf8');
  }

  if (!files.length) throw new Error('Nenhum arquivo de texto compatível foi encontrado nesse repositório.');
  return {
    owner,
    repo,
    name: repository.name || repo,
    fullName: repository.full_name || `${owner}/${repo}`,
    branch,
    files,
  };
}

async function pushProjectToGithub({ project, repoUrl, branch, message, token }) {
  const { owner, repo } = parseGithubRepoUrl(repoUrl);
  const repository = await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, {}, token);
  const targetBranch = String(branch || repository.default_branch || 'main').trim();
  if (!/^[A-Za-z0-9._/-]+$/.test(targetBranch) || targetBranch.includes('..')) {
    throw new Error('Nome de branch inválido.');
  }
  const files = Array.isArray(project.files) ? project.files : [];
  if (!files.length) throw new Error('O projeto não possui arquivos para enviar.');

  let baseCommit = null;
  try {
    const ref = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${targetBranch.split('/').map(encodeURIComponent).join('/')}`,
      {},
      token
    );
    baseCommit = ref.object?.sha || null;
  } catch (error) {
    if (error.status !== 404) throw error;
    const defaultRef = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/ref/heads/${repository.default_branch}`,
      {},
      token
    );
    baseCommit = defaultRef.object?.sha || null;
  }
  if (!baseCommit) throw new Error('Não foi possível localizar o commit base do repositório.');

  const baseCommitData = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits/${baseCommit}`,
    {},
    token
  );
  const treeEntries = [];
  for (const file of files) {
    const blob = await githubRequest(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/blobs`,
      { method: 'POST', body: JSON.stringify({ content: file.content, encoding: 'utf-8' }) },
      token
    );
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
  }

  const tree = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/trees`,
    {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseCommitData.tree.sha, tree: treeEntries }),
    },
    token
  );
  const commit = await githubRequest(
    `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/commits`,
    {
      method: 'POST',
      body: JSON.stringify({
        message: String(message || `Atualização pelo Chequetto - ${project.name || 'projeto'}`).slice(0, 200),
        tree: tree.sha,
        parents: [baseCommit],
      }),
    },
    token
  );

  const refPath = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs/heads/${targetBranch.split('/').map(encodeURIComponent).join('/')}`;
  try {
    await githubRequest(refPath, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    }, token);
  } catch (error) {
    if (error.status !== 404) throw error;
    await githubRequest(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${targetBranch}`, sha: commit.sha }),
    }, token);
  }
  return {
    owner,
    repo,
    branch: targetBranch,
    sha: commit.sha,
    url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    filesCount: files.length,
  };
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', keysLoaded: keys.length });
});

app.get('/api/plans', (req, res) => {
  res.json({ plans });
});

app.post('/api/files/extract', (req, res, next) => {
  upload.array('files', 10)(req, res, (error) => {
    if (error) return next(error);
    next();
  });
}, async (req, res) => {
  try {
    const documents = await Promise.all((req.files || []).map(async (file) => {
      const extension = path.extname(file.originalname).toLowerCase();
      let text = '';
      let readable = true;

      if (extension === '.pdf' || file.mimetype === 'application/pdf') {
        text = (await pdfParse(file.buffer)).text;
      } else if (extension === '.docx') {
        text = (await mammoth.extractRawText({ buffer: file.buffer })).value;
      } else if (['.xlsx', '.xls', '.ods'].includes(extension)) {
        const workbook = XLSX.read(file.buffer, { type: 'buffer' });
        text = workbook.SheetNames.map((sheetName) => {
          const sheet = workbook.Sheets[sheetName];
          return `Planilha: ${sheetName}\n${XLSX.utils.sheet_to_csv(sheet)}`;
        }).join('\n\n');
      } else if (['.txt', '.md', '.csv', '.json', '.html', '.htm', '.js', '.jsx', '.ts', '.tsx', '.css', '.scss', '.xml', '.yaml', '.yml', '.sql', '.py', '.java', '.go', '.rs', '.php', '.vue', '.svelte', '.log', '.rtf'].includes(extension) || file.mimetype.startsWith('text/')) {
        text = file.buffer.toString('utf8');
      } else {
        const binary = file.buffer.subarray(0, Math.min(file.buffer.length, 100000)).includes(0);
        if (!binary) text = file.buffer.toString('utf8');
        else readable = false;
      }

      return {
        name: file.originalname,
        readable,
        text: text.trim().slice(0, 50000),
        message: readable ? undefined : 'Formato anexado sem extração de texto disponível.',
      };
    }));
    res.json({ documents });
  } catch (error) {
    res.status(400).json({ error: error.message || 'Não foi possível ler os arquivos.' });
  }
});

app.use('/api/files/extract', (error, req, res, next) => {
  if (!error) return next();
  const message = error.code === 'LIMIT_FILE_SIZE'
    ? 'O arquivo é maior que o limite de 50 MB.'
    : error.code === 'LIMIT_FILE_COUNT'
      ? 'Você pode enviar no máximo 10 arquivos por vez.'
      : error.message || 'Não foi possível receber o arquivo.';
  res.status(400).json({ error: message });
});

// ---------- Auth ----------

function normalizeEmail(email) {
  return (email || '').trim().toLowerCase();
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function hashVerificationCode(code) {
  return crypto.createHash('sha256').update(code).digest('hex');
}

function emailTransport() {
  if (!nodemailer || !process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD || '' }
      : undefined,
  });
}

async function sendVerificationEmail({ email, code, verificationUrl }) {
  const subject = 'Confirme seu e-mail no Chequetto';
  const text = [
    'Confirme seu e-mail para ativar sua conta Chequetto.',
    verificationUrl ? `Abra este link: ${verificationUrl}` : '',
    code ? `Código alternativo: ${code}` : '',
  ].filter(Boolean).join('\n\n');
  const html = `
    <h2>Confirme seu e-mail no Chequetto</h2>
    <p>Use o botão abaixo para ativar sua conta.</p>
    ${verificationUrl ? `<p><a href="${verificationUrl}">Confirmar e-mail</a></p>` : ''}
    ${code ? `<p>Ou informe este código no aplicativo: <strong>${code}</strong></p>` : ''}
  `;

  const transport = emailTransport();
  if (transport) {
    await transport.sendMail({
      from: process.env.AUTH_FROM_EMAIL || process.env.SMTP_USER,
      to: email,
      subject,
      text,
      html,
    });
    return { mode: 'smtp' };
  }

  if (process.env.RESEND_API_KEY && process.env.AUTH_FROM_EMAIL) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: process.env.AUTH_FROM_EMAIL,
        to: [email],
        subject,
        text,
        html,
      }),
    });
    if (!response.ok) throw new Error('Não foi possível enviar o e-mail de confirmação.');
    return { mode: 'resend' };
  }

  // Fallback seguro para desenvolvimento local: não bloqueia o cadastro e
  // expõe o link apenas no console do servidor, nunca na resposta HTTP.
  console.info('[AUTH][DEV] E-mail de confirmação não configurado.', { email, verificationUrl, code });
  return { mode: 'console' };
}

async function sendVerificationCode(email, code) {
  return sendVerificationEmail({ email, code });
}

async function issueEmailToken(userId, email, baseUrl) {
  const token = crypto.randomBytes(32).toString('hex');
  const verificationUrl = `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`;
  saveEmailToken({ userId, token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 });
  try {
    await sendVerificationEmail({ email, verificationUrl });
    return verificationUrl;
  } catch (error) {
    deleteEmailToken(token);
    throw error;
  }
}

function requestBaseUrl(req) {
  return String(process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, referralCode } = req.body || {};
  const finalEmail = normalizeEmail(email);
  if (!validEmail(finalEmail) || typeof password !== 'string') {
    return res.status(400).json({ error: 'Informe um e-mail válido e uma senha.' });
  }
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (getUserByEmail(finalEmail)) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });

  try {
    const user = createUser({
      email: finalEmail,
      passwordHash: hashPassword(password),
      name,
      referredByCode: referralCode,
      signupIp: clientIp(req),
    });
    await issueEmailToken(user.id, finalEmail, requestBaseUrl(req));
    return res.status(202).json({
      message: 'Cadastro criado. Verifique seu e-mail para ativar a conta.',
      requiresVerification: true,
    });
  } catch (error) {
    console.error('Erro ao registrar usuário:', error.message);
    return res.status(503).json({ error: error.message || 'Não foi possível enviar o e-mail de confirmação.' });
  }
});

app.get('/api/auth/verify', (req, res) => {
  const record = getEmailToken(req.query?.token);
  if (!record || record.expires_at < Date.now()) {
    if (record) deleteEmailToken(req.query.token);
    return res.redirect('/?auth_error=Link%20de%20confirma%C3%A7%C3%A3o%20inv%C3%A1lido%20ou%20expirado.');
  }
  const user = getUserById(record.user_id);
  if (!user) {
    deleteEmailToken(req.query.token);
    return res.redirect('/?auth_error=Conta%20n%C3%A3o%20encontrada.');
  }
  markEmailVerified(user.id);
  deleteEmailToken(req.query.token);
  return res.redirect('/?auth_message=E-mail%20confirmado%20com%20sucesso.%20Agora%20voc%C3%AA%20pode%20entrar.');
});

app.post('/api/auth/login', (req, res) => {
  const finalEmail = normalizeEmail(req.body?.email);
  const password = req.body?.password;
  if (!validEmail(finalEmail) || typeof password !== 'string') {
    return res.status(400).json({ error: 'Informe e-mail e senha.' });
  }
  const user = getUserByEmail(finalEmail);
  if (!user || !user.password_hash || !comparePassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }
  if (!(user.email_verified_at || user.is_verified)) {
    return res.status(403).json({
      code: 'EMAIL_NOT_VERIFIED',
      error: 'Confirme seu e-mail antes de entrar.',
    });
  }
  issueSession(res, user);
  return res.json({ user: publicUser(getUserByEmail(finalEmail)) });
});

async function issueVerificationCode(email, purpose, payload) {
  const code = String(crypto.randomInt(100000, 1000000));
  saveAuthVerification({
    email,
    purpose,
    codeHash: hashVerificationCode(code),
    payload,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });
  try {
    await sendVerificationCode(email, code);
  } catch (error) {
    deleteAuthVerification(email, purpose);
    throw error;
  }
}

function verificationMatches(record, code) {
  if (!record || record.expires_at < Date.now() || record.attempts >= 5) return false;
  const expected = Buffer.from(record.code_hash, 'hex');
  const received = Buffer.from(hashVerificationCode(String(code || '')), 'hex');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

function issueSession(res, user) {
  const token = signUserToken(user);
  res.cookie('oficina_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
}

app.post('/api/auth/signup/request-code', async (req, res) => {
  const { email, password, name, referralCode } = req.body || {};
  const finalEmail = normalizeEmail(email);
  if (!validEmail(finalEmail) || !password) return res.status(400).json({ error: 'Informe um e-mail válido e uma senha.' });
  if (password.length < 6) return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  if (getUserByEmail(finalEmail)) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
  try {
    await issueVerificationCode(finalEmail, 'signup', {
      name, passwordHash: hashPassword(password), referralCode, signupIp: clientIp(req),
    });
    res.json({ message: 'Código de verificação enviado para seu e-mail.' });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.post('/api/auth/signup/verify', (req, res) => {
  const finalEmail = normalizeEmail(req.body?.email);
  const record = getAuthVerification(finalEmail, 'signup');
  if (!verificationMatches(record, req.body?.code)) {
    if (record) incrementAuthVerificationAttempts(finalEmail, 'signup');
    return res.status(401).json({ error: 'Código inválido ou expirado.' });
  }
  const payload = JSON.parse(record.payload || '{}');
  if (getUserByEmail(finalEmail)) return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
  const user = createUser({ email: finalEmail, ...payload });
  markEmailVerified(user.id);
  deleteAuthVerification(finalEmail, 'signup');
  if (user.referred_by) applyInviteBonusIfNeeded(user.id);
  issueSession(res, user);
  res.json({ user: publicUser(getUserByEmail(finalEmail)) });
});

app.post('/api/auth/login/request-code', async (req, res) => {
  const { email, password } = req.body || {};
  const finalEmail = normalizeEmail(email);
  if (!validEmail(finalEmail) || !password) return res.status(400).json({ error: 'Informe e-mail e senha.' });
  const user = getUserByEmail(finalEmail);
  if (!user || !user.password_hash || !comparePassword(password, user.password_hash)) return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  if (!(user.email_verified_at || user.is_verified)) {
    return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Confirme seu e-mail antes de entrar.' });
  }
  try {
    await issueVerificationCode(finalEmail, 'login', null);
    res.json({ message: 'Código de verificação enviado para seu e-mail.' });
  } catch (error) {
    res.status(503).json({ error: error.message });
  }
});

app.post('/api/auth/login/verify', (req, res) => {
  const finalEmail = normalizeEmail(req.body?.email);
  const record = getAuthVerification(finalEmail, 'login');
  if (!verificationMatches(record, req.body?.code)) {
    if (record) incrementAuthVerificationAttempts(finalEmail, 'login');
    return res.status(401).json({ error: 'Código inválido ou expirado.' });
  }
  const user = getUserByEmail(finalEmail);
  if (!user) return res.status(401).json({ error: 'A conta não existe.' });
  if (!(user.email_verified_at || user.is_verified)) {
    return res.status(403).json({ code: 'EMAIL_NOT_VERIFIED', error: 'Confirme seu e-mail antes de entrar.' });
  }
  deleteAuthVerification(finalEmail, 'login');
  issueSession(res, user);
  return res.json({ user: publicUser(getUserByEmail(finalEmail)) });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('oficina_token');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = getUserById(req.userId);
  res.json({ user: publicUser(user), nextTier: invitesRequiredForNextTier(user) });
});

app.post('/api/billing/checkout', requireAuth, async (req, res) => {
  const { planId } = req.body || {};
  const plan = plans[planId];
  if (!plan || planId === 'gratis') {
    return res.status(400).json({ error: 'Plano pago inválido.' });
  }

  try {
    const user = getUserById(req.userId);
    const isRecurring = plan.type !== 'unico';
    const paymentLink = await asaasRequest('/paymentLinks', {
      method: 'POST',
      body: JSON.stringify({
        name: plan.name,
        description: `Plano ${plan.name} - Chequetto`,
        value: plan.amount,
        billingType: 'UNDEFINED',
        chargeType: isRecurring ? 'RECURRENT' : 'DETACHED',
        ...(isRecurring ? { subscriptionCycle: asaasSubscriptionCycle(plan) } : {}),
        dueDateLimitDays: 3,
        externalReference: `${user.id}:${planId}`,
      }),
    });
    if (!paymentLink.url) throw new Error('O Asaas não retornou o link de pagamento.');
    const subscription = createPendingSubscription({
      userId: req.userId,
      planId,
      amount: plan.amount,
      currency: plan.currency,
      gateway: 'asaas',
      gatewayCheckoutId: paymentLink.id,
    });

    res.status(202).json({
      status: subscription.status,
      subscriptionId: subscription.id,
      checkoutUrl: paymentLink.url,
    });
  } catch (error) {
    console.error('Erro ao criar checkout Asaas:', error.message);
    res.status(502).json({ error: error.message || 'Não foi possível iniciar o pagamento.' });
  }
});

app.post('/api/billing/asaas/webhook', (req, res) => {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (expectedToken && req.headers['asaas-access-token'] !== expectedToken) {
    return res.status(401).json({ error: 'Webhook não autorizado.' });
  }

  const paymentEvents = new Set(['PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED']);
  const payment = req.body?.payment;
  if (paymentEvents.has(req.body?.event) && payment?.externalReference) {
    const [userId] = payment.externalReference.split(':');
    if (userId) setUnlimited(userId, true);
  }

  res.status(202).json({ received: true });
});

// ---------- Geração com etapas em tempo real (Server-Sent Events) ----------

app.get('/generate/stream', requireAuth, async (req, res) => {
  const prompt = req.query.prompt;
  if (!prompt) {
    res.status(400).json({ error: 'Prompt não fornecido' });
    return;
  }

  const user = getUserById(req.userId);
  const freeLimitReached = !!user && !user.unlimited_credits && user.credits <= 0;
  if (freeLimitReached) {
    res.status(402).json({ error: 'Limite de créditos do plano grátis atingido. Convide um amigo para ganhar mais 20 créditos.' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    if (user && !user.unlimited_credits) {
      const updatedUser = require('./db').deductCredit(user.id);
      if (!updatedUser) throw new Error('Não foi possível atualizar os créditos.');
    }

    const { html, plano } = await gerarComGemini(prompt, [], (step) => send(step), req.query.lang);
    const project = saveProject({
      userId: req.userId,
      prompt,
      plano,
      html,
      files: [{ path: 'index.html', content: html, language: 'html' }],
    });
    send({
      stage: 'salvo_temp',
      html,
      plano,
      project: { id: project.id, name: project.name, created_at: project.created_at, updated_at: project.updated_at },
    });
  } catch (error) {
    console.error('Erro na geração:', error);
    send({ stage: 'erro', message: error.message || 'Erro ao processar requisição com IA' });
  } finally {
    res.end();
  }
});

// mantém a rota antiga funcionando também, sem streaming, pra compatibilidade
app.post('/generate', requireAuth, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt não fornecido' });
    }

    const user = getUserById(req.userId);
    if (user && !user.unlimited_credits && user.credits <= 0) {
      return res.status(402).json({ error: 'Limite de créditos do plano grátis atingido. Convide um amigo para ganhar mais 20 créditos.' });
    }

    if (user && !user.unlimited_credits) {
      require('./db').deductCredit(user.id);
    }

    const { html, plano } = await gerarComGemini(prompt, [], () => {});
    const project = saveProject({
      userId: req.userId,
      prompt,
      plano,
      html,
      files: [{ path: 'index.html', content: html, language: 'html' }],
    });
    res.json({
      code: html,
      plano,
      project: { id: project.id, name: project.name, created_at: project.created_at, updated_at: project.updated_at },
    });
  } catch (error) {
    console.error('Erro na geração:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar requisição com IA' });
  }
});

app.post('/refine', requireAuth, async (req, res) => {
  const { html, pedido, projectId, prompt, plano, name } = req.body || {};
  if (!html || !pedido) return res.status(400).json({ error: 'Aplicativo e pedido de alteração são obrigatórios' });
  try {
    const codigo = await refinarComGemini(html, pedido);
    const currentProject = projectId ? getProjectById(projectId) : null;
    const refinedFiles = Array.isArray(currentProject?.files)
      ? currentProject.files.map((file) => ({ ...file }))
      : [];
    const indexFile = refinedFiles.findIndex((file) => /(^|\/)index\.html?$/i.test(file.path));
    if (indexFile >= 0) {
      refinedFiles[indexFile] = { ...refinedFiles[indexFile], content: codigo };
    } else {
      refinedFiles.unshift({ path: 'index.html', content: codigo, language: 'html' });
    }
    const project = saveProject({
      id: projectId || null,
      userId: req.userId,
      prompt: prompt || pedido,
      plano,
      name,
      html: codigo,
      files: refinedFiles,
    });
    res.json({
      code: codigo,
      project: { id: project.id, name: project.name, created_at: project.created_at, updated_at: project.updated_at },
    });
  } catch (error) {
    console.error('Erro no refinamento:', error);
    res.status(projectSaveErrorStatus(error)).json({ error: error.message || 'Erro ao aplicar alteração' });
  }
});

// ---------- Salvar app gerado na plataforma ----------

function handleProjectSave(req, res, forcedId = null) {
  const body = req.body || {};
  const hasFiles = body.files !== undefined || body.arquivos !== undefined;
  const prompt = typeof body.prompt === 'string' ? body.prompt : '';
  const html = typeof body.html === 'string' ? body.html : '';

  if ((!prompt && !hasFiles) || (!html && !hasFiles)) {
    return res.status(400).json({ error: 'Informe prompt e html, ou uma lista de arquivos.' });
  }

  try {
    const project = saveProject({
      id: forcedId || body.id || null,
      userId: req.userId,
      prompt,
      plano: body.plano,
      html,
      files: body.files !== undefined ? body.files : body.arquivos,
      name: body.name || body.nome,
    });

    return res.json({
      project: {
        id: project.id,
        name: project.name,
        // `nome` continua na resposta para clientes antigos.
        nome: project.name,
        created_at: project.created_at,
        updated_at: project.updated_at,
      },
    });
  } catch (error) {
    console.error('Erro ao salvar projeto:', error.message);
    return res.status(projectSaveErrorStatus(error)).json({ error: error.message || 'Não foi possível salvar o projeto.' });
  }
}

app.post('/api/projects/save', requireAuth, (req, res) => handleProjectSave(req, res));

// O POST funciona tanto para criação quanto para atualização. O PUT deixa
// explícito o caso de edição e é útil para clientes que seguem REST.
app.put('/api/projects/:id', requireAuth, (req, res) => handleProjectSave(req, res, req.params.id));

app.patch('/api/projects/:id', requireAuth, (req, res) => {
  try {
    const project = renameProject({
      id: req.params.id,
      userId: req.userId,
      name: req.body?.name,
    });
    res.json({
      project: {
        id: project.id,
        name: project.name,
        nome: project.name,
        created_at: project.created_at,
        updated_at: project.updated_at,
      },
    });
  } catch (error) {
    console.error('Erro ao renomear projeto:', error.message);
    res.status(projectSaveErrorStatus(error)).json({ error: error.message || 'Não foi possível renomear o projeto.' });
  }
});

app.delete('/api/projects/:id', requireAuth, (req, res) => {
  try {
    deleteProject({ id: req.params.id, userId: req.userId });
    res.json({ ok: true, id: req.params.id });
  } catch (error) {
    console.error('Erro ao excluir projeto:', error.message);
    res.status(projectSaveErrorStatus(error)).json({ error: error.message || 'Não foi possível excluir o projeto.' });
  }
});

function safeArchivePath(value, index) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
  return normalized || `arquivo-${index + 1}.txt`;
}

app.get('/api/projects/:id/download', requireAuth, (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project || project.user_id !== req.userId) {
    return res.status(404).json({ error: 'Projeto não encontrado.' });
  }

  const files = Array.isArray(project.files) ? project.files : [];
  const archive = archiver('zip', { zlib: { level: 9 } });
  const fileName = String(project.name || 'projeto')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'projeto';

  res.attachment(`${fileName}.zip`);
  archive.on('error', (error) => {
    console.error('Erro ao criar ZIP do projeto:', error.message);
    if (!res.headersSent) res.status(500).json({ error: 'Não foi possível criar o ZIP.' });
    else res.destroy(error);
  });
  archive.pipe(res);

  if (files.length) {
    files.forEach((file, index) => {
      archive.append(typeof file.content === 'string' ? file.content : '', {
        name: safeArchivePath(file.path || file.name, index),
      });
    });
  } else if (project.html) {
    archive.append(project.html, { name: 'index.html' });
  }

  archive.finalize();
});

app.post('/api/github/import', requireAuth, async (req, res) => {
  try {
    const imported = await importGithubFiles(req.body?.repoUrl, process.env.GITHUB_TOKEN || '');
    res.json({ repository: imported });
  } catch (error) {
    console.error('Erro ao importar GitHub:', error.message);
    const status = error.status === 404 ? 404 : 400;
    res.status(status).json({ error: error.message || 'Não foi possível importar o repositório.' });
  }
});

app.post('/api/github/push', requireAuth, async (req, res) => {
  try {
    const project = getProjectById(req.body?.projectId);
    if (!project || project.user_id !== req.userId) {
      return res.status(404).json({ error: 'Projeto não encontrado.' });
    }
    const token = String(req.body?.token || process.env.GITHUB_TOKEN || '').trim();
    if (!token) {
      return res.status(400).json({
        error: 'Configure um Personal Access Token no modal ou adicione GITHUB_TOKEN aos Secrets do projeto.',
      });
    }
    const result = await pushProjectToGithub({
      project,
      repoUrl: req.body?.repoUrl,
      branch: req.body?.branch,
      message: req.body?.message,
      token,
    });
    res.json({ result });
  } catch (error) {
    console.error('Erro ao enviar para GitHub:', error.message);
    const status = error.status === 401 || error.status === 403 ? error.status : 400;
    res.status(status).json({ error: error.message || 'Não foi possível enviar o projeto para o GitHub.' });
  }
});

app.get('/api/projects', requireAuth, (req, res) => {
  res.json({ projects: listProjectsByUser(req.userId) });
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project || project.user_id !== req.userId) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ project });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`   Chaves carregadas: ${keys.length}`);
  console.log(`Servidor rodando com sucesso!`);
});

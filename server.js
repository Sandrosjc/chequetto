const express = require('express');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const XLSX = require('xlsx');
const dotenv = require('dotenv');
dotenv.config();
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
  getProjectById,
  listProjectsByUser,
  createPendingSubscription,
  setUnlimited,
} = require('./db');
const { signUserToken, requireAuth, hashPassword, comparePassword } = require('./auth');
const plans = require('./plans.json');

const app = express();
const PORT = process.env.PORT || 10000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 50 * 1024 * 1024 },
});

// CRIAR TABELAS AUTOMATICAMENTE
const Database = require('better-sqlite3');
const db = new Database('database.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    referral_code TEXT UNIQUE,
    referred_by INTEGER,
    signup_ip TEXT,
    credits INTEGER DEFAULT 20,
    unlimited_credits INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    prompt TEXT,
    plano TEXT,
    html TEXT,
    nome TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    plan_id TEXT NOT NULL,
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'BRL',
    gateway TEXT NOT NULL,
    gateway_checkout_id TEXT,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);
console.log('✅ Banco de dados pronto!');

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
  if (!process.env.ASAAS_API_KEY) throw new Error('ASAAS_API_KEY não configurada.');
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
    throw new Error(detail || data.message || `Erro HTTP ${response.status}.`);
  }
  return data;
}

function asaasSubscriptionCycle(plan) {
  return { month: 'MONTHLY', quarter: 'QUARTERLY', year: 'ANNUALLY' }[plan.interval];
}

function tryGetUser(req) {
  const token = req.cookies && req.cookies.oficina_token;
  if (!token) return null;
  const { verifyToken } = require('./auth');
  const payload = verifyToken(token);
  if (!payload) return null;
  return getUserById(payload.uid);
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
        message: readable ? undefined : 'Formato sem extração disponível.',
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
    ? 'Arquivo maior que 50 MB.'
    : error.code === 'LIMIT_FILE_COUNT'
      ? 'Máximo 10 arquivos.'
      : error.message || 'Erro ao receber arquivo.';
  res.status(400).json({ error: message });
});

// =============================================
// LOGIN E CADASTRO SIMPLES (SEM EMAIL)
// =============================================

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

function issueSession(res, user) {
  const token = signUserToken(user);
  res.cookie('oficina_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
}

app.post('/api/auth/signup', (req, res) => {
  const { email, password, name } = req.body || {};
  const finalEmail = (email || '').trim().toLowerCase();

  if (!validEmail(finalEmail)) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }

  if (!password || password.length < 6) {
    return res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres.' });
  }

  if (getUserByEmail(finalEmail)) {
    return res.status(409).json({ error: 'Este e-mail já está cadastrado.' });
  }

  const user = createUser({
    email: finalEmail,
    name: name || '',
    password: hashPassword(password),
    signupIp: clientIp(req),
  });

  issueSession(res, user);
  res.json({ user: publicUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const finalEmail = (email || '').trim().toLowerCase();

  if (!validEmail(finalEmail)) {
    return res.status(400).json({ error: 'Informe um e-mail válido.' });
  }

  const user = getUserByEmail(finalEmail);

  if (!user || !user.password_hash || !comparePassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'E-mail ou senha inválidos.' });
  }

  issueSession(res, user);
  res.json({ user: publicUser(user) });
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
    console.error('Erro ao criar checkout:', error.message);
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

app.get('/generate/stream', requireAuth, async (req, res) => {
  const prompt = req.query.prompt;
  if (!prompt) {
    res.status(400).json({ error: 'Prompt não fornecido' });
    return;
  }

  const user = getUserById(req.userId);
  const freeLimitReached = !!user && !user.unlimited_credits && user.credits <= 0;
  if (freeLimitReached) {
    res.status(402).json({ error: 'Limite de créditos do plano grátis atingido.' });
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
    send({ stage: 'salvo_temp', html, plano });
  } catch (error) {
    console.error('Erro na geração:', error);
    send({ stage: 'erro', message: error.message || 'Erro ao processar requisição com IA' });
  } finally {
    res.end();
  }
});

app.post('/generate', requireAuth, async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt não fornecido' });
    }

    const user = getUserById(req.userId);
    if (user && !user.unlimited_credits && user.credits <= 0) {
      return res.status(402).json({ error: 'Limite de créditos do plano grátis atingido.' });
    }

    if (user && !user.unlimited_credits) {
      require('./db').deductCredit(user.id);
    }

    const { html, plano } = await gerarComGemini(prompt, [], () => {});
    res.json({ code: html, plano });
  } catch (error) {
    console.error('Erro na geração:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar requisição com IA' });
  }
});

app.post('/refine', requireAuth, async (req, res) => {
  const { html, pedido } = req.body || {};
  if (!html || !pedido) return res.status(400).json({ error: 'Aplicativo e pedido são obrigatórios' });
  try {
    const codigo = await refinarComGemini(html, pedido);
    res.json({ code: codigo });
  } catch (error) {
    console.error('Erro no refinamento:', error);
    res.status(500).json({ error: error.message || 'Erro ao aplicar alteração' });
  }
});

app.post('/api/projects/save', requireAuth, (req, res) => {
  const { prompt, plano, html, nome } = req.body || {};
  if (!html || !prompt) return res.status(400).json({ error: 'Dados incompletos' });

  const project = saveProject({ userId: req.userId, prompt, plano, html, nome });
  res.json({ project: { id: project.id, nome: project.nome, created_at: project.created_at } });
});

app.get('/api/projects', requireAuth, (req, res) => {
  res.json({ projects: listProjectsByUser(req.userId) });
});

app.get('/api/projects/:id', requireAuth, (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project || project.user_id !== req.userId) return res.status(404).json({ error: 'Não encontrado' });
  project.plano = JSON.parse(project.plano || '[]');
  res.json({ project });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`   Chaves carregadas: ${keys.length}`);
  console.log(`Servidor rodando com sucesso!`);
});

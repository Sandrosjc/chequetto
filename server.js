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
} = require('./db');
const { signUserToken, requireAuth, hashPassword, comparePassword } = require('./auth');

const app = express();
const PORT = process.env.PORT || 10000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 10, fileSize: 15 * 1024 * 1024 },
});

const keys = getApiKeys();

app.use(express.json({ limit: '10mb' }));
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
    ? 'O arquivo é maior que o limite de 15 MB.'
    : error.code === 'LIMIT_FILE_COUNT'
      ? 'Você pode enviar no máximo 10 arquivos por vez.'
      : error.message || 'Não foi possível receber o arquivo.';
  res.status(400).json({ error: message });
});

// ---------- Auth ----------

app.post('/api/auth/signup', (req, res) => {
  const { email, password, name, referralCode } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'Email já cadastrado' });

  const ip = clientIp(req);
  const user = createUser({
    email,
    passwordHash: hashPassword(password),
    name,
    referredByCode: referralCode,
    signupIp: ip,
  });

  if (user.referred_by) applyInviteBonusIfNeeded(user.id);

  const token = signUserToken(user);
  res.cookie('oficina_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });

  res.json({
    user: publicUser(user),
    ipSignupWarning: countSignupsByIp(ip) >= 3 ? 'Várias contas criadas a partir deste IP' : null,
  });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = getUserByEmail(email);
  if (!user || !user.password_hash || !comparePassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Email ou senha inválidos' });
  }
  const token = signUserToken(user);
  res.cookie('oficina_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 3600 * 1000 });
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

// ---------- Geração com etapas em tempo real (Server-Sent Events) ----------

app.get('/generate/stream', async (req, res) => {
  const prompt = req.query.prompt;
  if (!prompt) {
    res.status(400).json({ error: 'Prompt não fornecido' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);

  try {
    const { html, plano } = await gerarComGemini(prompt, [], (step) => send(step));
    send({ stage: 'salvo_temp', html, plano });
  } catch (error) {
    console.error('Erro na geração:', error);
    send({ stage: 'erro', message: error.message || 'Erro ao processar requisição com IA' });
  } finally {
    res.end();
  }
});

// mantém a rota antiga funcionando também, sem streaming, pra compatibilidade
app.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body;
    if (!prompt) {
      return res.status(400).json({ error: 'Prompt não fornecido' });
    }
    const { html, plano } = await gerarComGemini(prompt, [], () => {});
    res.json({ code: html, plano });
  } catch (error) {
    console.error('Erro na geração:', error);
    res.status(500).json({ error: error.message || 'Erro ao processar requisição com IA' });
  }
});

app.post('/refine', async (req, res) => {
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

app.post('/api/projects/save', (req, res) => {
  const { prompt, plano, html, nome } = req.body || {};
  if (!html || !prompt) return res.status(400).json({ error: 'Dados incompletos para salvar' });

  const user = tryGetUser(req);
  const project = saveProject({ userId: user ? user.id : null, prompt, plano, html, nome });
  res.json({ project: { id: project.id, nome: project.nome, created_at: project.created_at } });
});

app.get('/api/projects', requireAuth, (req, res) => {
  res.json({ projects: listProjectsByUser(req.userId) });
});

app.get('/api/projects/:id', (req, res) => {
  const project = getProjectById(req.params.id);
  if (!project) return res.status(404).json({ error: 'Não encontrado' });
  res.json({ project });
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  console.log(`   Chaves carregadas: ${keys.length}`);
  console.log(`Servidor rodando com sucesso!`);
});

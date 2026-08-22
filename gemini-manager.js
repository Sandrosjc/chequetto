const { GoogleGenerativeAI } = require('@google/generative-ai');

function getApiKeys() {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) keys.push(key);
  }
  return keys;
}

function extrairHtml(texto) {
  const match = texto.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (match) {
    return match[1].trim();
  }
  const doctypeIndex = texto.search(/<!DOCTYPE html>/i);
  const htmlIndex = texto.search(/<html/i);
  const start = doctypeIndex !== -1 ? doctypeIndex : htmlIndex;
  if (start !== -1) {
    return texto.slice(start).trim();
  }
  return texto.trim();
}

function extrairLista(texto) {
  // pega linhas que parecem itens de lista (-, *, ou numeradas) e limpa
  const linhas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^[-*\d.]/.test(l))
    .map((l) => l.replace(/^[-*\d.\s]+/, '').trim())
    .filter(Boolean);
  return linhas.length > 0 ? linhas.slice(0, 5) : [texto.trim().slice(0, 140)];
}

const INSTRUCAO_PLANO = `Você é o planejador do Oficina, um gerador de mini-aplicativos web.
Dado o pedido do usuário, responda com uma lista curta (3 a 5 itens) em português, cada item em uma linha
começando com "-", descrevendo os passos que você vai seguir para construir o app (ex: "Criar a estrutura da lista de tarefas",
"Adicionar campo de prioridade e prazo", "Estilizar com visual escuro e dourado"). Seja direto, sem explicações extras,
sem introdução, apenas a lista.`;

const INSTRUCAO_CODIGO = `Você é um gerador de mini-aplicativos web.
Responda APENAS com o código HTML completo (incluindo <style> e <script> internos, tudo em um único arquivo).
NÃO escreva nenhuma explicação, introdução, comentário ou lista de funcionalidades antes ou depois do código.
NÃO use blocos de markdown com \`\`\`.
Sua resposta deve começar diretamente com <!DOCTYPE html> e terminar com </html>.`;

async function chamarGemini(key, promptFinal) {
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });
  const result = await model.generateContent(promptFinal);
  const response = await result.response;
  return response.text();
}

// Gera o plano (etapa 1) e o código (etapa 2), narrando cada etapa via onStep(texto)
async function gerarComGemini(prompt, history = [], onStep = () => {}) {
  const keys = getApiKeys();
  if (keys.length === 0) {
    throw new Error('Nenhuma chave de API configurada.');
  }

  let ultimoErro = null;
  let plano = [];

  // ETAPA 1: planejar
  onStep({ stage: 'planejando', message: 'Analisando o que você pediu...' });
  for (const key of keys) {
    try {
      const textoPlano = await chamarGemini(key, `${INSTRUCAO_PLANO}\n\nPedido do usuário: ${prompt}`);
      plano = extrairLista(textoPlano);
      break;
    } catch (err) {
      ultimoErro = err;
      console.warn('Erro no planejamento com uma das chaves, tentando a próxima...', err.message);
    }
  }
  if (plano.length === 0) {
    plano = ['Montando seu aplicativo...'];
  }
  onStep({ stage: 'planejando', message: 'Plano pronto', plano });

  // ETAPA 2: gerar o código de verdade
  onStep({ stage: 'criando', message: 'Escrevendo o código do aplicativo...' });
  for (const key of keys) {
    try {
      const promptFinal = `${INSTRUCAO_CODIGO}\n\nPedido do usuário: ${prompt}\n\nPlano a seguir:\n${plano.join('\n')}`;
      const textoBruto = await chamarGemini(key, promptFinal);
      const html = extrairHtml(textoBruto);
      onStep({ stage: 'concluido', message: 'Aplicativo pronto!' });
      return { html, plano };
    } catch (err) {
      console.warn('Erro na geração com uma das chaves, tentando a próxima...', err.message);
      ultimoErro = err;
    }
  }

  onStep({ stage: 'erro', message: 'Não foi possível gerar o aplicativo.' });
  throw new Error(
    'Todas as chaves de API falharam ao processar a requisição. Último erro: ' +
    (ultimoErro ? ultimoErro.message : 'desconhecido')
  );
}

async function refinarComGemini(htmlAtual, pedido, onStep = () => {}) {
  const keys = getApiKeys();
  if (keys.length === 0) throw new Error('Nenhuma chave de API configurada.');

  const instrucao = `${INSTRUCAO_CODIGO}

Você está refinando um aplicativo existente. Preserve tudo que já funciona e aplique somente as mudanças pedidas.
Garanta que o resultado continue sendo um documento HTML completo e autocontido.

Pedido de refinamento: ${pedido}

Código atual:
${htmlAtual}`;

  onStep({ stage: 'refinando', message: 'Aplicando as alterações no aplicativo...' });
  let ultimoErro = null;
  for (const key of keys) {
    try {
      const html = extrairHtml(await chamarGemini(key, instrucao));
      onStep({ stage: 'concluido', message: 'Alteração aplicada!' });
      return html;
    } catch (err) {
      ultimoErro = err;
      console.warn('Erro no refinamento com uma das chaves, tentando a próxima...', err.message);
    }
  }
  throw new Error('Não foi possível aplicar o refinamento. Último erro: ' + (ultimoErro?.message || 'desconhecido'));
}

module.exports = { gerarComGemini, refinarComGemini };

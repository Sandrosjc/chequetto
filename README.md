# Oficina — Criador de Aplicativos com IA

Gera um mini-aplicativo web completo (HTML + CSS + JS num único arquivo) a
partir de uma descrição em português, usando a API do Gemini com rotação
automática entre várias chaves (se uma esgotar a cota, ele troca sozinho
para a próxima).

## O que foi corrigido/adicionado em relação à versão original

- **Chave de API não fica mais no código** — antes o arquivo tinha as
  chaves escritas direto nele, o que é perigoso ao subir para o GitHub
  (qualquer pessoa vê e usa sua chave). Agora elas ficam em `.env`, que o
  Git ignora.
- **Modelo atualizado** — o script original usava `gemini-1.5-flash`, que a
  Google já desativou (a chamada retornava erro). Agora usa
  `gemini-2.5-flash` por padrão, configurável em `.env` para o dia em que a
  Google trocar de novo.
- **Extração de código mais confiável** — antes só removia ```` ```html ````
  com um replace simples, o que quebrava se a IA respondesse com texto
  junto. Agora tenta várias estratégias antes de desistir.
- **Retry e timeout de verdade** — trata erro 429 (cota), 403 (permissão),
  5xx (instabilidade do Google) e timeout de rede, girando entre as chaves.
- **Modo de ajuste (refinar)** — depois de gerar o app, dá pra pedir um
  ajuste específico ("deixar o botão maior", "mudar pra tema claro") sem
  reescrever o pedido do zero; a IA recebe o código atual e só modifica o
  necessário.
- **Prévia responsiva** — botões para ver o app como desktop, tablet ou
  celular dentro da própria página.
- **Baixar e copiar o código** — exporta o `.html` gerado para usar fora
  dali.
- **Histórico da sessão** — clique em qualquer geração anterior para
  voltar a ela.
- **Persistência de projetos (Parte 1)** — cada projeto pertence ao usuário,
  usa `name`, `files` (JSONB compatível com SQLite), `created_at` e
  `updated_at`; gerações da IA, refinamentos e edição direta do código são
  salvos automaticamente e podem ser carregados pela API.
- **Dashboard de projetos (Parte 2)** — visualize os projetos em cards,
  abra, renomeie ou exclua cada projeto e crie um novo projeto sem perder o
  fluxo do editor.
- **Editor e GitHub (Parte 3)** — edição direta com salvamento automático,
  ditado por voz, importação de repositórios públicos e envio de arquivos
  para um repositório GitHub por commit. Também permite abrir uma pasta local,
  preservar os caminhos dos arquivos e baixar o projeto inteiro em ZIP.
- **Painel de extensões** — catálogo local no estilo VS Code para instalar,
  ativar e desativar extensões do workspace. Manifestos JSON próprios podem
  ser adicionados sem executar código arbitrário no navegador.
- **Dashboard premium** — visão de workspace com boas-vindas personalizadas,
  resumo de projetos e arquivos, busca, ordenação, cards refinados e estados
  vazios pensados para orientar o próximo passo.
- **Autenticação por e-mail** — cadastro com senha, link de confirmação,
  login protegido, sessão por cookie e armazenamento seguro da senha com
  bcrypt. O envio pode usar SMTP ou Resend; em desenvolvimento sem provedor,
  o link é exibido somente no console do servidor.
- **Acesso protegido no editor** — ao tentar digitar, colar, anexar arquivo,
  usar o microfone, gerar ou refinar sem estar conectado, o modal de
  login/cadastro abre automaticamente. Depois da autenticação, o foco volta
  para o campo que a pessoa estava usando.
- **`package.json`, `.gitignore` e este README** — não existiam antes.

## Passo a passo para rodar hoje

### 1. Pré-requisito
Instale o [Node.js](https://nodejs.org) versão 18 ou mais recente.

### 2. Baixe suas chaves do Gemini
Crie (ou pegue) suas chaves em https://aistudio.google.com/apikey — pode
usar mais de uma chave para ter mais cota disponível.

### 3. Instale e configure
```bash
cd app-builder
npm install
cp .env.example .env
```
Abra o arquivo `.env` e cole suas chaves reais em `GEMINI_API_KEYS`,
separadas por vírgula, sem espaço:
```
GEMINI_API_KEYS=AIzaSy...chave1,AIzaSy...chave2
```

Também é possível usar `GEMINI_API_KEY_1` até `GEMINI_API_KEY_10`. O sistema
remove chaves repetidas e tenta a próxima automaticamente quando uma falha.

PDFs com texto, DOCX, planilhas e arquivos de código são lidos antes da
geração. PDF escaneado, imagem, áudio e vídeo ainda precisam de OCR,
transcrição ou análise multimodal para serem interpretados.

### 4. Rode
```bash
npm start
```
Abra **http://localhost:10000** no navegador (ou a porta definida em
`PORT`).

### 5. Confirmação de e-mail

Para produção, configure um dos dois caminhos:

- SMTP: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASSWORD` e `AUTH_FROM_EMAIL`;
- Resend: `RESEND_API_KEY` e `AUTH_FROM_EMAIL`.

O cadastro só libera o login depois que a pessoa abre o link enviado por
e-mail. Não coloque senhas, tokens ou chaves diretamente no código ou no
GitHub.

## Como subir para o GitHub sem vazar suas chaves

O `.gitignore` já está configurado para excluir `.env` e `node_modules`.
Isso significa que, ao subir, **só o `.env.example` (com placeholders) vai
junto — nunca suas chaves reais.**

```bash
cd app-builder
git init
git add .
git commit -m "Primeira versão da Oficina"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/SEU-REPOSITORIO.git
git push -u origin main
```

Depois, em qualquer outro computador (ou para outra pessoa rodar seu
projeto), o processo é: clonar, `npm install`, criar o próprio `.env` com
as próprias chaves, `npm start`.

## API de projetos

- `POST /api/projects/save` cria um projeto ou atualiza o projeto enviado em
  `id`. O corpo aceita `prompt`, `plano`, `html`, `name` e `files`.
- `PUT /api/projects/:id` atualiza explicitamente um projeto do usuário.
- `GET /api/projects` lista os projetos do usuário autenticado.
- `GET /api/projects/:id` carrega um projeto específico, incluindo `files`
  como lista JSON e `updated_at`.
- `PATCH /api/projects/:id` renomeia um projeto.
- `DELETE /api/projects/:id` exclui um projeto pertencente ao usuário.
- `POST /api/auth/register` cria uma conta e envia o link de confirmação.
- `GET /api/auth/verify?token=...` confirma o endereço de e-mail.
- `POST /api/auth/login` entra com e-mail e senha após a confirmação.
- `GET /api/auth/me` é um alias autenticado para consultar a sessão atual.
- `POST /api/github/import` importa os arquivos de texto de um repositório
  público do GitHub para o editor.
- `POST /api/github/push` cria um commit com os arquivos atuais e atualiza a
  branch de destino. O token pode ser informado apenas durante a operação ou
  configurado como Secret `GITHUB_TOKEN`; ele nunca é salvo no banco.
- `GET /api/projects/:id/download` baixa os arquivos do projeto em ZIP.

Como a versão atual usa SQLite, `files` é armazenado como JSON serializado
na coluna declarada `JSONB`, com validação e normalização na camada de banco.
Em uma futura migração para PostgreSQL, a mesma estrutura pode ser movida
para JSONB nativo sem mudar o contrato da API.

## Limitações importantes (leia antes de anunciar como "o melhor do mundo")

Vale ser honesto sobre o que essa ferramenta é e não é:

- Ela gera **um app estático de página única** (HTML/CSS/JS), ótimo para
  protótipos, ferramentas simples, calculadoras, jogos leves, formulários,
  landing pages interativas. Ela **não** gera apps com backend, banco de
  dados persistente entre sessões, autenticação real ou múltiplas telas
  roteadas — isso exigiria uma arquitetura bem maior.
- A qualidade da "primeira rodada" depende diretamente de quão detalhado é
  o seu pedido. Pedidos vagos geram apps genéricos; pedidos específicos
  (funcionalidades, tom visual, exemplos de conteúdo) geram muito melhor.
  Por isso o campo de ajuste existe — é raro acertar 100% na primeira vez
  mesmo com boas ferramentas comerciais.
- O modelo padrão (`gemini-2.5-flash`) tem um limite de tokens de saída, então
  pedidos muito complexos podem gerar um app truncado. Se isso acontecer,
  peça o ajuste "continue de onde parou" ou simplifique o pedido.
- Ferramentas como Lovable/v0/Bolt têm equipes inteiras, infraestrutura de
  deploy automático e meses de ajuste fino de prompt — não é realista (nem
  necessário) prometer que este script de ~600 linhas as supera. O que dá
  para prometer com honestidade: é seu, roda local, você entende cada linha,
  e pode evoluir do seu jeito.

## Próximos passos possíveis (se quiser evoluir)

- Trocar o Blob local por deploy automático (ex: publicar o HTML gerado
  como GitHub Pages a cada geração).
- Adicionar geração de imagens (Nano Banana / Gemini Image) para apps que
  precisem de ilustrações.
- Salvar o histórico em disco (arquivo `.json`) em vez de só na memória do
  navegador, para persistir entre sessões.

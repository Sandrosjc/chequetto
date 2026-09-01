document.addEventListener('DOMContentLoaded', () => {
  const WORKSPACE_STORAGE_KEY = 'chequetto_workspace_state_v1';
  const SAVED_PROJECTS_STORAGE_KEY = 'chequetto_saved_projects_v1';
  const el = {
    prompt: document.getElementById('prompt'),
    btnGerar: document.getElementById('btnGerar'),
    btnGerarLabel: document.getElementById('btnGerarLabel'),
    spinner: document.getElementById('spinner'),
    status: document.getElementById('status'),
    historyList: document.getElementById('historyList'),
    apiStatus: document.getElementById('apiStatus'),
    editorProjectName: document.getElementById('editorProjectName'),
    githubRepoUrl: document.getElementById('githubRepoUrl'),
    btnImportGithub: document.getElementById('btnImportGithub'),
    githubImportStatus: document.getElementById('githubImportStatus'),
    folderAttach: document.getElementById('folderAttach'),
    folderImportStatus: document.getElementById('folderImportStatus'),
    btnGithubPush: document.getElementById('btnGithubPush'),
    btnDownloadProject: document.getElementById('btnDownloadProject'),
    btnExtensions: document.getElementById('btnExtensions'),
    extensionsOverlay: document.getElementById('extensionsOverlay'),
    closeExtensions: document.getElementById('closeExtensions'),
    extensionsGrid: document.getElementById('extensionsGrid'),
    extensionUpload: document.getElementById('extensionUpload'),
    extensionsStatus: document.getElementById('extensionsStatus'),
    btnBackDashboard: document.getElementById('btnBackDashboard'),
    githubPushOverlay: document.getElementById('githubPushOverlay'),
    closeGithubModal: document.getElementById('closeGithubModal'),
    githubPushForm: document.getElementById('githubPushForm'),
    githubPushRepoUrl: document.getElementById('githubPushRepoUrl'),
    githubPushBranch: document.getElementById('githubPushBranch'),
    githubPushMessage: document.getElementById('githubPushMessage'),
    githubPushToken: document.getElementById('githubPushToken'),
    githubPushStatus: document.getElementById('githubPushStatus'),
    btnConfirmGithubPush: document.getElementById('btnConfirmGithubPush'),
    previewFrame: document.getElementById('previewFrame'),
    codeViewText: document.getElementById('codeViewText'),
    codeView: document.getElementById('codeView'),
    emptyState: document.getElementById('emptyState'),
    btnCopiar: document.getElementById('btnCopiar'),
    btnBaixar: document.getElementById('btnBaixar'),
    btnSalvar: document.getElementById('btnSalvar'),
    refineInput: document.getElementById('refineInput'),
    btnRefinar: document.getElementById('btnRefinar'),
    btnMeusProjetos: document.getElementById('btnMeusProjetos'),
    btnCriarApp: document.getElementById('btnCriarApp'),
    dashboardView: document.getElementById('dashboardView'),
    dashboardGreeting: document.getElementById('dashboardGreeting'),
    dashboardStart: document.getElementById('btnDashboardStart'),
    editorView: document.getElementById('editorView'),
    projectsGrid: document.getElementById('projectsGrid'),
    dashboardEmpty: document.getElementById('dashboardEmpty'),
    dashboardNoResults: document.getElementById('dashboardNoResults'),
    dashboardCount: document.getElementById('dashboardCount'),
    dashboardSearch: document.getElementById('dashboardSearch'),
    dashboardSort: document.getElementById('dashboardSort'),
    dashboardStatTotal: document.getElementById('dashboardStatTotal'),
    dashboardStatTotalHint: document.getElementById('dashboardStatTotalHint'),
    dashboardStatUpdated: document.getElementById('dashboardStatUpdated'),
    dashboardStatFiles: document.getElementById('dashboardStatFiles'),
    dashboardStatus: document.getElementById('dashboardStatus'),
    btnNovoProjeto: document.getElementById('btnNovoProjeto'),
    btnNovoProjetoVazio: document.getElementById('btnNovoProjetoVazio'),
    examples: document.getElementById('examples'),
    tabs: document.querySelectorAll('.tab'),
    devices: document.querySelectorAll('.device'),
    frameWrap: document.getElementById('frameWrap'),
    stageBar: document.getElementById('stageBar'),
    stagePlanejar: document.getElementById('stagePlanejar'),
    stageCriar: document.getElementById('stageCriar'),
    planoList: document.getElementById('planoList'),
    btnMic: document.getElementById('btnMic'),
    micHint: document.getElementById('micHint'),
    fileAttach: document.getElementById('fileAttach'),
    attachedFiles: document.getElementById('attachedFiles'),
  };

  let state = {
    codigoAtual: '',
    promptAtual: '',
    promptDraft: '',
    planoAtual: [],
    historico: [],
    attachedFiles: [],
    projectId: null,
    projectName: '',
    files: [],
  };
  let activeUserId = null;
  let projectSaveQueue = Promise.resolve();
  let projectSaveTimer = null;
  let pendingEditorFocus = null;

  function storageKey(baseKey) {
    return `${baseKey}:${activeUserId}`;
  }

  function clearWorkspace() {
    state = {
      codigoAtual: '',
      promptAtual: '',
      promptDraft: '',
      planoAtual: [],
      historico: [],
      attachedFiles: [],
      projectId: null,
      projectName: '',
      files: [],
    };
    if (el.prompt) el.prompt.value = '';
    if (el.editorProjectName) el.editorProjectName.textContent = 'Novo projeto';
    if (el.codeViewText) el.codeViewText.textContent = '';
    if (el.previewFrame) {
      el.previewFrame.hidden = true;
      el.previewFrame.src = 'about:blank';
    }
    if (el.emptyState) el.emptyState.hidden = false;
    if (el.planoList) {
      el.planoList.innerHTML = '';
      el.planoList.hidden = true;
    }
    if (el.historyList) el.historyList.innerHTML = '';
    if (el.btnCopiar) el.btnCopiar.disabled = true;
    if (el.btnBaixar) el.btnBaixar.disabled = true;
    if (el.btnDownloadProject) el.btnDownloadProject.disabled = true;
    if (el.btnSalvar) el.btnSalvar.disabled = true;
    renderAttachedFiles();
  }

  function persistWorkspace() {
    try {
      if (!activeUserId) return;
      localStorage.setItem(storageKey(WORKSPACE_STORAGE_KEY), JSON.stringify({
        codigoAtual: state.codigoAtual,
        promptAtual: state.promptAtual,
        promptDraft: el.prompt?.value || state.promptDraft,
        planoAtual: state.planoAtual,
        historico: state.historico.slice(-30),
        projectId: state.projectId,
        projectName: state.projectName,
        files: state.files,
      }));
    } catch (error) {
      console.warn('Não foi possível salvar o workspace localmente.', error);
    }
  }

  function normalizeProjectFiles(files, fallbackHtml = '') {
    let parsed = files;
    if (typeof parsed === 'string') {
      try {
        parsed = JSON.parse(parsed);
      } catch {
        parsed = [];
      }
    }
    if (!Array.isArray(parsed) && parsed && typeof parsed === 'object') {
      parsed = Object.entries(parsed).map(([path, content]) => ({ path, content }));
    }
    if (!Array.isArray(parsed)) parsed = [];

    const normalized = parsed
      .filter((file) => file && typeof file === 'object' && !Array.isArray(file))
      .map((file) => {
        const filePath = typeof file.path === 'string' && file.path.trim()
          ? file.path.trim()
          : (typeof file.name === 'string' ? file.name.trim() : '');
        return {
          ...file,
          path: filePath,
          content: typeof file.content === 'string' ? file.content : '',
        };
      })
      .filter((file) => file.path && typeof file.content === 'string');

    if (!normalized.length && fallbackHtml) {
      normalized.push({ path: 'index.html', content: fallbackHtml, language: 'html' });
    }
    return normalized;
  }

  function syncCurrentFile(html) {
    const files = normalizeProjectFiles(state.files, html);
    const index = files.findIndex((file) => /(^|\/)index\.html?$/i.test(file.path));
    if (index >= 0) {
      files[index] = { ...files[index], content: html };
    } else if (!files.length || /<!doctype|<html[\s>]/i.test(html)) {
      files.unshift({ path: 'index.html', content: html, language: 'html' });
    }
    state.files = files;
  }

  function renderEditorProjectName() {
    if (el.editorProjectName) {
      el.editorProjectName.textContent = state.projectName || 'Novo projeto';
    }
  }

  function updatePreview(html) {
    if (!el.previewFrame) return;
    if (el.previewFrame.src && el.previewFrame.src.startsWith('blob:')) {
      URL.revokeObjectURL(el.previewFrame.src);
    }
    el.previewFrame.src = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  }

  function persistSavedProject(project) {
    try {
      if (!activeUserId) return;
      const saved = JSON.parse(localStorage.getItem(storageKey(SAVED_PROJECTS_STORAGE_KEY)) || '[]');
      const next = saved.filter((item) => item.id !== project.id);
      next.unshift(project);
      localStorage.setItem(storageKey(SAVED_PROJECTS_STORAGE_KEY), JSON.stringify(next.slice(0, 30)));
    } catch (error) {
      console.warn('Não foi possível guardar o projeto localmente.', error);
    }
  }

  function restoreWorkspace() {
    try {
      if (!activeUserId) return;
      const saved = JSON.parse(localStorage.getItem(storageKey(WORKSPACE_STORAGE_KEY)) || 'null');
      if (!saved) return;
      state = {
        ...state,
        ...saved,
        historico: Array.isArray(saved.historico) ? saved.historico : [],
        planoAtual: Array.isArray(saved.planoAtual) ? saved.planoAtual : [],
        projectId: typeof saved.projectId === 'string' ? saved.projectId : null,
        projectName: typeof saved.projectName === 'string' ? saved.projectName : '',
        files: normalizeProjectFiles(saved.files, saved.codigoAtual || ''),
      };
      renderEditorProjectName();
      if (el.prompt) el.prompt.value = state.promptDraft || '';
      if (state.codigoAtual) showGeneratedCode(state.codigoAtual, state.promptAtual);
      renderPlano(state.planoAtual);
      renderHistory();
    } catch (error) {
      console.warn('Não foi possível restaurar o workspace local.', error);
    }
  }

  function renderAttachedFiles() {
    if (!el.attachedFiles) return;
    el.attachedFiles.innerHTML = '';
    state.attachedFiles.forEach((file, index) => {
      const item = document.createElement('span');
      item.className = 'attached-file';
      const icon = document.createElement('span');
      icon.textContent = '📎';
      icon.setAttribute('aria-hidden', 'true');
      const name = document.createElement('span');
      name.textContent = file.name;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.title = 'Remover anexo';
      remove.setAttribute('aria-label', `Remover ${file.name}`);
      remove.textContent = '×';
      item.append(icon, name, remove);
      remove.addEventListener('click', () => {
        state.attachedFiles.splice(index, 1);
        renderAttachedFiles();
      });
      el.attachedFiles.appendChild(item);
    });
    el.attachedFiles.hidden = state.attachedFiles.length === 0;
  }

  function addAttachedFiles(files) {
    const newFiles = Array.from(files || []).filter((file) => {
      const alreadyAttached = state.attachedFiles.some((attached) =>
        attached.name === file.name && attached.size === file.size && attached.lastModified === file.lastModified
      );
      return !alreadyAttached;
    });
    if (!newFiles.length) return;
    state.attachedFiles.push(...newFiles);
    renderAttachedFiles();
  }

  function showGeneratedCode(html, promptText = state.promptAtual) {
    state.codigoAtual = html;
    syncCurrentFile(html);
    if (el.previewFrame) {
      el.previewFrame.hidden = false;
      updatePreview(html);
    }
    if (el.codeViewText) el.codeViewText.textContent = html;
    if (el.emptyState) el.emptyState.hidden = true;
    if (el.btnCopiar) el.btnCopiar.disabled = false;
    if (el.btnBaixar) el.btnBaixar.disabled = false;
    if (el.btnDownloadProject) el.btnDownloadProject.disabled = false;
    if (el.btnSalvar) el.btnSalvar.disabled = false;
    if (el.btnRefinar) el.btnRefinar.disabled = false;
    state.promptAtual = promptText;
    persistWorkspace();
  }

  // O código também pode ser ajustado diretamente na aba Código. A mesma
  // rotina usada para alterações da IA é acionada e o arquivo index.html
  // permanece sincronizado com o conteúdo exibido.
  el.codeViewText?.addEventListener('input', () => {
    const html = el.codeViewText.textContent || '';
    state.codigoAtual = html;
    syncCurrentFile(html);
    updatePreview(html);
    persistWorkspace();
    scheduleProjectSave();
  });

  function currentProjectSnapshot() {
    syncCurrentFile(state.codigoAtual);
    return {
      id: state.projectId || undefined,
      name: state.projectName || state.promptAtual.slice(0, 60),
      prompt: el.prompt?.value.trim() || state.promptAtual,
      plano: Array.isArray(state.planoAtual) ? [...state.planoAtual] : [],
      html: state.codigoAtual,
      files: normalizeProjectFiles(state.files, state.codigoAtual),
    };
  }

  // Todas as gravações passam por uma fila: se o usuário fizer outra
  // alteração enquanto uma requisição estiver em andamento, ela será
  // persistida depois, sem sobrescrever a versão mais nova de forma parcial.
  function queueProjectSave({ silent = true } = {}) {
    if (!activeUserId || !state.codigoAtual) return Promise.resolve(null);
    const snapshot = currentProjectSnapshot();
    const request = projectSaveQueue
      .catch(() => null)
      .then(async () => {
        // Uma segunda alteração pode ter sido enfileirada antes da criação
        // inicial terminar. Nesse caso, atualiza o mesmo projeto recém-criado.
        const payload = { ...snapshot, id: snapshot.id || state.projectId || undefined };
        const res = await fetch('/api/projects/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify(payload),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Falha ao salvar o projeto');

        const savedProject = data.project || {};
        if (savedProject.id) state.projectId = savedProject.id;
        if (savedProject.name) state.projectName = savedProject.name;
        renderEditorProjectName();
        persistSavedProject({
          id: savedProject.id || state.projectId,
          prompt: payload.prompt,
          nome: savedProject.name || payload.name,
          name: savedProject.name || payload.name,
          html: payload.html,
          files: payload.files,
          plano: payload.plano,
          created_at: savedProject.created_at,
          updated_at: savedProject.updated_at,
        });
        persistWorkspace();
        return savedProject;
      });

    projectSaveQueue = request.catch((error) => {
      if (!silent && el.status) el.status.textContent = 'Erro ao salvar: ' + error.message;
      throw error;
    });
    return request;
  }

  function scheduleProjectSave() {
    if (!activeUserId || !state.codigoAtual) return;
    clearTimeout(projectSaveTimer);
    projectSaveTimer = setTimeout(() => {
      queueProjectSave({ silent: true }).catch(() => {});
    }, 700);
  }

  let dashboardProjects = [];

  function setWorkspaceView(view) {
    const dashboardVisible = view === 'dashboard';
    if (el.dashboardView) el.dashboardView.hidden = !dashboardVisible;
    if (el.editorView) el.editorView.hidden = dashboardVisible;
    el.btnMeusProjetos?.classList.toggle('is-active', dashboardVisible);
    el.btnCriarApp?.classList.toggle('is-active', !dashboardVisible);
  }

  function formatProjectDate(value) {
    if (!value) return 'Sem atualização registrada';
    const raw = String(value);
    const normalized = raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(date).replace('.', '');
  }

  function projectHtml(project) {
    if (typeof project.html === 'string' && project.html) return project.html;
    const files = normalizeProjectFiles(project.files);
    return files.find((file) => /(^|\/)index\.html?$/i.test(file.path))?.content
      || files.find((file) => /\.html?$/i.test(file.path))?.content
      || '';
  }

  function historyItemFromProject(project) {
    const html = projectHtml(project);
    return {
      id: project.id,
      prompt: project.name || project.nome || project.prompt || 'Projeto sem nome',
      code: html,
      name: project.name || project.nome || '',
      files: normalizeProjectFiles(project.files, html),
      plano: Array.isArray(project.plano) ? project.plano : [],
    };
  }

  function projectTimestamp(value) {
    const raw = String(value || '');
    if (!raw) return NaN;
    return Date.parse(raw.includes('T') ? raw : `${raw.replace(' ', 'T')}Z`);
  }

  function renderDashboard(projects = dashboardProjects) {
    dashboardProjects = Array.isArray(projects) ? projects : [];
    const query = (el.dashboardSearch?.value || '').trim().toLowerCase();
    const sort = el.dashboardSort?.value || 'updated';
    const filteredProjects = dashboardProjects
      .filter((project) => {
        if (!query) return true;
        return [project.name, project.nome, project.prompt]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(query));
      })
      .sort((a, b) => {
        if (sort === 'name') {
          return String(a.name || a.nome || '').localeCompare(String(b.name || b.nome || ''), 'pt-BR');
        }
        const aDate = projectTimestamp(sort === 'created' ? a.created_at : (a.updated_at || a.created_at));
        const bDate = projectTimestamp(sort === 'created' ? b.created_at : (b.updated_at || b.created_at));
        return sort === 'created' ? aDate - bDate : bDate - aDate;
      });
    if (el.dashboardCount) {
      const count = filteredProjects.length;
      el.dashboardCount.textContent = query
        ? `${count} resultado${count === 1 ? '' : 's'} de ${dashboardProjects.length}`
        : `${count} projeto${count === 1 ? '' : 's'} salvo${count === 1 ? '' : 's'}`;
    }
    if (el.dashboardStatTotal) el.dashboardStatTotal.textContent = dashboardProjects.length;
    if (el.dashboardStatTotalHint) el.dashboardStatTotalHint.textContent = dashboardProjects.length
      ? 'Prontos para evoluir'
      : 'Seu primeiro começa aqui';
    const allDates = dashboardProjects
      .map((project) => projectTimestamp(project.updated_at || project.created_at))
      .filter((date) => !Number.isNaN(date));
    if (el.dashboardStatUpdated) {
      el.dashboardStatUpdated.textContent = allDates.length
        ? new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(Math.max(...allDates))).replace('.', '')
        : '—';
    }
    if (el.dashboardStatFiles) {
      const totalFiles = dashboardProjects.reduce((total, project) => {
        const files = Array.isArray(project.files) ? project.files : [];
        return total + files.length;
      }, 0);
      el.dashboardStatFiles.textContent = totalFiles;
    }
    if (!el.projectsGrid) return;
    el.projectsGrid.innerHTML = '';
    el.dashboardEmpty.hidden = dashboardProjects.length > 0;
    if (el.dashboardNoResults) el.dashboardNoResults.hidden = !dashboardProjects.length || filteredProjects.length > 0;
    el.projectsGrid.hidden = filteredProjects.length === 0;

    filteredProjects.forEach((project, index) => {
      const card = document.createElement('article');
      card.className = 'project-card';
      card.style.animationDelay = `${Math.min(index, 8) * 35}ms`;

      const top = document.createElement('div');
      top.className = 'project-card__top';
      const mark = document.createElement('span');
      mark.className = 'project-card__mark';
      mark.textContent = (project.name || project.nome || 'P').trim().charAt(0).toUpperCase() || 'P';
      mark.setAttribute('aria-hidden', 'true');
      const date = document.createElement('time');
      date.className = 'project-card__date';
      date.dateTime = project.updated_at || project.created_at || '';
      date.textContent = formatProjectDate(project.updated_at || project.created_at);
      top.append(mark, date);

      const body = document.createElement('div');
      body.className = 'project-card__body';
      const type = document.createElement('span');
      type.className = 'project-card__type';
      type.textContent = Array.isArray(project.files) && project.files.length ? `${project.files.length} arquivos` : 'Projeto IA';
      const name = document.createElement('h2');
      name.className = 'project-card__name';
      name.title = project.name || project.nome || 'Projeto sem nome';
      name.textContent = project.name || project.nome || 'Projeto sem nome';
      const meta = document.createElement('p');
      meta.className = 'project-card__meta';
      meta.textContent = project.prompt || 'Projeto pronto para continuar';
      body.append(type, name, meta);

      const actions = document.createElement('div');
      actions.className = 'project-card__actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'project-card__open';
      open.textContent = 'Abrir projeto';
      open.addEventListener('click', () => abrirProjeto(project.id));

      const rename = document.createElement('button');
      rename.type = 'button';
      rename.className = 'project-card__action';
      rename.title = `Renomear ${name.textContent}`;
      rename.setAttribute('aria-label', `Renomear ${name.textContent}`);
      rename.textContent = '✎';
      rename.addEventListener('click', () => renomearProjeto(project));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'project-card__action project-card__action--delete';
      remove.title = `Excluir ${name.textContent}`;
      remove.setAttribute('aria-label', `Excluir ${name.textContent}`);
      remove.textContent = '⌫';
      remove.addEventListener('click', () => excluirProjeto(project));

      actions.append(open, rename, remove);
      card.append(top, body, actions);
      el.projectsGrid.appendChild(card);
    });
  }

  async function carregarDashboard() {
    setWorkspaceView('dashboard');
    if (el.dashboardStatus) el.dashboardStatus.textContent = 'Carregando...';
    if (el.projectsGrid) el.projectsGrid.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch('/api/projects', { credentials: 'same-origin' });
      if (res.status === 401) {
        if (el.dashboardStatus) el.dashboardStatus.textContent = 'Entre para acessar seus projetos.';
        window.chequettoAuth?.openLogin();
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível carregar seus projetos.');
      dashboardProjects = Array.isArray(data.projects) ? data.projects : [];
      renderDashboard();
      if (el.dashboardStatus) el.dashboardStatus.textContent = '';
    } catch (error) {
      dashboardProjects = [];
      renderDashboard();
      if (el.dashboardStatus) el.dashboardStatus.textContent = error.message;
    } finally {
      el.projectsGrid?.removeAttribute('aria-busy');
    }
  }

  async function abrirProjeto(projectId) {
    if (!projectId) return;
    if (el.dashboardStatus) el.dashboardStatus.textContent = 'Abrindo projeto...';
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}`, {
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível abrir o projeto.');
      const project = data.project;
      const item = historyItemFromProject(project);
      state.projectId = project.id;
      state.projectName = project.name || project.nome || '';
      renderEditorProjectName();
      state.files = item.files;
      state.planoAtual = item.plano;
      if (el.prompt) el.prompt.value = project.prompt || '';
      showGeneratedCode(item.code, project.prompt || item.prompt);
      state.historico = state.historico.filter((history) => history.id !== project.id);
      state.historico.unshift(item);
      renderHistory();
      setWorkspaceView('editor');
      if (el.status) el.status.textContent = `Projeto "${state.projectName || item.prompt}" aberto.`;
    } catch (error) {
      if (el.dashboardStatus) el.dashboardStatus.textContent = error.message;
    }
  }

  async function renomearProjeto(project) {
    const currentName = project.name || project.nome || 'Projeto sem nome';
    const nextName = window.prompt('Digite o novo nome do projeto:', currentName);
    if (nextName === null) return;
    const name = nextName.trim();
    if (!name || name === currentName) return;

    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível renomear o projeto.');
      const updated = data.project || { ...project, name };
      dashboardProjects = dashboardProjects.map((item) => item.id === project.id ? { ...item, ...updated, name } : item);
      if (state.projectId === project.id) {
        state.projectName = name;
        renderEditorProjectName();
        state.historico = state.historico.map((item) => item.id === project.id
          ? { ...item, name, prompt: name, nome: name }
          : item);
        persistWorkspace();
      }
      renderDashboard();
      if (el.dashboardStatus) el.dashboardStatus.textContent = 'Projeto renomeado.';
    } catch (error) {
      if (el.dashboardStatus) el.dashboardStatus.textContent = error.message;
    }
  }

  async function excluirProjeto(project) {
    const name = project.name || project.nome || 'este projeto';
    if (!window.confirm(`Excluir "${name}"? Esta ação não pode ser desfeita.`)) return;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(project.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível excluir o projeto.');
      dashboardProjects = dashboardProjects.filter((item) => item.id !== project.id);
      state.historico = state.historico.filter((item) => item.id !== project.id);
      if (state.projectId === project.id) clearWorkspace();
      renderHistory();
      renderDashboard();
      if (el.dashboardStatus) el.dashboardStatus.textContent = 'Projeto excluído.';
    } catch (error) {
      if (el.dashboardStatus) el.dashboardStatus.textContent = error.message;
    }
  }

  function iniciarNovoProjeto() {
    clearTimeout(projectSaveTimer);
    clearWorkspace();
    setWorkspaceView('editor');
    if (el.status) el.status.textContent = 'Novo projeto pronto para começar.';
    el.prompt?.focus();
  }

  function readGithubConfig() {
    try {
      return JSON.parse(localStorage.getItem(storageKey('chequetto_github_config_v1')) || '{}');
    } catch {
      return {};
    }
  }

  function saveGithubConfig(config) {
    try {
      localStorage.setItem(storageKey('chequetto_github_config_v1'), JSON.stringify({
        repoUrl: config.repoUrl || '',
        branch: config.branch || 'main',
      }));
    } catch {
      // A configuração é apenas uma conveniência local; o fluxo continua sem ela.
    }
  }

  function openGithubModal() {
    const config = readGithubConfig();
    if (el.githubPushRepoUrl) el.githubPushRepoUrl.value = config.repoUrl || el.githubRepoUrl?.value || '';
    if (el.githubPushBranch) el.githubPushBranch.value = config.branch || 'main';
    if (el.githubPushMessage && !el.githubPushMessage.value) {
      el.githubPushMessage.value = `Atualização pelo Chequetto - ${state.projectName || 'projeto'}`;
    }
    if (el.githubPushStatus) el.githubPushStatus.textContent = '';
    if (el.githubPushOverlay) el.githubPushOverlay.hidden = false;
    el.githubPushRepoUrl?.focus();
  }

  function closeGithubModal() {
    if (el.githubPushOverlay) el.githubPushOverlay.hidden = true;
  }

  async function importarGithub() {
    const authenticated = await requireLoadedAuth();
    if (!authenticated) {
      window.chequettoAuth?.openLogin();
      return;
    }
    const repoUrl = el.githubRepoUrl?.value.trim();
    if (!repoUrl) {
      if (el.githubImportStatus) el.githubImportStatus.textContent = 'Cole a URL de um repositório público.';
      el.githubRepoUrl?.focus();
      return;
    }

    if (el.btnImportGithub) el.btnImportGithub.disabled = true;
    if (el.githubImportStatus) el.githubImportStatus.textContent = 'Lendo arquivos do repositório...';
    try {
      const response = await fetch('/api/github/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ repoUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível importar o repositório.');

      const repository = data.repository;
      const files = normalizeProjectFiles(repository.files);
      const html = projectHtml({ files });
      state.files = files;
      state.projectName = repository.name || repository.repo || 'Projeto importado';
      state.promptAtual = `Importado do GitHub: ${repository.fullName || repoUrl}`;
      if (el.prompt) el.prompt.value = state.promptAtual;
      state.codigoAtual = html || files[0]?.content || '';
      renderEditorProjectName();
      showGeneratedCode(state.codigoAtual, state.promptAtual);
      state.historico = state.historico.filter((item) => item.id !== state.projectId);
      const savedProject = await queueProjectSave({ silent: false });
      if (savedProject?.id) state.projectId = savedProject.id;
      state.historico.unshift({
        id: state.projectId,
        prompt: state.projectName,
        name: state.projectName,
        code: state.codigoAtual,
        files: state.files,
        plano: state.planoAtual,
      });
      renderHistory();
      persistWorkspace();
      setWorkspaceView('editor');
      if (el.githubImportStatus) el.githubImportStatus.textContent = `${files.length} arquivo(s) importado(s) e salvo(s).`;
      if (el.status) el.status.textContent = `Repositório ${repository.fullName || repoUrl} importado.`;
    } catch (error) {
      if (el.githubImportStatus) el.githubImportStatus.textContent = error.message;
    } finally {
      if (el.btnImportGithub) el.btnImportGithub.disabled = false;
    }
  }

  function isTextWorkspaceFile(file) {
    const path = String(file.webkitRelativePath || file.name || '').toLowerCase();
    return /\.(html?|css|js|jsx|ts|tsx|json|md|txt|xml|ya?ml|svg|sql|py|java|php|rb|go|rs|vue|svelte|env|gitignore|conf|ini|toml)$/i.test(path);
  }

  async function importarPasta(files) {
    const authenticated = await requireLoadedAuth();
    if (!authenticated) {
      requestEditorLogin();
      if (el.folderAttach) el.folderAttach.value = '';
      return;
    }

    const selectedFiles = Array.from(files || []);
    if (!selectedFiles.length) return;
    if (el.folderImportStatus) el.folderImportStatus.textContent = 'Lendo a pasta...';

    const readableFiles = selectedFiles
      .filter((file) => isTextWorkspaceFile(file) && file.size <= 1024 * 1024)
      .slice(0, 80);
    if (!readableFiles.length) {
      if (el.folderImportStatus) el.folderImportStatus.textContent = 'Não encontrei arquivos de texto compatíveis nessa pasta.';
      return;
    }

    try {
      const filesWithContent = await Promise.all(readableFiles.map(async (file) => ({
        path: file.webkitRelativePath || file.name,
        content: await file.text(),
        language: languageForPath(file.webkitRelativePath || file.name),
      })));
      const rootName = String(readableFiles[0].webkitRelativePath || readableFiles[0].name).split(/[\\/]/)[0];
      state.files = normalizeProjectFiles(filesWithContent);
      state.projectId = null;
      state.projectName = rootName || 'Pasta importada';
      state.promptAtual = `Pasta importada: ${state.projectName}`;
      if (el.prompt) el.prompt.value = state.promptAtual;
      state.codigoAtual = projectHtml({ files: state.files }) || state.files[0]?.content || '';
      renderEditorProjectName();
      showGeneratedCode(state.codigoAtual, state.promptAtual);
      const savedProject = await queueProjectSave({ silent: false });
      if (savedProject?.id) state.projectId = savedProject.id;
      state.historico.unshift({
        id: state.projectId,
        prompt: state.projectName,
        name: state.projectName,
        code: state.codigoAtual,
        files: state.files,
        plano: state.planoAtual,
      });
      renderHistory();
      persistWorkspace();
      setWorkspaceView('editor');
      if (el.folderImportStatus) {
        const skipped = selectedFiles.length - readableFiles.length;
        el.folderImportStatus.textContent = `${readableFiles.length} arquivo(s) importado(s)${skipped ? `; ${skipped} ignorado(s)` : ''}.`;
      }
      if (el.status) el.status.textContent = `Pasta "${state.projectName}" aberta e salva.`;
    } catch (error) {
      if (el.folderImportStatus) el.folderImportStatus.textContent = error.message || 'Não foi possível abrir a pasta.';
    } finally {
      if (el.folderAttach) el.folderAttach.value = '';
    }
  }

  function languageForPath(filePath) {
    const extension = String(filePath || '').split('.').pop()?.toLowerCase();
    return {
      html: 'html', htm: 'html', css: 'css', js: 'javascript', jsx: 'javascript',
      ts: 'typescript', tsx: 'typescript', json: 'json', md: 'markdown',
      xml: 'xml', svg: 'xml', yaml: 'yaml', yml: 'yaml', sql: 'sql', py: 'python',
    }[extension] || 'text';
  }

  async function baixarProjetoZip() {
    if (!(await requireLoadedAuth())) {
      requestEditorLogin();
      return;
    }
    if (!state.codigoAtual) {
      if (el.status) el.status.textContent = 'Gere, importe ou abra um projeto antes de baixar.';
      return;
    }
    try {
      if (!state.projectId) await queueProjectSave({ silent: false });
      if (!state.projectId) throw new Error('Salve o projeto antes de baixar o ZIP.');
      if (el.btnDownloadProject) el.btnDownloadProject.disabled = true;
      const response = await fetch(`/api/projects/${encodeURIComponent(state.projectId)}/download`, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Não foi possível preparar o ZIP.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${state.projectName || 'projeto'}.zip`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (el.status) el.status.textContent = 'Projeto baixado em ZIP.';
    } catch (error) {
      if (el.status) el.status.textContent = error.message;
    } finally {
      if (el.btnDownloadProject) el.btnDownloadProject.disabled = false;
    }
  }

  const extensionCatalog = [
    { id: 'html-format', icon: '⌘', name: 'Formatador HTML', description: 'Organiza o código do app para facilitar a leitura.', version: 'v1.0.0' },
    { id: 'live-preview', icon: '◉', name: 'Live Preview', description: 'Atualiza a prévia enquanto você edita o código.', version: 'v1.2.0' },
    { id: 'github-tools', icon: '↗', name: 'GitHub Tools', description: 'Importe, faça commit e baixe seus projetos pelo workspace.', version: 'v1.0.0' },
    { id: 'snippets', icon: '✦', name: 'Snippets Chequetto', description: 'Atalhos para login, dashboard, formulários e componentes.', version: 'v1.1.0' },
    { id: 'theme-neon', icon: '◐', name: 'Tema Neon', description: 'Uma aparência escura para trabalhar à noite.', version: 'v1.0.0' },
  ];

  function readExtensions() {
    try {
      return JSON.parse(localStorage.getItem(storageKey('chequetto_extensions_v1')) || '[]');
    } catch {
      return [];
    }
  }

  function saveExtensions(ids) {
    try { localStorage.setItem(storageKey('chequetto_extensions_v1'), JSON.stringify(ids)); } catch {}
  }

  function escapeExtensionText(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[character]));
  }

  function renderExtensions() {
    if (!el.extensionsGrid) return;
    const installed = readExtensions();
    el.extensionsGrid.innerHTML = '';
    extensionCatalog.forEach((extension) => {
      const isInstalled = installed.includes(extension.id);
      const card = document.createElement('article');
      card.className = `extension-card${isInstalled ? ' is-installed' : ''}`;
      card.innerHTML = `
        <span class="extension-card__icon" aria-hidden="true">${escapeExtensionText(extension.icon)}</span>
        <div class="extension-card__body">
          <h3 class="extension-card__name">${escapeExtensionText(extension.name)}</h3>
          <p class="extension-card__description">${escapeExtensionText(extension.description)}</p>
          <p class="extension-card__meta">${escapeExtensionText(extension.version)} · ${isInstalled ? 'Ativa no workspace' : 'Disponível'}</p>
        </div>
        <button type="button" class="extension-card__button">${isInstalled ? 'Desativar' : 'Instalar'}</button>
      `;
      card.querySelector('button').addEventListener('click', () => {
        const next = isInstalled ? installed.filter((id) => id !== extension.id) : [...installed, extension.id];
        saveExtensions(next);
        renderExtensions();
        if (el.extensionsStatus) el.extensionsStatus.textContent = isInstalled
          ? `${extension.name} desativada.`
          : `${extension.name} instalada neste workspace.`;
      });
      el.extensionsGrid.appendChild(card);
    });
  }

  function abrirExtensoes() {
    renderExtensions();
    if (el.extensionsOverlay) el.extensionsOverlay.hidden = false;
  }

  async function adicionarExtensaoLocal(file) {
    if (!file) return;
    try {
      const manifest = JSON.parse(await file.text());
      if (!manifest.name || typeof manifest.name !== 'string') throw new Error('O manifesto precisa ter um campo "name".');
      const id = `custom-${manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
      extensionCatalog.push({
        id,
        icon: manifest.icon || '◈',
        name: manifest.name.slice(0, 60),
        description: String(manifest.description || 'Extensão adicionada ao workspace.').slice(0, 140),
        version: `v${String(manifest.version || '1.0.0').replace(/^v/i, '')}`,
      });
      saveExtensions([...readExtensions(), id]);
      renderExtensions();
      if (el.extensionsStatus) el.extensionsStatus.textContent = `${manifest.name} adicionada ao workspace.`;
    } catch (error) {
      if (el.extensionsStatus) el.extensionsStatus.textContent = error.message || 'Manifesto JSON inválido.';
    } finally {
      if (el.extensionUpload) el.extensionUpload.value = '';
    }
  }

  async function enviarParaGithub(event) {
    event.preventDefault();
    const authenticated = await requireLoadedAuth();
    if (!authenticated) {
      closeGithubModal();
      window.chequettoAuth?.openLogin();
      return;
    }
    if (!state.codigoAtual) {
      if (el.githubPushStatus) el.githubPushStatus.textContent = 'Gere ou importe um projeto antes de enviar.';
      return;
    }
    const repoUrl = el.githubPushRepoUrl?.value.trim();
    const branch = el.githubPushBranch?.value.trim() || 'main';
    const message = el.githubPushMessage?.value.trim();
    const token = el.githubPushToken?.value.trim() || '';
    if (!repoUrl) {
      if (el.githubPushStatus) el.githubPushStatus.textContent = 'Informe o repositório de destino.';
      return;
    }

    if (el.btnConfirmGithubPush) el.btnConfirmGithubPush.disabled = true;
    if (el.githubPushStatus) el.githubPushStatus.textContent = 'Salvando a versão atual e criando commit...';
    try {
      await queueProjectSave({ silent: false });
      const response = await fetch('/api/github/push', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          projectId: state.projectId,
          repoUrl,
          branch,
          message,
          // O backend usa GITHUB_TOKEN dos Secrets quando este campo está vazio.
          token,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível enviar para o GitHub.');
      saveGithubConfig({ repoUrl, branch });
      if (el.githubPushStatus) {
        el.githubPushStatus.textContent = `Commit enviado: ${data.result.filesCount} arquivo(s) em ${data.result.branch}.`;
      }
      if (el.githubPushToken) el.githubPushToken.value = '';
      if (el.status) el.status.textContent = 'Projeto enviado para o GitHub.';
    } catch (error) {
      if (el.githubPushStatus) el.githubPushStatus.textContent = error.message;
    } finally {
      if (el.btnConfirmGithubPush) el.btnConfirmGithubPush.disabled = false;
    }
  }

  const rotatingKeywords = ['ideias em aplicativos', 'processos em automações', 'problemas em soluções', 'planos em produtos reais', 'descrições em interfaces prontas'];
  let rotatingKeywordIndex = 0;
  const rotatingKeyword = document.getElementById('rotatingKeyword');
  const buildPromise = document.getElementById('buildPromise');
  const carouselTitle = document.getElementById('carouselTitle');
  const carouselDescription = document.getElementById('carouselDescription');
  const carouselBenefit = document.getElementById('carouselBenefit');
  const carouselDots = document.getElementById('carouselDots');
  const carouselCta = document.getElementById('carouselCta');
  const carouselSlides = [
    {
      title: 'Transforme uma ideia em um app funcional',
      description: 'Descreva seu objetivo e a IA monta telas, componentes e interações para você testar agora.',
      benefit: 'Comece grátis com 20 créditos e refine o resultado conversando.',
    },
    {
      title: 'Crie com clareza, mesmo sem programar',
      description: 'Explique público, telas, regras e estilo. Quanto mais contexto você enviar, mais preciso será o primeiro resultado.',
      benefit: 'Anexe PDFs, planilhas ou código para a IA entender seu projeto.',
    },
    {
      title: 'Teste, ajuste e salve sua evolução',
      description: 'Veja a prévia em desktop, tablet ou celular e peça alterações sem começar tudo de novo.',
      benefit: 'Seu histórico fica disponível para retomar ideias e comparar versões.',
    },
  ];
  let carouselIndex = 0;
  function renderCarousel() {
    const slide = carouselSlides[carouselIndex];
    if (carouselTitle) carouselTitle.textContent = slide.title;
    if (carouselDescription) carouselDescription.textContent = slide.description;
    if (carouselBenefit) carouselBenefit.textContent = slide.benefit;
    if (carouselDots) {
      carouselDots.innerHTML = carouselSlides.map((_, index) => `<span class="carousel-dot${index === carouselIndex ? ' is-active' : ''}"></span>`).join('');
    }
  }
  renderCarousel();
  if (carouselTitle) {
    setInterval(() => {
      carouselIndex = (carouselIndex + 1) % carouselSlides.length;
      renderCarousel();
    }, 4200);
  }
  carouselCta?.addEventListener('click', () => window.chequettoAuth?.openLogin());
  if (rotatingKeyword) {
    setInterval(() => {
      rotatingKeywordIndex = (rotatingKeywordIndex + 1) % rotatingKeywords.length;
      rotatingKeyword.textContent = rotatingKeywords[rotatingKeywordIndex];
    }, 2600);
  }

  let loginPromptGuard = false;
  let authRequestedForPrompt = false;

  window.addEventListener('chequetto:authenticated', (event) => {
    const wasDashboardVisible = el.dashboardView && !el.dashboardView.hidden;
    const focusAfterLogin = pendingEditorFocus;
    pendingEditorFocus = null;
    activeUserId = event.detail?.user?.id || null;
    const firstName = String(event.detail?.user?.name || '').trim().split(/\s+/)[0];
    if (el.dashboardGreeting) el.dashboardGreeting.textContent = firstName
      ? `Olá, ${firstName}.`
      : 'Seu espaço de criação.';
    clearWorkspace();
    restoreWorkspace();
    authRequestedForPrompt = false;
    loginPromptGuard = false;
    if (wasDashboardVisible) carregarDashboard();
    else setTimeout(() => (focusAfterLogin || el.prompt)?.focus(), 0);
  });

  window.addEventListener('chequetto:logged-out', () => {
    activeUserId = null;
    if (el.dashboardGreeting) el.dashboardGreeting.textContent = 'Seu espaço de criação.';
    clearWorkspace();
    setWorkspaceView('editor');
  });

  function requireLoadedAuth() {
    const auth = window.chequettoAuth;
    if (!auth) return Promise.resolve(false);
    if (!auth.isLoading?.()) return Promise.resolve(auth.isAuthenticated());
    return auth.whenReady().then(() => auth.isAuthenticated());
  }

  function requestEditorLogin(target = null) {
    if (target && target !== document.body) pendingEditorFocus = target;
    if (el.status) el.status.textContent = 'Entre ou crie sua conta para continuar.';
    window.chequettoAuth?.openLogin();
  }

  // Qualquer campo editável do editor exige uma conta. O foco é devolvido ao
  // campo original depois do login para que a pessoa continue sem perder o
  // contexto do que estava fazendo.
  document.addEventListener('focusin', async (event) => {
    const target = event.target.closest?.('textarea, input, [contenteditable="true"]');
    if (!target || target.closest('#authModalOverlay') || !target.closest('.bench, #editorView')) return;
    const authenticated = await requireLoadedAuth();
    if (authenticated) return;
    pendingEditorFocus = target;
    target.blur();
    if (!loginPromptGuard) {
      loginPromptGuard = true;
      requestEditorLogin(target);
      setTimeout(() => { loginPromptGuard = false; }, 500);
    }
  });

  el.prompt?.addEventListener('input', () => {
    if (!window.chequettoAuth?.isAuthenticated()) {
      el.prompt.blur();
      requestEditorLogin(el.prompt);
      return;
    }
    state.promptDraft = el.prompt.value;
    persistWorkspace();
    // O prompt também faz parte do estado do projeto atual. O debounce evita
    // uma requisição por tecla, sem deixar a edição do usuário sem persistir.
    scheduleProjectSave();
  });

  fetch('/api/health')
    .then(res => res.json())
    .then(() => {
      if (el.apiStatus) el.apiStatus.textContent = 'servidor online';
    })
    .catch(() => {
      if (el.apiStatus) el.apiStatus.textContent = 'erro no servidor';
    });

  if (el.examples) {
    el.examples.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (chip && el.prompt) {
        el.prompt.value = chip.getAttribute('data-example');
      }
    });
  }

  document.getElementById('aiTips')?.addEventListener('click', (event) => {
    if (window.chequettoAuth?.isLoading?.()) return;
    if (!window.chequettoAuth?.isAuthenticated()) {
      window.chequettoAuth?.openLogin();
      return;
    }
    const tip = event.target.closest('[data-tip]')?.getAttribute('data-tip');
    if (!tip || !el.prompt) return;
    el.prompt.value = el.prompt.value.trim()
      ? `${el.prompt.value.trim()}\n${tip}`
      : tip;
    el.prompt.focus();
  });

  el.fileAttach?.addEventListener('change', () => {
    if (!window.chequettoAuth?.isAuthenticated()) {
      window.chequettoAuth?.openLogin();
      el.fileAttach.value = '';
      return;
    }
    addAttachedFiles(el.fileAttach.files);
    el.fileAttach.value = '';
  });

  el.prompt?.addEventListener('paste', (event) => {
    if (!window.chequettoAuth?.isAuthenticated()) {
      event.preventDefault();
      el.prompt.blur();
      requestEditorLogin(el.prompt);
      return;
    }
    const pastedFiles = Array.from(event.clipboardData?.files || []);
    if (!pastedFiles.length) return;
    event.preventDefault();
    addAttachedFiles(pastedFiles);
    if (el.micHint) el.micHint.textContent = `${pastedFiles.length} arquivo(s) colado(s). Clique em Gerar App para ler.`;
  });

  el.prompt?.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      el.btnGerar?.click();
    }
  });

  // ===================== MICROFONE (falar em vez de digitar) =====================
  (function setupMic() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (el.btnMic) {
        el.btnMic.disabled = true;
        el.btnMic.title = 'Seu navegador não suporta reconhecimento de voz. Tente pelo Chrome.';
        el.btnMic.style.opacity = '0.35';
      }
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;

    let gravando = false;

    recognition.onresult = (event) => {
      const texto = event.results[0][0].transcript;
      if (el.prompt) {
        el.prompt.value = el.prompt.value ? el.prompt.value + ' ' + texto : texto;
        el.prompt.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };

    recognition.onerror = () => {
      if (el.micHint) el.micHint.textContent = 'Não consegui te ouvir, tenta de novo.';
    };

    recognition.onend = () => {
      gravando = false;
      if (el.btnMic) el.btnMic.classList.remove('is-recording');
      if (el.micHint) el.micHint.textContent = 'Quanto mais detalhes, melhor o resultado.';
    };

    if (el.btnMic) {
      el.btnMic.addEventListener('click', () => {
        if (!window.chequettoAuth?.isAuthenticated()) {
          window.chequettoAuth?.openLogin();
          return;
        }
        if (gravando) {
          recognition.stop();
          return;
        }
        gravando = true;
        el.btnMic.classList.add('is-recording');
        if (el.micHint) el.micHint.textContent = 'Ouvindo... fale o que você quer criar.';
        recognition.start();
      });
    }
  })();

  function setStage(stage) {
    if (!el.stageBar) return;
    el.stageBar.hidden = false;
    el.stagePlanejar.classList.toggle('is-active', stage === 'planejando');
    el.stagePlanejar.classList.toggle('is-done', stage === 'criando' || stage === 'concluido');
    el.stageCriar.classList.toggle('is-active', stage === 'criando');
    el.stageCriar.classList.toggle('is-done', stage === 'concluido');
  }

  function renderPlano(plano) {
    if (!el.planoList || !plano) return;
    el.planoList.innerHTML = '';
    plano.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      el.planoList.appendChild(li);
    });
    el.planoList.hidden = false;
  }

  async function extractAttachedFiles() {
    if (!state.attachedFiles.length) return '';
    const formData = new FormData();
    state.attachedFiles.forEach((file) => formData.append('files', file));
    const response = await fetch('/api/files/extract', { method: 'POST', body: formData });
    const responseText = await response.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new Error(`O servidor respondeu com um formato inesperado (HTTP ${response.status}). Verifique se o arquivo tem até 50 MB.`);
    }
    if (!response.ok) throw new Error(data.error || 'Não foi possível ler os anexos.');
    return (data.documents || []).map((document) => {
      if (!document.readable) return `Arquivo anexado: ${document.name} (${document.message})`;
      return `Arquivo: ${document.name}\nConteúdo:\n${document.text || '[arquivo sem texto]'}`;
    }).join('\n\n');
  }

  if (el.btnGerar) {
    el.btnGerar.addEventListener('click', async () => {
      if (!(await requireLoadedAuth())) {
        authRequestedForPrompt = true;
        window.chequettoAuth?.openLogin();
        if (el.status) el.status.textContent = 'Entre ou crie sua conta para gerar o aplicativo.';
        return;
      }
      if (!window.chequettoAuth?.isAuthenticated()) {
        authRequestedForPrompt = true;
        window.chequettoAuth?.openLogin();
        if (el.status) el.status.textContent = 'Entre ou crie sua conta para gerar o aplicativo.';
        return;
      }
      const basePrompt = el.prompt ? el.prompt.value.trim() : '';
      if (!basePrompt && !state.attachedFiles.length) {
        alert('Por favor, descreva o aplicativo que você quer criar.');
        return;
      }

      setLoading(true);
      if (el.status) el.status.textContent = state.attachedFiles.length ? 'Lendo seus arquivos...' : 'Preparando o pedido...';
      let filesContext = '';
      try {
        filesContext = await extractAttachedFiles();
      } catch (error) {
        if (el.status) el.status.textContent = 'Erro: ' + error.message;
        setLoading(false);
        return;
      }
      const promptText = [basePrompt, filesContext].filter(Boolean).join('\n\n');
      state.promptAtual = promptText;
      if (el.planoList) { el.planoList.innerHTML = ''; el.planoList.hidden = true; }
      setStage('planejando');

      const language = window.chequettoI18n?.getLanguage?.() || 'pt';
      const source = new EventSource('/generate/stream?prompt=' + encodeURIComponent(promptText) + '&lang=' + encodeURIComponent(language));

      source.onmessage = async (event) => {
        const data = JSON.parse(event.data);

        if (data.stage === 'planejando' && data.plano) {
          renderPlano(data.plano);
          state.planoAtual = data.plano;
        }
        if (data.stage === 'criando') {
          setStage('criando');
          if (el.status) el.status.textContent = data.message;
        }
        if (data.stage === 'planejando' && !data.plano) {
          if (el.status) el.status.textContent = data.message;
        }

        if (data.stage === 'salvo_temp') {
          showGeneratedCode(data.html, promptText);
          if (data.project?.id) {
            state.projectId = data.project.id;
            state.projectName = data.project.name || state.projectName;
            renderEditorProjectName();
          }

          let savedProject = null;
          try {
            savedProject = await queueProjectSave({ silent: true });
          } catch {
            // A geração continua disponível localmente mesmo se a gravação
            // remota falhar; o usuário pode tentar novamente pelo botão.
          }

          state.historico.push({
            id: savedProject?.id || state.projectId || null,
            prompt: promptText,
            code: data.html,
            files: state.files,
            plano: state.planoAtual,
          });
          renderHistory();
          persistWorkspace();

          if (window.chequettoAuth?.refresh) {
            window.chequettoAuth.refresh();
          }

          if (el.status) el.status.textContent = 'Aplicativo gerado com sucesso!';
          setLoading(false);
          source.close();
        }

        if (data.stage === 'erro') {
          if (el.status) el.status.textContent = 'Erro: ' + data.message;
          setLoading(false);
          source.close();
        }
      };

      source.onerror = () => {
        if (el.status) el.status.textContent = 'Erro de conexão ao gerar o aplicativo.';
        setLoading(false);
        source.close();
      };
    });
  }

  function setLoading(loading) {
    if (el.btnGerar) el.btnGerar.disabled = loading;
    if (el.spinner) el.spinner.hidden = !loading;
    if (el.btnGerarLabel) el.btnGerarLabel.textContent = loading ? 'Gerando...' : 'Gerar aplicativo';
    if (loading && el.status) el.status.textContent = 'A Inteligência Artificial está montando o app...';
    if (buildPromise) {
      buildPromise.textContent = loading
        ? 'Enquanto você espera, estamos transformando sua ideia em uma experiência que pode ser testada e ajustada agora.'
        : 'Sua ideia vira um aplicativo funcional, pronto para testar e refinar.';
      buildPromise.classList.toggle('is-loading', loading);
    }
    if (!loading && el.stageBar) {
      setTimeout(() => { el.stageBar.hidden = true; }, 1200);
    }
  }

  function renderHistory() {
    if (!el.historyList) return;
    el.historyList.innerHTML = '';
    state.historico.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item.prompt;
      li.addEventListener('click', () => {
        state.projectId = item.id || null;
        state.projectName = item.nome || item.name || '';
        state.files = normalizeProjectFiles(item.files, item.code || '');
        state.planoAtual = item.plano || [];
        showGeneratedCode(item.code, item.prompt);
      });
      el.historyList.appendChild(li);
    });
  }

  el.btnMeusProjetos?.addEventListener('click', carregarDashboard);
  el.btnNovoProjeto?.addEventListener('click', iniciarNovoProjeto);
  el.btnNovoProjetoVazio?.addEventListener('click', iniciarNovoProjeto);
  el.dashboardStart?.addEventListener('click', iniciarNovoProjeto);
  el.dashboardSearch?.addEventListener('input', () => renderDashboard());
  el.dashboardSort?.addEventListener('change', () => renderDashboard());
  el.btnCriarApp?.addEventListener('click', () => setWorkspaceView('editor'));
  el.btnBackDashboard?.addEventListener('click', carregarDashboard);
  el.btnImportGithub?.addEventListener('click', importarGithub);
  el.folderAttach?.addEventListener('change', () => importarPasta(el.folderAttach.files));
  el.githubRepoUrl?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      importarGithub();
    }
  });
  el.btnGithubPush?.addEventListener('click', async () => {
    if (!(await requireLoadedAuth())) {
      requestEditorLogin();
      return;
    }
    openGithubModal();
  });
  el.closeGithubModal?.addEventListener('click', closeGithubModal);
  el.githubPushOverlay?.addEventListener('click', (event) => {
    if (event.target === el.githubPushOverlay) closeGithubModal();
  });
  el.btnDownloadProject?.addEventListener('click', baixarProjetoZip);
  el.btnExtensions?.addEventListener('click', async () => {
    if (!(await requireLoadedAuth())) {
      requestEditorLogin();
      return;
    }
    abrirExtensoes();
  });
  el.closeExtensions?.addEventListener('click', () => {
    if (el.extensionsOverlay) el.extensionsOverlay.hidden = true;
  });
  el.extensionsOverlay?.addEventListener('click', (event) => {
    if (event.target === el.extensionsOverlay) el.extensionsOverlay.hidden = true;
  });
  el.extensionUpload?.addEventListener('change', () => adicionarExtensaoLocal(el.extensionUpload.files?.[0]));
  el.githubPushForm?.addEventListener('submit', enviarParaGithub);

  el.btnRefinar?.addEventListener('click', async () => {
    if (!(await requireLoadedAuth())) {
      requestEditorLogin(el.refineInput);
      return;
    }
    const pedido = el.refineInput?.value.trim();
    if (!pedido) return;
    if (!state.codigoAtual) {
      if (el.status) el.status.textContent = 'Gere um aplicativo antes de pedir uma alteração.';
      return;
    }
    el.btnRefinar.disabled = true;
    el.btnRefinar.textContent = 'Aplicando...';
    if (el.status) el.status.textContent = 'A IA está atualizando seu aplicativo...';
    try {
      const res = await fetch('/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          html: state.codigoAtual,
          pedido,
          projectId: state.projectId || undefined,
          prompt: state.promptAtual,
          plano: state.planoAtual,
          name: state.projectName || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao refinar');
      if (data.project?.id) {
        state.projectId = data.project.id;
        state.projectName = data.project.name || state.projectName;
        renderEditorProjectName();
      }
      showGeneratedCode(data.code, state.promptAtual + ' / ' + pedido);
      let savedProject = null;
      try {
        savedProject = await queueProjectSave({ silent: true });
      } catch {
        // Mantém a alteração no workspace local se a API estiver indisponível.
      }
      state.historico.push({
        id: savedProject?.id || state.projectId || null,
        prompt: 'Ajuste: ' + pedido,
        code: data.code,
        files: state.files,
        plano: state.planoAtual,
      });
      renderHistory();
      persistWorkspace();
      if (el.refineInput) el.refineInput.value = '';
      if (el.status) el.status.textContent = 'Alteração aplicada com sucesso!';
    } catch (error) {
      if (el.status) el.status.textContent = 'Erro: ' + error.message;
    } finally {
      el.btnRefinar.disabled = false;
      el.btnRefinar.textContent = 'Aplicar alteração';
    }
  });

  el.refineInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') el.btnRefinar?.click();
  });

  if (el.btnCopiar) {
    el.btnCopiar.addEventListener('click', async () => {
      if (!state.codigoAtual) return;
      await navigator.clipboard.writeText(state.codigoAtual);
      const original = el.btnCopiar.textContent;
      el.btnCopiar.textContent = 'Copiado!';
      setTimeout(() => (el.btnCopiar.textContent = original), 1500);
    });
  }

  if (el.btnBaixar) {
    el.btnBaixar.addEventListener('click', () => {
      if (!state.codigoAtual) return;
      const blob = new Blob([state.codigoAtual], { type: 'text/html' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'meu-aplicativo.html';
      a.click();
    });
  }

  if (el.btnSalvar) {
    el.btnSalvar.addEventListener('click', async () => {
      if (!state.codigoAtual) return;
      el.btnSalvar.disabled = true;
      const original = el.btnSalvar.textContent;
      el.btnSalvar.textContent = 'Salvando...';
      try {
        if (!activeUserId) throw new Error('Não autenticado');
        const data = await queueProjectSave({ silent: false });
        const savedProject = {
          id: data?.id || state.projectId,
          prompt: state.promptAtual,
          nome: data?.name || state.projectName || state.promptAtual.slice(0, 60),
          name: data?.name || state.projectName || state.promptAtual.slice(0, 60),
          html: state.codigoAtual,
          files: state.files,
          plano: state.planoAtual,
        };
        persistSavedProject(savedProject);
        state.historico = state.historico.filter((item) => item.id !== savedProject.id);
        state.historico.unshift({
          id: savedProject.id,
          prompt: savedProject.nome,
          code: savedProject.html,
          files: savedProject.files,
          plano: savedProject.plano,
        });
        renderHistory();
        persistWorkspace();
        el.btnSalvar.textContent = 'Salvo ✓';
        setTimeout(() => { el.btnSalvar.textContent = original; el.btnSalvar.disabled = false; }, 1800);
      } catch (error) {
        if (error.message === 'Não autenticado') {
          window.chequettoAuth?.openLogin();
        }
        el.btnSalvar.textContent = 'Erro ao salvar';
        setTimeout(() => { el.btnSalvar.textContent = original; el.btnSalvar.disabled = false; }, 1800);
      }
    });
  }

  const btnShareWhatsapp = document.getElementById('btnShareWhatsapp');
  btnShareWhatsapp?.addEventListener('click', () => {
    const link = window.chequettoAuth?.getReferralLink?.() || window.location.origin;
    const text = encodeURIComponent(`Crie seu aplicativo grátis no Chequetto: ${link}`);
    const url = `https://wa.me/?text=${text}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  if (el.tabs) {
    el.tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        el.tabs.forEach(t => t.classList.remove('is-active'));
        tab.classList.add('is-active');
        const view = tab.getAttribute('data-view');
        if (view === 'preview') {
          if (el.previewFrame) el.previewFrame.hidden = false;
          if (el.codeView) el.codeView.hidden = true;
        } else {
          if (el.previewFrame) el.previewFrame.hidden = true;
          if (el.codeView) el.codeView.hidden = false;
        }
      });
    });
  }

  if (el.devices) {
    el.devices.forEach(dev => {
      dev.addEventListener('click', () => {
        el.devices.forEach(d => d.classList.remove('is-active'));
        dev.classList.add('is-active');
        const w = dev.getAttribute('data-width');
        if (el.frameWrap) el.frameWrap.style.width = w;
      });
    });
  }
});

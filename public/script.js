document.addEventListener('DOMContentLoaded', () => {
  const el = {
    prompt: document.getElementById('prompt'),
    btnGerar: document.getElementById('btnGerar'),
    btnGerarLabel: document.getElementById('btnGerarLabel'),
    spinner: document.getElementById('spinner'),
    status: document.getElementById('status'),
    historyList: document.getElementById('historyList'),
    apiStatus: document.getElementById('apiStatus'),
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
    planoAtual: [],
    historico: [],
    attachedFiles: []
  };

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

  function showGeneratedCode(html, promptText = state.promptAtual) {
    state.codigoAtual = html;
    const blob = new Blob([html], { type: 'text/html' });
    if (el.previewFrame) {
      el.previewFrame.hidden = false;
      el.previewFrame.src = URL.createObjectURL(blob);
    }
    if (el.codeViewText) el.codeViewText.textContent = html;
    if (el.emptyState) el.emptyState.hidden = true;
    if (el.btnCopiar) el.btnCopiar.disabled = false;
    if (el.btnBaixar) el.btnBaixar.disabled = false;
    if (el.btnSalvar) el.btnSalvar.disabled = false;
    if (el.btnRefinar) el.btnRefinar.disabled = false;
    state.promptAtual = promptText;
  }

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

  el.fileAttach?.addEventListener('change', () => {
    state.attachedFiles.push(...Array.from(el.fileAttach.files || []));
    renderAttachedFiles();
    el.fileAttach.value = '';
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
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Não foi possível ler os anexos.');
    return (data.documents || []).map((document) => {
      if (!document.readable) return `Arquivo anexado: ${document.name} (${document.message})`;
      return `Arquivo: ${document.name}\nConteúdo:\n${document.text || '[arquivo sem texto]'}`;
    }).join('\n\n');
  }

  if (el.btnGerar) {
    el.btnGerar.addEventListener('click', async () => {
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

      const source = new EventSource('/generate/stream?prompt=' + encodeURIComponent(promptText));

      source.onmessage = (event) => {
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

          state.historico.push({ prompt: promptText, code: data.html, plano: state.planoAtual });
          renderHistory();

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
        state.planoAtual = item.plano || [];
        showGeneratedCode(item.code, item.prompt);
      });
      el.historyList.appendChild(li);
    });
  }

  async function carregarProjetosSalvos() {
    if (!el.btnMeusProjetos) return;
    const original = el.btnMeusProjetos.innerHTML;
    el.btnMeusProjetos.disabled = true;
    el.btnMeusProjetos.innerHTML = '<span>...</span> Carregando projetos';
    try {
      const res = await fetch('/api/projects');
      if (res.status === 401) {
        if (el.status) el.status.textContent = 'Entre na sua conta para acessar seus projetos salvos.';
        return;
      }
      const data = await res.json();
      const projetos = data.projects || [];
      if (!projetos.length) {
        if (el.status) el.status.textContent = 'Nenhum projeto salvo ainda.';
        return;
      }
      projetos.forEach((projeto) => {
        state.historico.push({
          prompt: projeto.nome || projeto.prompt,
          code: projeto.html,
          plano: projeto.plano || [],
        });
      });
      renderHistory();
      if (el.status) el.status.textContent = `${projetos.length} projeto(s) carregado(s).`;
    } catch {
      if (el.status) el.status.textContent = 'Não foi possível carregar seus projetos.';
    } finally {
      el.btnMeusProjetos.disabled = false;
      el.btnMeusProjetos.innerHTML = original;
    }
  }

  el.btnMeusProjetos?.addEventListener('click', carregarProjetosSalvos);

  el.btnRefinar?.addEventListener('click', async () => {
    const pedido = el.refineInput?.value.trim();
    if (!pedido || !state.codigoAtual) return;
    el.btnRefinar.disabled = true;
    el.btnRefinar.textContent = 'Aplicando...';
    if (el.status) el.status.textContent = 'A IA está atualizando seu aplicativo...';
    try {
      const res = await fetch('/refine', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: state.codigoAtual, pedido }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Falha ao refinar');
      showGeneratedCode(data.code, state.promptAtual + ' / ' + pedido);
      state.historico.push({ prompt: 'Ajuste: ' + pedido, code: data.code, plano: state.planoAtual });
      renderHistory();
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
        const res = await fetch('/api/projects/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: state.promptAtual, plano: state.planoAtual, html: state.codigoAtual }),
        });
        if (!res.ok) throw new Error('Falha ao salvar');
        el.btnSalvar.textContent = 'Salvo ✓';
        setTimeout(() => { el.btnSalvar.textContent = original; el.btnSalvar.disabled = false; }, 1800);
      } catch {
        el.btnSalvar.textContent = 'Erro ao salvar';
        setTimeout(() => { el.btnSalvar.textContent = original; el.btnSalvar.disabled = false; }, 1800);
      }
    });
  }

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

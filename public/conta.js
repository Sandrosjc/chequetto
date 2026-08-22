// conta.js — controla login, cadastro e exibição de créditos na Oficina
document.addEventListener('DOMContentLoaded', () => {
  const el = {
    accountArea: document.getElementById('accountArea'),
    modalOverlay: document.getElementById('authModalOverlay'),
    modal: document.getElementById('authModal'),
    tabLogin: document.getElementById('authTabLogin'),
    tabSignup: document.getElementById('authTabSignup'),
    formLogin: document.getElementById('formLogin'),
    formSignup: document.getElementById('formSignup'),
    loginEmail: document.getElementById('loginEmail'),
    loginPassword: document.getElementById('loginPassword'),
    loginError: document.getElementById('loginError'),
    signupName: document.getElementById('signupName'),
    signupEmail: document.getElementById('signupEmail'),
    signupPassword: document.getElementById('signupPassword'),
    signupError: document.getElementById('signupError'),
    closeModal: document.getElementById('closeAuthModal'),
  };

  let currentUser = null;

  async function fetchMe() {
    try {
      const res = await fetch('/api/me');
      if (!res.ok) {
        currentUser = null;
        renderAccountArea();
        return;
      }
      const data = await res.json();
      currentUser = data.user;
      renderAccountArea();
    } catch {
      currentUser = null;
      renderAccountArea();
    }
  }

  function renderAccountArea() {
    if (!el.accountArea) return;

    if (currentUser) {
      el.accountArea.innerHTML = `
        <div class="account-chip">
          <span class="account-chip__credits">⚡ ${currentUser.unlimited ? '∞' : currentUser.credits}</span>
          <span class="account-chip__email">${currentUser.email}</span>
          <button class="btn-ghost btn-ghost--small" id="btnLogout">Sair</button>
        </div>
      `;
      document.getElementById('btnLogout')?.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST' });
        currentUser = null;
        renderAccountArea();
      });
    } else {
      el.accountArea.innerHTML = `<button class="btn-secondary btn-secondary--small" id="btnAbrirLogin">Entrar</button>`;
      document.getElementById('btnAbrirLogin')?.addEventListener('click', openModal);
    }
  }

  function openModal() {
    el.modalOverlay.hidden = false;
    switchTab('login');
  }

  function closeModal() {
    el.modalOverlay.hidden = true;
    el.loginError.textContent = '';
    el.signupError.textContent = '';
  }

  function switchTab(which) {
    const isLogin = which === 'login';
    el.tabLogin.classList.toggle('is-active', isLogin);
    el.tabSignup.classList.toggle('is-active', !isLogin);
    el.formLogin.hidden = !isLogin;
    el.formSignup.hidden = isLogin;
  }

  el.tabLogin?.addEventListener('click', () => switchTab('login'));
  el.tabSignup?.addEventListener('click', () => switchTab('signup'));
  el.closeModal?.addEventListener('click', closeModal);
  el.modalOverlay?.addEventListener('click', (e) => {
    if (e.target === el.modalOverlay) closeModal();
  });

  el.formLogin?.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.loginError.textContent = '';
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: el.loginEmail.value, password: el.loginPassword.value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao entrar');
      currentUser = data.user;
      renderAccountArea();
      closeModal();
    } catch (err) {
      el.loginError.textContent = err.message;
    }
  });

  el.formSignup?.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.signupError.textContent = '';
    try {
      const params = new URLSearchParams(window.location.search);
      const referralCode = params.get('convite') || undefined;

      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: el.signupName.value,
          email: el.signupEmail.value,
          password: el.signupPassword.value,
          referralCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao criar conta');
      currentUser = data.user;
      renderAccountArea();
      closeModal();
    } catch (err) {
      el.signupError.textContent = err.message;
    }
  });

  fetchMe();
});

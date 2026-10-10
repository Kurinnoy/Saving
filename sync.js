const GitSync = (() => {
  const KEY = 'familySavings';
  const CFG_KEY = 'githubConfig';
  const SYNCED_KEY = 'githubSynced';
  const PW_KEY = 'githubPassword';
  const NAV_KEY = 'internalNavigation';
  const UNSENT_KEY = 'unsentChanges';
  const DELAY_MS = 1500;
  const { isValidGithubConfig, githubUrl, encodeContent } = Savings;

  // Settings and token are kept permanently; the encryption password only lives in the session.
  const config = () => {
    let stored = {};
    try { stored = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { /* use defaults */ }
    if ('password' in stored) {
      delete stored.password;
      localStorage.setItem(CFG_KEY, JSON.stringify(stored));
    }
    return { ...stored, password: sessionStorage.getItem(PW_KEY) || '' };
  };

  const headers = c => ({
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${c.token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  });

  async function fail(res) {
    let msg = '';
    try { msg = (await res.json()).message; } catch { /* no body */ }
    throw new Error(`GitHub ${res.status}${msg ? ': ' + msg : ''}`);
  }

  // Returns the current file ({ sha, content }) or null when it does not exist yet.
  async function getFile(c) {
    const res = await fetch(`${githubUrl(c)}?ref=${encodeURIComponent(c.branch)}`, { headers: headers(c), cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) await fail(res);
    return res.json();
  }

  // The data lives in sessionStorage: it is gone when the tab or browser session closes.
  const data = () => JSON.parse(sessionStorage.getItem(KEY) || '[]');

  async function push(c) {
    if (!c.password) throw new Error('Set an encryption password on the Config page: data is only sent to GitHub encrypted.');
    if (sessionStorage.getItem(KEY) === null) throw new Error('No data is loaded in this session.');
    const existing = await getFile(c);
    const text = await Savings.encryptText(JSON.stringify(data(), null, 2), c.password);
    const body = { message: `Update savings data ${new Date().toISOString()}`, content: encodeContent(text), branch: c.branch };
    if (existing) body.sha = existing.sha;
    const res = await fetch(githubUrl(c), { method: 'PUT', headers: { ...headers(c), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) await fail(res);
    sessionStorage.setItem(SYNCED_KEY, '1');
  }

  // Pages without a #syncStatus element get a small floating one, so new pages work without extra markup.
  const statusEl = () => {
    let el = document.getElementById('syncStatus');
    if (!el && document.body) {
      el = document.createElement('div');
      el.id = 'syncStatus';
      el.style.cssText = 'position:fixed;top:8px;right:8px;z-index:10;padding:6px 10px;border-radius:6px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25);font-size:12px';
      document.body.append(el);
    }
    return el;
  };

  const show = (text, ok) => {
    const el = statusEl();
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? '#1a7a35' : '#b00020';
  };

  let timer = null;
  let running = false;
  let again = false;

  // Shows a password box in the status area and resolves once the password is typed.
  let passwordPromise = null;
  function askPassword() {
    if (passwordPromise) return passwordPromise;
    passwordPromise = new Promise(resolve => {
      const el = statusEl();
      if (!el) return; // nowhere to ask; stays pending
      const form = document.createElement('form');
      const input = document.createElement('input');
      const button = document.createElement('button');
      input.type = 'password';
      input.placeholder = 'Encryption password';
      input.autocomplete = 'off';
      input.style.cssText = 'padding:4px 6px;margin-right:6px';
      button.textContent = 'Unlock';
      button.style.cssText = 'padding:4px 8px';
      form.append(input, button);
      form.addEventListener('submit', ev => {
        ev.preventDefault();
        if (!input.value) return;
        sessionStorage.setItem(PW_KEY, input.value);
        form.remove();
        passwordPromise = null;
        resolve();
      });
      el.textContent = '';
      el.append(form);
    });
    return passwordPromise;
  }

  // Reads and decrypts the file from GitHub; [] when it does not exist yet.
  async function fetchRemote(c) {
    const file = await getFile(c);
    if (!file || !file.content) return [];
    let text = Savings.decodeContent(file.content);
    if (Savings.isEncrypted(text)) text = await Savings.decryptText(text, c.password);
    const remote = JSON.parse(text);
    if (!Savings.isValidBackup(remote)) throw new Error('The file in GitHub is not valid savings data.');
    return remote;
  }

  // First auto-save from this session: never overwrite GitHub months this session does not have.
  async function checkBeforeFirstPush(c) {
    const remote = await fetchRemote(c);
    const local = new Set(data().map(e => e.month));
    if (remote.some(e => !local.has(e.month))) {
      throw new Error('GitHub has data this session does not have: reload the page or load it on the Config page');
    }
  }

  async function flush() {
    if (running) { again = true; return; }
    const c = config();
    running = true;
    show('Saving to GitHub...', true);
    try {
      if (sessionStorage.getItem(SYNCED_KEY) !== '1') await checkBeforeFirstPush(c);
      await push(c);
      show('Saved to GitHub', true);
    } catch (err) {
      show(`GitHub save failed: ${err.message}`, false);
    } finally {
      running = false;
      if (again) { again = false; flush(); }
    }
  }

  // Call after every change to the data; pushes shortly after the last change.
  function schedule() {
    const c = config();
    if (!c.autoSync || !isValidGithubConfig(c)) return;
    if (!c.password) {
      askPassword().then(schedule);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => { timer = null; flush(); }, DELAY_MS);
  }

  // Runs once per page: moves old permanent data into the session, or loads the session data from GitHub.
  let readyPromise = null;
  const ready = () => readyPromise || (readyPromise = init());

  async function init() {
    const unsent = sessionStorage.getItem(UNSENT_KEY) !== null;
    sessionStorage.removeItem(UNSENT_KEY);
    const old = localStorage.getItem(KEY);
    let migrated = unsent;
    if (old !== null) {
      if (sessionStorage.getItem(KEY) === null) { sessionStorage.setItem(KEY, old); migrated = true; }
      localStorage.removeItem(KEY);
      localStorage.removeItem(SYNCED_KEY);
    }
    if (sessionStorage.getItem(KEY) !== null) {
      if (migrated) schedule();
      return;
    }
    const c = config();
    if (!isValidGithubConfig(c)) {
      show('Not connected to GitHub: data is lost when this tab closes', false);
      return;
    }
    if (!c.password) await askPassword();
    show('Loading from GitHub...', true);
    try {
      const remote = await fetchRemote(config());
      sessionStorage.setItem(KEY, JSON.stringify(remote));
      sessionStorage.setItem(SYNCED_KEY, '1');
      show(`Loaded ${remote.length} month(s) from GitHub`, true);
    } catch (err) {
      show(`GitHub load failed: ${err.message}`, false);
    }
  }

  // The session survives moving between the app's pages; a reload or a long gap ends it (see the expiry check below).
  document.addEventListener('click', ev => {
    const a = ev.target.closest && ev.target.closest('a[href]');
    if (!a || a.target === '_blank' || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const url = new URL(a.href, location.href);
    if (url.protocol !== location.protocol || url.host !== location.host) return;
    sessionStorage.setItem(NAV_KEY, '1');
    setTimeout(() => sessionStorage.removeItem(NAV_KEY), 2000);
  });
  // Changes still waiting to be sent survive the end of a session.
  addEventListener('pagehide', () => { if (timer || running) sessionStorage.setItem(UNSENT_KEY, '1'); });
  addEventListener('pageshow', ev => { if (ev.persisted) location.reload(); });

  // Runs as soon as this script loads, before any page reads the settings or the password.
  // A session only continues when the page was opened by a link inside the app (or browser back right away);
  // any other load, such as a reload or a page restored after restarting the window, ends it:
  // the password goes, and so does the data unless changes are still unsent.
  const ALIVE_KEY = 'lastAlive';
  const AWAY_MS = 2500;
  const SHORT_HIDE_MS = 2000;
  (() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const away = Date.now() - Number(sessionStorage.getItem(ALIVE_KEY) || Date.now());
    const internal = !!sessionStorage.getItem(NAV_KEY);
    const back = !!nav && nav.type === 'back_forward' && away <= AWAY_MS;
    sessionStorage.removeItem(NAV_KEY);

    if (!internal && !back) {
      sessionStorage.removeItem(PW_KEY);
      if (sessionStorage.getItem(UNSENT_KEY) === null) {
        sessionStorage.removeItem(KEY);
        sessionStorage.removeItem(SYNCED_KEY);
      }
    }
    // Reload Window in VS Code hides and re-shows the page within a moment without reloading it.
    let hiddenAt = 0;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (!hiddenAt || Date.now() - hiddenAt > SHORT_HIDE_MS) return;
      sessionStorage.removeItem(PW_KEY);
      if (!timer && !running) {
        sessionStorage.removeItem(KEY);
        sessionStorage.removeItem(SYNCED_KEY);
      }
      location.reload();
    });

    const stamp = () => sessionStorage.setItem(ALIVE_KEY, String(Date.now()));
    stamp();
    setInterval(stamp, 1000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') stamp(); });
    addEventListener('pagehide', stamp);
  })();

  return { config, getFile, push, schedule, ready, SYNCED_KEY, CFG_KEY, PW_KEY };
})();

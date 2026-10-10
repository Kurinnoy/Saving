const GitSync = (() => {
  const KEY = 'familySavings';
  const CFG_KEY = 'githubConfig';
  const SYNCED_KEY = 'githubSynced';
  const DELAY_MS = 1500;
  const { isValidGithubConfig, githubUrl, encodeContent } = Savings;

  const config = () => {
    try { return JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch { return {}; }
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

  const show = (text, ok) => {
    const el = document.getElementById('syncStatus');
    if (!el) return;
    el.textContent = text;
    el.style.color = ok ? '#1a7a35' : '#b00020';
  };

  let timer = null;
  let running = false;
  let again = false;

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
      show('Auto-save is waiting: set an encryption password on the Config page', false);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(flush, DELAY_MS);
  }

  // Runs once per page: moves old permanent data into the session, or loads the session data from GitHub.
  let readyPromise = null;
  const ready = () => readyPromise || (readyPromise = init());

  async function init() {
    const old = localStorage.getItem(KEY);
    let migrated = false;
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
    if (!isValidGithubConfig(c) || !c.password) {
      show('Not connected to GitHub: data is lost when this tab closes', false);
      return;
    }
    show('Loading from GitHub...', true);
    try {
      const remote = await fetchRemote(c);
      sessionStorage.setItem(KEY, JSON.stringify(remote));
      sessionStorage.setItem(SYNCED_KEY, '1');
      show(`Loaded ${remote.length} month(s) from GitHub`, true);
    } catch (err) {
      show(`GitHub load failed: ${err.message}`, false);
    }
  }

  return { config, getFile, push, schedule, ready, SYNCED_KEY, CFG_KEY };
})();

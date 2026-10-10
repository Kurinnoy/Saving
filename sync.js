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

  async function push(c) {
    if (!c.password) throw new Error('Set an encryption password on the Config page: data is only sent to GitHub encrypted.');
    const existing = await getFile(c);
    const text = await Savings.encryptText(JSON.stringify(JSON.parse(localStorage.getItem(KEY) || '[]'), null, 2), c.password);
    const body = { message: `Update savings data ${new Date().toISOString()}`, content: encodeContent(text), branch: c.branch };
    if (existing) body.sha = existing.sha;
    const res = await fetch(githubUrl(c), { method: 'PUT', headers: { ...headers(c), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) await fail(res);
    localStorage.setItem(SYNCED_KEY, '1');
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

  async function flush() {
    if (running) { again = true; return; }
    const c = config();
    running = true;
    show('Saving to GitHub...', true);
    try {
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
    // A browser that never loaded or saved this repository must not overwrite it.
    if (localStorage.getItem(SYNCED_KEY) !== '1') {
      show('Auto-save is waiting: load or save data on the Config page first', false);
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(flush, DELAY_MS);
  }

  return { config, getFile, push, schedule, SYNCED_KEY, CFG_KEY };
})();

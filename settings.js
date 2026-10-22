// Defaults for new salary lines, kept permanently in this browser and edited on the Config page.
const AppSettings = (() => {
  const KEY = 'savingsDefaults';

  const load = () => {
    let raw = {};
    const stored = sessionStorage.getItem(KEY) || localStorage.getItem(KEY);
    try { raw = JSON.parse(stored || '{}'); } catch { /* use built-in defaults */ }
    let settings = Savings.normalizeSettings(raw);
    if (!raw || raw.visibilityVersion !== 1) {
      settings = {
        ...settings,
        defaultRows: settings.defaultRows.map(row => ({ ...row, showInSalary: false, showInHistory: false, includeInTotal: false })),
        otherDefaults: settings.otherDefaults.map(row => ({ ...row, showInSalary: false, showInHistory: false, includeInTotal: false }))
      };
    }
    const normalized = JSON.stringify(settings);
    sessionStorage.setItem(KEY, normalized);
    localStorage.setItem(KEY, normalized);
    return settings;
  };

  const save = values => {
    const settings = Savings.normalizeSettings(values);
    const normalized = JSON.stringify(settings);
    sessionStorage.setItem(KEY, normalized);
    localStorage.setItem(KEY, normalized);
    GitSync.schedule();
    return settings;
  };

  const reset = () => {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  };

  return { load, save, reset };
})();

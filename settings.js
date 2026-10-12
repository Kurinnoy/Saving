// Defaults for new salary lines, kept permanently in this browser and edited on the Config page.
const AppSettings = (() => {
  const KEY = 'savingsDefaults';

  const load = () => {
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* use built-in defaults */ }
    return Savings.normalizeSettings(raw);
  };

  const save = values => {
    const settings = Savings.normalizeSettings(values);
    localStorage.setItem(KEY, JSON.stringify(settings));
    return settings;
  };

  const reset = () => localStorage.removeItem(KEY);

  return { load, save, reset };
})();

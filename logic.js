const Savings = (() => {
  const FIELDS = ['me', 'wife', 'son', 'tenth'];

  const fmt = n => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const sum = e => FIELDS.reduce((s, f) => s + e[f], 0);

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Income and spending are child entries of a month; older data has none.
  const KINDS = ['incomes', 'spendings'];
  const itemsOf = (e, kind) => e[kind] || [];
  const spendingsOf = e => itemsOf(e, 'spendings');
  const incomesOf = e => itemsOf(e, 'incomes');

  const sumItems = (e, kind, who) => itemsOf(e, kind)
    .filter(s => !who || s.who === who)
    .reduce((s, x) => s + x.amount, 0);
  const spentOf = (e, who) => sumItems(e, 'spendings', who);
  // Income = typed income lines + the per-person amounts of the month's My salary details.
  const salaryIncomeOf = (e, who) => {
    if (!(salaryOf(e) > 0 || e.allocation)) return 0;
    const alloc = allocationOf(e);
    return who ? alloc[who] || 0 : PEOPLE.reduce((s, f) => s + alloc[f], 0);
  };
  const incomeOf = (e, who) => sumItems(e, 'incomes', who) + salaryIncomeOf(e, who);

  const itemTotals = (data, kind) => {
    const amount = (e, f) => kind === 'incomes' ? incomeOf(e, f) : sumItems(e, kind, f);
    const t = Object.fromEntries(FIELDS.map(f => [f, data.reduce((s, e) => s + amount(e, f), 0)]));
    t.all = FIELDS.reduce((s, f) => s + t[f], 0);
    return t;
  };
  const spentTotals = data => itemTotals(data, 'spendings');
  const incomeTotals = data => itemTotals(data, 'incomes');

  // Left = saved + income - spent.
  const leftOf = (e, who) => (who ? e[who] : sum(e)) + incomeOf(e, who) - spentOf(e, who);

  const totals = data => {
    const t = Object.fromEntries(FIELDS.map(f => [f, data.reduce((s, e) => s + e[f], 0)]));
    t.all = FIELDS.reduce((s, f) => s + t[f], 0);
    return t;
  };

  const sortDesc = data => [...data].sort((a, b) => b.month.localeCompare(a.month));

  // Months are unique, so a copy goes to the next month that is still free.
  const nextFreeMonth = (data, month) => {
    let [y, m] = month.split('-').map(Number);
    let next;
    do {
      m++;
      if (m > 12) { m = 1; y++; }
      next = `${y}-${String(m).padStart(2, '0')}`;
    } while (data.some(x => x.month === next));
    return next;
  };

  const copyEntry = (data, month) => {
    const e = data.find(x => x.month === month);
    if (!e) return data;
    const { spendings, incomes, ...saved } = e;
    return [...data, { ...saved, month: nextFreeMonth(data, month) }];
  };

  // Saving a month again keeps its income and spending lines.
  const upsert = (data, entry) => {
    const old = data.find(e => e.month === entry.month) || {};
    const merged = { ...entry };
    KINDS.forEach(k => { if (old[k]) merged[k] = old[k]; });
    if (old.monthlyPay) merged.monthlyPay = old.monthlyPay;
    if (old.allocation) merged.allocation = old.allocation;
    if (old.monthlySaving !== undefined) merged.monthlySaving = old.monthlySaving;
    if (old.monthlyInvestment !== undefined) merged.monthlyInvestment = old.monthlyInvestment;
    return [...data.filter(e => e.month !== entry.month), merged];
  };

  const remove = (data, month) => data.filter(e => e.month !== month);

  // 10% is calculated from the net salary when a month is saved; the other amounts are typed in.
  const PEOPLE = FIELDS.filter(f => f !== 'tenth');

  const parseEntry = (month, values) => {
    const entry = { month, salary: Math.max(0, parseFloat(values.salary) || 0) };
    PEOPLE.forEach(f => entry[f] = Math.max(0, parseFloat(values[f]) || 0));
    entry.tenth = tenthFromSalary(entry.salary);
    return entry;
  };

  // Salary is shown for reference only and is not part of the saved total.
  const salaryOf = e => e.salary || 0;
  const salaryTotal = data => data.reduce((s, e) => s + salaryOf(e), 0);

  const TAX_RATE = 0.05;
  const TENTH_RATE = 0.1;
  const round2 = n => Math.round(n * 100) / 100;
  const netFromSalary = salary => round2(salary * (1 - TAX_RATE));
  const tenthFromSalary = salary => round2(netFromSalary(salary) * TENTH_RATE);

  // 10% is never typed in: every month gets it recalculated from its salary.
  const withTenth = data => data.map(e => ({ ...e, tenth: tenthFromSalary(salaryOf(e)) }));
  const netSalaryOf = e => netFromSalary(salaryOf(e));
  const netSalaryTotal = data => round2(data.reduce((s, e) => s + netSalaryOf(e), 0));

  // Net salary after the 10% has been taken out.
  const afterTenthOf = e => round2(netSalaryOf(e) - (e.tenth || 0));
  const afterTenthTotal = data => round2(data.reduce((s, e) => s + afterTenthOf(e), 0));

  // Sets only the salary of a month; a month that does not exist yet is created with zero savings.
  // A new salary line (no salary before) also gets the given default settings as its own details.
  const setSalary = (data, month, salary, settings) => {
    const value = Math.max(0, parseFloat(salary) || 0);
    const existing = data.find(e => e.month === month);
    const isNewLine = !existing || !(salaryOf(existing) > 0);
    const defaults = settings && isNewLine && value > 0
      ? { monthlySaving: settings.monthlySaving, monthlyInvestment: settings.monthlyInvestment, allocation: { ...settings.allocation }, monthlyPay: [...settings.monthlyPay] }
      : {};
    if (!existing) {
      return [...data, { month, salary: value, me: 0, wife: 0, son: 0, tenth: tenthFromSalary(value), ...defaults }];
    }
    return data.map(e => e.month === month ? { ...defaults, ...e, salary: value, tenth: tenthFromSalary(value) } : e);
  };

  // Fixed monthly pay in UAH, converted to USD with the rate of the month's last day (or today for the current month).
  const MONTHLY_PAY_UAH = [13500, 5500, 600];
  const MONTHLY_PAY_LABELS = ['Monthly lease payment', 'Monthly utility bills', 'Internet fee'];
  const pad2 = n => String(n).padStart(2, '0');
  const rateDate = (month, today = new Date()) => {
    const [y, m] = month.split('-').map(Number);
    const end = `${month}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
    const now = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    return (end < now ? end : now).replace(/-/g, '');
  };
  const prevDate = d => {
    const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) - 1));
    return `${t.getUTCFullYear()}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCDate())}`;
  };
  const uahToUsd = (uah, rate) => round2(uah / rate);

  // A new salary line spends this many UAH from the 10% money, once per month.
  const TENTH_SPEND_UAH = 10000;
  const TENTH_SPEND_ID = 'tenth-uah';
  const addTenthSpending = (data, month, rate, uah = TENTH_SPEND_UAH) => {
    const e = data.find(x => x.month === month);
    if (!e || !(rate > 0) || !(uah > 0) || spendingsOf(e).some(s => s.id === TENTH_SPEND_ID)) return data;
    const item = { id: TENTH_SPEND_ID, who: 'tenth', note: `${uah.toLocaleString('en-US')} UAH`, amount: uahToUsd(uah, rate) };
    return addItem(data, month, 'spendings', item);
  };
  // Months saved with fewer amounts than today's list keep their own and take the default for the new ones.
  const payOf = e => MONTHLY_PAY_UAH.map((d, i) => (e.monthlyPay && e.monthlyPay[i] !== undefined ? e.monthlyPay[i] : d));

  // Monthly saving in USD; every month starts from the default.
  const MONTHLY_SAVING_DEFAULT = 1000;
  const savingOf = e => e.monthlySaving ?? MONTHLY_SAVING_DEFAULT;
  const setMonthlySaving = (data, month, amount) =>
    data.map(e => e.month === month ? { ...e, monthlySaving: Math.max(0, parseFloat(amount) || 0) } : e);

  // Monthly investment in USD; every month starts from the default.
  const MONTHLY_INVESTMENT_DEFAULT = 500;
  const investmentOf = e => e.monthlyInvestment ?? MONTHLY_INVESTMENT_DEFAULT;
  const setMonthlyInvestment = (data, month, amount) =>
    data.map(e => e.month === month ? { ...e, monthlyInvestment: Math.max(0, parseFloat(amount) || 0) } : e);

  // Amounts set aside for each person in a month; every month starts from these defaults.
  const ALLOCATION_DEFAULT = { me: 275, wife: 275, son: 100 };
  const allocationOf = e => ({ ...ALLOCATION_DEFAULT, ...(e.allocation || {}) });
  const setAllocation = (data, month, values) =>
    data.map(e => e.month === month
      ? { ...e, allocation: Object.fromEntries(PEOPLE.map(f => [f, Math.max(0, parseFloat(values[f]) || 0)])) }
      : e);
  const setMonthlyPay = (data, month, amounts) =>
    data.map(e => e.month === month ? { ...e, monthlyPay: amounts.map(v => Math.max(0, parseFloat(v) || 0)) } : e);

  // Defaults for new salary lines, editable on the Config page; the built-in values are the fallback.
  const DEFAULT_SETTINGS = { monthlySaving: MONTHLY_SAVING_DEFAULT, monthlyInvestment: MONTHLY_INVESTMENT_DEFAULT, allocation: ALLOCATION_DEFAULT, monthlyPay: MONTHLY_PAY_UAH, tenthSpendUah: TENTH_SPEND_UAH };
  const nonNegative = (v, fallback) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? n : fallback; };
  const normalizeSettings = (raw) => {
    const s = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;
    return {
      monthlySaving: nonNegative(s.monthlySaving, d.monthlySaving),
      monthlyInvestment: nonNegative(s.monthlyInvestment, d.monthlyInvestment),
      allocation: Object.fromEntries(PEOPLE.map(f => [f, nonNegative(s.allocation && s.allocation[f], d.allocation[f])])),
      monthlyPay: d.monthlyPay.map((v, i) => nonNegative(s.monthlyPay && s.monthlyPay[i], v)),
      tenthSpendUah: nonNegative(s.tenthSpendUah, d.tenthSpendUah)
    };
  };

  // Salary left after everything in the details: 5%, 10%, per-person amounts and monthly pay (UAH at the month's rate).
  const salaryLeftOf = (e, rate) => {
    if (!(rate > 0)) return null;
    const salary = salaryOf(e);
    const alloc = allocationOf(e);
    const spent = (salary - netSalaryOf(e)) + tenthFromSalary(salary) + savingOf(e) + investmentOf(e)
      + PEOPLE.reduce((s, f) => s + alloc[f], 0)
      + payOf(e).reduce((s, uah) => s + uahToUsd(uah, rate), 0);
    return round2(salary - spent);
  };

  // GitHub contents API helpers for saving the data file in a repository.
  const GITHUB_FIELDS = ['owner', 'repo', 'branch', 'path', 'token'];
  const isValidGithubConfig = c => !!c
    && GITHUB_FIELDS.every(k => typeof c[k] === 'string' && c[k].trim() !== '')
    && /^[\w.-]+$/.test(c.owner) && /^[\w.-]+$/.test(c.repo)
    && !c.path.startsWith('/') && !c.path.split('/').some(p => p === '' || p === '.' || p === '..');
  const githubUrl = c => `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${c.path.split('/').map(encodeURIComponent).join('/')}`;
  const encodeContent = text => {
    let bin = '';
    new TextEncoder().encode(text).forEach(b => { bin += String.fromCharCode(b); });
    return btoa(bin);
  };
  const decodeContent = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), ch => ch.charCodeAt(0)));

  // Optional password encryption of the data file: PBKDF2 key + AES-GCM.
  const ENCRYPTED_FORMAT = 'savings-encrypted-v1';
  const bytesToB64 = bytes => { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
  const b64ToBytes = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));
  const deriveKey = async (password, salt) => {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base,
      { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  };
  const encryptText = async (text, password) => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(text));
    return JSON.stringify({ format: ENCRYPTED_FORMAT, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(new Uint8Array(data)) }, null, 2);
  };
  const isEncrypted = text => {
    try { return JSON.parse(text).format === ENCRYPTED_FORMAT; } catch { return false; }
  };
  const decryptText = async (fileText, password) => {
    try {
      const o = JSON.parse(fileText);
      const key = await deriveKey(password, b64ToBytes(o.salt));
      const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(o.iv) }, key, b64ToBytes(o.data));
      return new TextDecoder().decode(plain);
    } catch {
      throw new Error('Wrong password or damaged file.');
    }
  };

  const parseItem = ({ who, note, amount }) => {
    const value = parseFloat(amount);
    if (!FIELDS.includes(who) || !(value > 0)) return null;
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), who, note: String(note || '').trim(), amount: value };
  };

  const mapMonth = (data, month, fn) => data.map(e => e.month === month ? fn(e) : e);

  const addItem = (data, month, kind, item) =>
    mapMonth(data, month, e => ({ ...e, [kind]: [...itemsOf(e, kind), item] }));

  const removeItem = (data, month, kind, id) =>
    mapMonth(data, month, e => ({ ...e, [kind]: itemsOf(e, kind).filter(s => s.id !== id) }));

  const toCsv = data => ['Month,Salary,Net salary,10%,After 10%,Me,Wife,Son,Total,Income,Spent,Left',
    ...data.map(e => [e.month, salaryOf(e), netSalaryOf(e), e.tenth, afterTenthOf(e), ...PEOPLE.map(f => e[f]), sum(e), incomeOf(e), spentOf(e), leftOf(e)].join(','))].join('\n');

  const isValidItem = s => s && typeof s.id === 'string' && FIELDS.includes(s.who)
    && typeof s.note === 'string' && Number.isFinite(s.amount);

  const isValidBackup = parsed => Array.isArray(parsed) && parsed.every(e =>
    e && /^\d{4}-\d{2}$/.test(e.month) && FIELDS.every(f => Number.isFinite(e[f]))
    && (e.salary === undefined || Number.isFinite(e.salary))
    && (e.monthlyPay === undefined || (Array.isArray(e.monthlyPay) && e.monthlyPay.every(Number.isFinite)))
    && (e.monthlySaving === undefined || Number.isFinite(e.monthlySaving))
    && (e.monthlyInvestment === undefined || Number.isFinite(e.monthlyInvestment))
    && (e.allocation === undefined || (e.allocation && PEOPLE.every(f => Number.isFinite(e.allocation[f]))))
    && KINDS.every(k => e[k] === undefined || (Array.isArray(e[k]) && e[k].every(isValidItem))));

  return {
    FIELDS, PEOPLE, fmt, sum, esc, salaryOf, salaryTotal, netSalaryOf, netSalaryTotal, tenthFromSalary, withTenth, afterTenthOf, afterTenthTotal, spendingsOf, incomesOf, spentOf, incomeOf, leftOf, spentTotals, incomeTotals, totals,
    sortDesc, nextFreeMonth, copyEntry, upsert, remove, parseEntry, setSalary, MONTHLY_PAY_UAH, MONTHLY_PAY_LABELS, payOf, setMonthlyPay, allocationOf, setAllocation, savingOf, setMonthlySaving, investmentOf, setMonthlyInvestment, salaryLeftOf, salaryIncomeOf, isValidGithubConfig, githubUrl, encodeContent, decodeContent, encryptText, decryptText, isEncrypted, rateDate, prevDate, uahToUsd, TENTH_SPEND_UAH, addTenthSpending, DEFAULT_SETTINGS, normalizeSettings, parseItem, addItem, removeItem, toCsv, isValidBackup
  };
})();

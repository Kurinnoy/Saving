const Savings = (() => {
  const FIELDS = ['me', 'wife', 'son', 'tenth'];

  const round2 = n => {
    const rounded = Math.round(n * 100) / 100;
    return rounded === 0 ? 0 : rounded;
  };
  const nonNegativeAmount = value => round2(Math.max(0, parseFloat(value) || 0));
  const fmt = n => round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const resolveAmount = (value, current) => {
    const text = String(value).trim();
    if (!text) return 0;
    const numberPattern = '(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d*)?|\\d+(?:[.,]\\d*)?|[.,]\\d+)';
    const expression = text.match(new RegExp(`^(${numberPattern})\\s*([+*/-])\\s*(${numberPattern})$`));
    const match = expression || text.match(new RegExp(`^([+*/-]?)\\s*(${numberPattern})$`));
    if (!match) return null;
    const numberOf = token => Number(/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(token)
      ? token.replace(/,/g, '') : token.replace(',', '.'));
    const base = expression ? numberOf(expression[1]) : current;
    const operator = expression ? expression[2] : match[1];
    const operand = numberOf(expression ? expression[3] : match[2]);
    const operations = { '+': () => base + operand, '-': () => base - operand, '*': () => base * operand, '/': () => base / operand };
    const result = operator ? operations[operator]() : operand;
    const rounded = round2(result);
    return Number.isFinite(rounded) && result >= 0 ? rounded : null;
  };

  const sum = e => round2(FIELDS.reduce((s, f) => s + e[f], 0));

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Income and spending are child entries of a month; older data has none.
  const KINDS = ['incomes', 'spendings'];
  // Income and spending lines can also belong to the investment or the monthly saving, which are not saved fields.
  const INVESTMENT = 'investment';
  const SAVING = 'saving';
  const OTHER = 'other';
  const EXTRA_WHO = [INVESTMENT, SAVING, OTHER];
  const ITEM_WHO = [...FIELDS, ...EXTRA_WHO];
  // Lines can also belong to a monthly row of Config (other than saving, investment and 10%, which have their own keys).
  const ROW_WHO = /^(default_[\w-]+|monthly_pay_\d+|tenth_spend|rate_[15])$/;
  const familyIds = family => family.map(member => typeof member === 'string' ? member : member.id);
  const itemsOf = (e, kind) => e[kind] || [];
  const spendingsOf = e => itemsOf(e, 'spendings');
  const incomesOf = e => itemsOf(e, 'incomes');

  const sumItems = (e, kind, who) => round2(itemsOf(e, kind)
    .filter(s => who ? s.who === who : !EXTRA_WHO.includes(s.who) && !ROW_WHO.test(s.who))
    .reduce((s, x) => s + x.amount, 0));
  const spentOf = (e, who) => sumItems(e, 'spendings', who);
  // Income = typed income lines + the per-person amounts of the month's My salary details.
  // A person's monthly amount is in their own currency: USD (default), UAH, EUR or % of the salary.
  const memberId = member => typeof member === 'string' ? member : member.id;
  const memberCurrency = member => (member && typeof member === 'object' && member.currency) || 'USD';
  const memberUsd = (e, member, amount) => {
    const currency = memberCurrency(member);
    return currency === 'USD' ? round2(amount) : currency === '%' ? pctOrRaw(e, '%', amount) : fixedDeductionUsd(e, currency, amount);
  };
  // A person marked "New salaries only" keeps the Include and currency the month was created with; a month without that person does not get it.
  const entryMember = (e, member) => {
    if (!member || typeof member !== 'object' || !member.newSalariesOnly || !Array.isArray(e && e.familySetup)) return member;
    const saved = e.familySetup.find(item => item.id === member.id);
    return saved ? { ...member, enabled: saved.enabled !== false, currency: saved.currency || member.currency } : { ...member, enabled: false };
  };
  const entryFamily = (e, family) => family.map(member => entryMember(e, member));
  const salaryIncomeOf = (e, who, family = DEFAULT_FAMILY) => {
    if (!(salaryOf(e) > 0 || e.allocation)) return 0;
    const alloc = allocationOf(e, family);
    const usdOf = id => {
      const member = entryMember(e, family.find(item => memberId(item) === id));
      return member && member.enabled === false ? 0 : memberUsd(e, member, alloc[id] || 0);
    };
    return round2(who ? usdOf(who) : familyIds(family).reduce((s, id) => s + usdOf(id), 0));
  };
  const incomeOf = (e, who, family = DEFAULT_FAMILY) => round2(sumItems(e, 'incomes', who) + salaryIncomeOf(e, who, family));

  const itemTotals = (data, kind) => {
    const amount = (e, f) => kind === 'incomes' ? incomeOf(e, f) : sumItems(e, kind, f);
    const t = Object.fromEntries(FIELDS.map(f => [f, round2(data.reduce((s, e) => s + amount(e, f), 0))]));
    t.all = round2(FIELDS.reduce((s, f) => s + t[f], 0));
    return t;
  };
  const spentTotals = data => itemTotals(data, 'spendings');
  const incomeTotals = data => itemTotals(data, 'incomes');

  // Left = saved + income - spent.
  const leftOf = (e, who, family = DEFAULT_FAMILY) => round2(who === OTHER
    ? incomeOf(e, OTHER, family) - spentOf(e, OTHER)
    : (who ? e[who] || 0 : sum(e)) + incomeOf(e, who, family) - spentOf(e, who));

  const totals = data => {
    const t = Object.fromEntries(FIELDS.map(f => [f, round2(data.reduce((s, e) => s + e[f], 0))]));
    t.all = round2(FIELDS.reduce((s, f) => s + t[f], 0));
    return t;
  };

  const sortDesc = data => [...data].sort((a, b) => b.month.localeCompare(a.month));

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Shows the stored "2026-03" as "Mar 26" for the tables; the saved value stays YYYY-MM.
  const monthLabel = month => {
    const [y, m] = String(month).split('-');
    return `${MONTH_NAMES[Number(m) - 1] || m} ${y.slice(-2)}`;
  };

  // Months are unique, so a copy goes to the next month without a salary line (those are not shown on My salary).
  const nextFreeMonth = (data, month) => {
    let [y, m] = month.split('-').map(Number);
    let next;
    do {
      m++;
      if (m > 12) { m = 1; y++; }
      next = `${y}-${String(m).padStart(2, '0')}`;
    } while (data.some(x => x.month === next && salaryOf(x) > 0));
    return next;
  };

  // When the next month already has a salary line, a copy goes to the previous month if that one is free.
  const shiftMonth = (month, by) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
  };
  const copyTarget = (data, month) => {
    const hasSalary = m => data.some(x => x.month === m && salaryOf(x) > 0);
    const prev = shiftMonth(month, -1);
    return hasSalary(shiftMonth(month, 1)) && !hasSalary(prev) ? prev : nextFreeMonth(data, month);
  };

  const copyEntry = (data, month) => {
    const e = data.find(x => x.month === month);
    if (!e) return data;
    const { spendings, incomes, ...saved } = e;
    const target = copyTarget(data, month);
    const old = data.find(x => x.month === target);
    const copy = { ...saved, month: target };
    if (e.salaryDate) {
      const day = Number(e.salaryDate.slice(-2));
      const [year, monthNumber] = target.split('-').map(Number);
      const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
      copy.salaryDate = `${target}-${String(Math.min(day, lastDay)).padStart(2, '0')}`;
    }
    if (old) KINDS.forEach(k => { if (old[k]) copy[k] = old[k]; });
    return [...data.filter(x => x.month !== target), copy];
  };

  // Saving a month again keeps its income and spending lines.
  const upsert = (data, entry) => {
    const old = data.find(e => e.month === entry.month) || {};
    const merged = { ...entry };
    KINDS.forEach(k => { if (old[k]) merged[k] = old[k]; });
    if (old.monthlyPay) merged.monthlyPay = old.monthlyPay;
    if (old.allocation) merged.allocation = old.allocation;
    if (old.familySetup) merged.familySetup = old.familySetup;
    if (old.monthlySaving !== undefined) merged.monthlySaving = old.monthlySaving;
    if (old.monthlyInvestment !== undefined) merged.monthlyInvestment = old.monthlyInvestment;
    return [...data.filter(e => e.month !== entry.month), merged];
  };

  const remove = (data, month) => data.filter(e => e.month !== month);

  // 10% is calculated from the net salary when a month is saved; the other amounts are typed in.
  const PEOPLE = FIELDS.filter(f => f !== 'tenth');
  const FAMILY_FLAGS = ['showInSalary', 'showInSalaryFooter', 'showInHistory', 'showInHistoryDetails', 'showInDropdown', 'showInBlocks', 'showInFooter', 'includeInTotal'];
  const allFlags = value => Object.fromEntries(FAMILY_FLAGS.map(flag => [flag, value]));
  const DEFAULT_FAMILY = [
    { id: 'me', name: 'Me', enabled: true, monthlyAmount: 275, ...allFlags(true) },
    { id: 'wife', name: 'Wife', enabled: true, monthlyAmount: 275, ...allFlags(true) },
    { id: 'son', name: 'Son', enabled: true, monthlyAmount: 100, ...allFlags(true) }
  ];

  const parseEntry = (month, values) => {
    const entry = { month, salary: nonNegativeAmount(values.salary) };
    PEOPLE.forEach(f => entry[f] = nonNegativeAmount(values[f]));
    entry.tenth = tenthFromSalary(entry.salary);
    return entry;
  };

  // Salary is shown for reference only and is not part of the saved total.
  const salaryOf = e => round2(e.salary || 0);
  const salaryTotal = data => round2(data.reduce((s, e) => s + salaryOf(e), 0));
  // A row set to % is that share of the month's salary, shown in USD.
  const pctOrRaw = (e, currency, amount) => currency === '%' ? round2(salaryOf(e) * amount / 100) : amount;
  const rowBaseValue = (e, row) => {
    if (row.id === OTHER) return round2(sumItems(e, 'incomes', OTHER) - sumItems(e, 'spendings', OTHER));
    if (row.id === 'monthly_saving') return savingLeftOf(e);
    if (row.id === 'monthly_investment') return investmentLeftOf(e);
    if (row.id.startsWith('monthly_pay_')) return pctOrRaw(e, defaultRowCurrency(e, row.id), payOf(e)[Number(row.id.slice(-1))] || 0);
    if (row.id === 'tenth_spend') return pctOrRaw(e, defaultRowCurrency(e, row.id), (e.defaultRows || []).find(item => item.id === row.id)?.amount || 0);
    if (row.id === 'rate_1') return onePercentOf(salaryOf(e), e);
    if (row.id === 'rate_5') return taxOf(salaryOf(e), e);
    if (row.id === 'rate_10') return e.tenth || 0;
    const item = (e.otherDefaults || []).find(entry => entry.id === row.id);
    if (item && item.currency === '%' && item.base === 'net') return round2(afterTenthOf(e) * item.amount / 100);
    return item ? pctOrRaw(e, item.currency, item.amount) : 0;
  };
  // Like Monthly saving: the row's amount plus its income lines minus its spending lines.
  const defaultRowValue = (e, row) => rowBaseValue(e, row)
    + (ROW_WHO.test(row.id) ? sumItems(e, 'incomes', row.id) - sumItems(e, 'spendings', row.id) : 0);

  const rowAmount = (e, id, fallback) => {
    if (!e || !Array.isArray(e.defaultRows)) return fallback;
    const row = e.defaultRows.find(item => item.id === id);
    return row && row.enabled ? round2(row.amount) : 0;
  };
  const rowEnabled = (e, id) => !Array.isArray(e && e.defaultRows) || !!e.defaultRows.find(item => item.id === id && item.enabled);
  // A % row takes its amount from the whole salary or from what is left after the % rows above it.
  const RATE_BASES = ['salary', 'net'];
  // Pages hand in the exchange rates they know, so a deduction set to UAH or EUR can be converted.
  let rateLookup = () => undefined;
  const setRateLookup = lookup => { rateLookup = lookup; };
  const fixedDeductionUsd = (e, currency, amount) => {
    const usd = currencyToUsd(amount, currency, rateLookup(e && e.month, 'USD'), { [currency]: rateLookup(e && e.month, currency) });
    return Number.isFinite(usd) ? usd : 0;
  };
  const ratesOf = (salary, e) => {
    const rows = e && Array.isArray(e.defaultRows) ? e.defaultRows : DEFAULT_ROWS;
    let remaining = salary;
    const amounts = {};
    rows.filter(row => row.id.startsWith('rate_')).forEach(row => {
      const fallback = DEFAULT_ROWS.find(item => item.id === row.id);
      const percent = rowAmount(e, row.id, fallback ? fallback.amount : 0);
      const base = RATE_BASES.includes(row.base) ? row.base : fallback && fallback.base;
      amounts[row.id] = (row.currency || '%') === '%'
        ? round2((base === 'net' ? remaining : salary) * percent / 100)
        : fixedDeductionUsd(e, row.currency, percent);
      remaining = round2(remaining - amounts[row.id]);
    });
    return amounts;
  };
  const taxOf = (salary, e) => ratesOf(salary, e).rate_5 || 0;
  const onePercentOf = (salary, e) => ratesOf(salary, e).rate_1 || 0;
  const netFromSalary = (salary, e) => round2(salary - taxOf(salary, e) - onePercentOf(salary, e));
  const tenthFromSalary = (salary, e) => ratesOf(salary, e).rate_10 || 0;

  // 10% is never typed in: every month gets it recalculated from its salary.
  const withTenth = data => data.map(e => ({ ...e, tenth: tenthFromSalary(salaryOf(e), e) }));
  const netSalaryOf = e => netFromSalary(salaryOf(e), e);
  const netSalaryTotal = data => round2(data.reduce((s, e) => s + netSalaryOf(e), 0));
  // Rows ticked "Net salary" in Config reduce Net salary (the 1%, 5% and 10% rows by default).
  const netRowsOf = e => [...(Array.isArray(e.defaultRows) ? e.defaultRows : DEFAULT_ROWS), ...(e.otherDefaults || [])]
    .filter(row => row.enabled !== false && (typeof row.inNetSalary === 'boolean' ? row.inNetSalary : DEFAULT_ROWS.find(item => item.id === row.id)?.inNetSalary === true));
  // Salary minus those rows in USD; null while an exchange rate they need is missing.
  const netAfterRatesOf = (e, rate, foreignRates = {}) => {
    const salary = salaryOf(e);
    const rates = ratesOf(salary, e);
    const usdOf = row => {
      if (row.id.startsWith('rate_')) return rates[row.id] || 0;
      const raw = row.id === 'monthly_saving' ? savingOf(e) : row.id === 'monthly_investment' ? investmentOf(e)
        : row.id.startsWith('monthly_pay_') ? payOf(e)[Number(row.id.slice(-1))] : row.id === OTHER ? 0 : row.amount;
      const base = row.base === 'net' ? afterTenthOf(e) : salary;
      return currencyToUsd(raw || 0, row.currency || 'USD', rate, foreignRates, base);
    };
    const amounts = netRowsOf(e).map(usdOf);
    return amounts.some(amount => amount === null) ? null : round2(salary - amounts.reduce((s, amount) => s + amount, 0));
  };

  // Net salary after the 10% has been taken out.
  const afterTenthOf = e => round2(netSalaryOf(e) - (e.tenth || 0));
  const afterTenthTotal = data => round2(data.reduce((s, e) => s + afterTenthOf(e), 0));

  // Sets only the salary of a month; a month that does not exist yet is created with zero savings.
  // A new salary line (no salary before) also gets the given default settings as its own details.
  // Accepts "4 655,81" as well as "4655.81".
  const parseAmount = v => {
    let s = String(v ?? '').replace(/[\s\u00a0]/g, '');
    s = s.includes(',') && s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.');
    return round2(parseFloat(s));
  };

  const parseCsvRows = text => {
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (char === '"') quoted = false;
        else field += char;
      } else if (char === '"' && field === '') quoted = true;
      else if (char === ',') { row.push(field); field = ''; }
      else if (char === '\n' || char === '\r') {
        row.push(field);
        if (row.some(value => value.trim() !== '')) rows.push(row);
        row = [];
        field = '';
        if (char === '\r' && text[i + 1] === '\n') i++;
      } else field += char;
    }
    if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
    row.push(field);
    if (row.some(value => value.trim() !== '')) rows.push(row);
    return rows;
  };

  const parseSalaryCsv = text => {
    const rows = parseCsvRows(String(text).replace(/^\uFEFF/, ''));
    if (!rows.length) throw new Error('The CSV is empty.');
    const header = rows[0].map(value => value.trim().toLowerCase());
    const dateIndex = header.findIndex(value => value === 'date' || value === 'month');
    const salaryIndex = header.findIndex(value => value === 'salary');
    const hasHeader = dateIndex >= 0 && salaryIndex >= 0;
    const columns = hasHeader ? [dateIndex, salaryIndex] : [0, 1];
    const values = hasHeader ? rows.slice(1) : rows;
    const seen = new Set();
    if (!values.length) throw new Error('The CSV has no salary rows.');
    return values.map((values, index) => {
      if (values.length !== 2) throw new Error(`CSV row ${index + (hasHeader ? 2 : 1)} must have exactly two columns.`);
      const date = values[columns[0]].trim();
      let match = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/.exec(date)
        || /^(\d{4})\/(\d{1,2})$/.exec(date);
      if (!match) {
        const monthYear = /^(\d{1,2})[./-](\d{4})$/.exec(date);
        if (monthYear) match = [date, monthYear[2], monthYear[1], undefined];
      }
      const year = match && Number(match[1]);
      const monthNumber = match && Number(match[2]);
      const day = match && match[3] === undefined ? undefined : Number(match && match[3]);
      const validDay = day === undefined || (day >= 1 && day <= new Date(Date.UTC(year, monthNumber, 0)).getUTCDate());
      const month = match && monthNumber >= 1 && monthNumber <= 12 && validDay
        ? `${year}-${String(monthNumber).padStart(2, '0')}`
        : '';
      const salaryDate = month && day !== undefined ? `${month}-${String(day).padStart(2, '0')}` : undefined;
      const salary = parseAmount(values[columns[1]]);
      if (!month) throw new Error(`CSV row ${index + (hasHeader ? 2 : 1)} has an invalid date.`);
      if (!Number.isFinite(salary) || salary < 0) throw new Error(`CSV row ${index + (hasHeader ? 2 : 1)} has an invalid salary.`);
      if (seen.has(month)) throw new Error(`The CSV contains more than one salary for ${month}.`);
      seen.add(month);
      return { month, salary, ...(salaryDate ? { salaryDate } : {}) };
    });
  };

  const toSalaryCsv = data => [
    'Date,Salary',
    ...[...data].filter(e => salaryOf(e) > 0).sort((a, b) => b.month.localeCompare(a.month))
      .map(e => `${salaryDateOf(e)},${salaryOf(e).toFixed(2)}`)
  ].join('\r\n');

  const setSalary = (data, month, salary, settings, salaryDate) => {
    const value = Math.max(0, parseAmount(salary) || 0);
    const existing = data.find(e => e.month === month);
    const isNewLine = !existing || !(salaryOf(existing) > 0);
    const legacyRows = DEFAULT_ROWS.map(row => ({ ...row, showInSalary: true }));
    const defaults = settings && isNewLine && value > 0
      ? { monthlySaving: settings.monthlySaving, monthlyInvestment: settings.monthlyInvestment, allocation: { ...settings.allocation }, familySetup: (settings.family || []).map(person => ({ id: person.id, enabled: person.enabled !== false, currency: person.currency || 'USD' })), monthlyPay: [...settings.monthlyPay], defaultRows: (settings.defaultRows || legacyRows).map(row => ({ ...row })), otherDefaults: (settings.otherDefaults || []).map(item => ({ ...item })) }
      : {};
    if (!existing) {
      const entry = { month, salary: value, me: 0, wife: 0, son: 0, ...defaults, ...(salaryDate ? { salaryDate } : {}) };
      entry.tenth = tenthFromSalary(value, entry);
      return [...data, entry];
    }
    return data.map(e => {
      if (e.month !== month) return e;
      const updated = { ...defaults, ...e, salary: value, ...(salaryDate ? { salaryDate } : {}) };
      updated.tenth = tenthFromSalary(value, updated);
      return updated;
    });
  };

  // Fixed monthly pay in UAH, converted to USD with the rate of the month's last day (or today for the current month).
  const MONTHLY_PAY_UAH = [0, 0, 0, 0, 0];
  const MONTHLY_PAY_LABELS = ['Monthly lease payment', 'Monthly utility bills', 'Internet fee', 'Monthly expenses', 'ESF'];
  const pad2 = n => String(n).padStart(2, '0');
  const rateDate = (month, today = new Date()) => {
    const [y, m] = month.split('-').map(Number);
    const end = `${month}-${pad2(new Date(Date.UTC(y, m, 0)).getUTCDate())}`;
    const now = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`;
    return (end < now ? end : now).replace(/-/g, '');
  };
  const salaryDateOf = e => e.salaryDate || `${rateDate(e.month).slice(0, 4)}-${rateDate(e.month).slice(4, 6)}-${rateDate(e.month).slice(6, 8)}`;
  const prevDate = d => {
    const t = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8) - 1));
    return `${t.getUTCFullYear()}${pad2(t.getUTCMonth() + 1)}${pad2(t.getUTCDate())}`;
  };
  const uahToUsd = (uah, rate) => round2(uah / rate);
  const CURRENCIES = ['USD', 'UAH', 'EUR', '%'];
  const currencyToUsd = (amount, currency, usdRate, foreignRates = {}, percentBase = 0) => {
    if (currency === 'USD') return round2(amount);
    if (currency === 'UAH') return uahToUsd(amount, usdRate);
    if (currency === '%') return round2(percentBase * amount / 100);
    const rate = foreignRates[currency];
    return rate > 0 && usdRate > 0 ? round2(amount * rate / usdRate) : null;
  };

  // A new salary line spends this many UAH from the 10% money, once per month.
  const TENTH_SPEND_UAH = 0;
  const TENTH_SPEND_ID = 'tenth-uah';
  const addTenthSpending = (data, month, rate, amount = TENTH_SPEND_UAH, currency = 'UAH', foreignRates = {}) => {
    const e = data.find(x => x.month === month);
    if (!e || !(rate > 0) || !(amount > 0) || spendingsOf(e).some(s => s.id === TENTH_SPEND_ID)) return data;
    const usdAmount = currencyToUsd(amount, currency, rate, foreignRates, salaryOf(e));
    if (usdAmount === null) return data;
    const item = { id: TENTH_SPEND_ID, who: 'tenth', note: `${amount.toLocaleString('en-US')} ${currency}`, amount: usdAmount };
    return addItem(data, month, 'spendings', item);
  };
  // Months saved with fewer amounts than today's list keep their own and take the default for the new ones.
  const payOf = e => MONTHLY_PAY_UAH.map((d, i) => {
    const id = `monthly_pay_${i}`;
    if (!rowEnabled(e, id)) return 0;
    const configured = rowAmount(e, id, d);
    return round2(e.monthlyPay && e.monthlyPay[i] !== undefined ? e.monthlyPay[i] : configured);
  });

  // Monthly saving in USD; every month starts from the default.
  const MONTHLY_SAVING_DEFAULT = 0;
  const savingOf = e => rowEnabled(e, 'monthly_saving') ? round2(e.monthlySaving ?? rowAmount(e, 'monthly_saving', MONTHLY_SAVING_DEFAULT)) : 0;
  // Monthly saving of a month with a salary, plus its saving income, minus its saving spending.
  const savingLeftOf = e => round2((salaryOf(e) > 0 ? pctOrRaw(e, defaultRowCurrency(e, 'monthly_saving'), savingOf(e)) : 0) + sumItems(e, 'incomes', SAVING) - sumItems(e, 'spendings', SAVING));
  const setMonthlySaving = (data, month, amount) =>
    data.map(e => e.month === month ? { ...e, monthlySaving: nonNegativeAmount(amount) } : e);

  // Monthly investment in USD; every month starts from the default.
  const MONTHLY_INVESTMENT_DEFAULT = 0;
  const investmentOf = e => rowEnabled(e, 'monthly_investment') ? round2(e.monthlyInvestment ?? rowAmount(e, 'monthly_investment', MONTHLY_INVESTMENT_DEFAULT)) : 0;
  const setMonthlyInvestment = (data, month, amount) =>
    data.map(e => e.month === month ? { ...e, monthlyInvestment: nonNegativeAmount(amount) } : e);
  // Monthly investment of a month with a salary, plus its investment income, minus its investment spending.
  const investmentLeftOf = e => round2((salaryOf(e) > 0 ? pctOrRaw(e, defaultRowCurrency(e, 'monthly_investment'), investmentOf(e)) : 0) + sumItems(e, 'incomes', INVESTMENT) - sumItems(e, 'spendings', INVESTMENT));

  // Amounts set aside for each person in a month; every month starts from these defaults.
  const ALLOCATION_DEFAULT = { me: 275, wife: 275, son: 100 };
  const allocationOf = (e, family = DEFAULT_FAMILY) => Object.fromEntries(family.map(member => {
    const id = typeof member === 'string' ? member : member.id;
    const fallback = ALLOCATION_DEFAULT[id] || 0;
    return [id, round2((e.allocation || {})[id] ?? fallback ?? 0)];
  }));
  const setAllocation = (data, month, values) =>
    data.map(e => e.month === month ? {
      ...e,
      allocation: Object.fromEntries([...Object.entries(e.allocation || {}), ...Object.entries(values).map(([id, value]) => [id, nonNegativeAmount(value)])])
    } : e);
  const setMonthlyPay = (data, month, amounts) =>
    data.map(e => e.month === month ? { ...e, monthlyPay: amounts.map(nonNegativeAmount) } : e);
  const setDefaultRows = (data, month, amounts) =>
    data.map(e => e.month === month ? {
      ...e,
      defaultRows: (e.defaultRows || []).map(row => amounts[row.id] === undefined
        ? row
        : { ...row, amount: nonNegativeAmount(amounts[row.id]) })
    } : e);
  const setOtherDefaults = (data, month, amounts) =>
    data.map(e => e.month === month ? {
      ...e,
      otherDefaults: (e.otherDefaults || []).map(item => amounts[item.id] === undefined
        ? item
        : { ...item, amount: nonNegativeAmount(amounts[item.id]) })
    } : e);

  // Per-row switches: which page parts show a row (columns, Details, top blocks, footer) and whether History Total counts it.
  const rowFlags = (blocks, dropdown, net = false) => ({ showInSalary: false, showInSalaryFooter: true, showInHistory: false, showInHistoryDetails: false, showInDropdown: dropdown, showInBlocks: blocks, showInFooter: true, includeInTotal: false, inNetSalary: net });
  const DEFAULT_ROWS = [
    { id: 'monthly_saving', name: 'Monthly saving', currency: 'USD', amount: MONTHLY_SAVING_DEFAULT, enabled: true, ...rowFlags(true, true) },
    { id: 'monthly_investment', name: 'Monthly investment', currency: 'USD', amount: MONTHLY_INVESTMENT_DEFAULT, enabled: true, ...rowFlags(true, true) },
    ...MONTHLY_PAY_LABELS.map((name, i) => ({ id: `monthly_pay_${i}`, name, currency: 'UAH', amount: MONTHLY_PAY_UAH[i], enabled: true, ...rowFlags(false, false) })),
    { id: 'tenth_spend', name: 'Spending from 10%', currency: 'UAH', amount: TENTH_SPEND_UAH, enabled: true, ...rowFlags(false, false) },
    { id: 'rate_1', name: '1% deduction', currency: '%', base: 'salary', amount: 1, enabled: true, ...rowFlags(false, false, true) },
    { id: 'rate_5', name: '5% deduction', currency: '%', base: 'salary', amount: 5, enabled: true, ...rowFlags(false, false, true) },
    { id: 'rate_10', name: '10% deduction', currency: '%', base: 'net', amount: 10, enabled: true, ...rowFlags(false, true, true) },
    // Income and spending lines for "Other"; kept as it was before it became a row: shown, counted and in the dropdown.
    { id: 'other', name: 'Other', currency: 'USD', amount: 0, enabled: true, ...rowFlags(true, true), showInHistory: true, showInHistoryDetails: true, includeInTotal: true }
  ];
  const defaultRowCurrency = (e, id) => e.defaultRows?.find(row => row.id === id)?.currency
    || DEFAULT_ROWS.find(row => row.id === id)?.currency || 'USD';

  // Defaults for new salary lines, editable on the Config page; the built-in values are the fallback.
  const DEFAULT_SETTINGS = { family: DEFAULT_FAMILY, defaultRows: DEFAULT_ROWS, otherDefaults: [], visibilityVersion: 1, rowsVersion: 2, monthlySaving: MONTHLY_SAVING_DEFAULT, monthlyInvestment: MONTHLY_INVESTMENT_DEFAULT, allocation: ALLOCATION_DEFAULT, monthlyPay: MONTHLY_PAY_UAH, tenthSpendUah: TENTH_SPEND_UAH };
  const nonNegative = (v, fallback) => { const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? round2(n) : fallback; };
  const normalizeSettings = (raw) => {
    const s = raw && typeof raw === 'object' ? raw : {};
    const d = DEFAULT_SETTINGS;
    const seen = new Set();
    const family = Array.isArray(s.family)
      ? s.family.map(member => {
        const id = String(member && member.id || '').trim();
        if (!/^[\w-]+$/.test(id) || ['tenth', 'investment', 'saving', 'other'].includes(id) || seen.has(id)) return null;
        seen.add(id);
        const legacy = d.family.find(person => person.id === id);
        return {
          id,
          name: String(member.name || id).trim() || id,
          enabled: member.enabled !== false,
          monthlyAmount: nonNegative(member.monthlyAmount, legacy ? legacy.monthlyAmount : 0),
          ...(CURRENCIES.includes(member.currency) && member.currency !== 'USD' ? { currency: member.currency } : {}),
          ...(member.newSalariesOnly === true ? { newSalariesOnly: true } : {}),
          ...(member.showIncome === true ? { showIncome: true } : {}),
          ...(member.inBlocksTotal === true ? { inBlocksTotal: true } : {}),
          ...Object.fromEntries(FAMILY_FLAGS.map(flag => [flag, flag === 'showInSalaryFooter' && typeof member[flag] !== 'boolean' ? member.showInFooter !== false : member[flag] !== false]))
        };
      }).filter(Boolean)
      : d.family.map(person => ({
        ...person,
        monthlyAmount: nonNegative(s.allocation && s.allocation[person.id], person.monthlyAmount)
      }));
    const allocation = Object.fromEntries(family.filter(person => person.enabled).map(person => [person.id, person.monthlyAmount]));
    const rowIds = new Set();
    const mappedRows = Array.isArray(s.defaultRows)
      ? s.defaultRows.map(row => {
        const fallback = d.defaultRows.find(item => item.id === row.id);
        if (!fallback || rowIds.has(row.id)) return null;
        rowIds.add(row.id);
        return {
          id: fallback.id,
          name: String(row.name || fallback.name).trim() || fallback.name,
          currency: fallback.id === OTHER ? 'USD' : CURRENCIES.includes(row.currency) ? row.currency : fallback.currency,
          ...(RATE_BASES.includes(row.base) ? { base: row.base } : fallback.base ? { base: fallback.base } : {}),
          amount: nonNegative(row.amount, fallback.amount),
          enabled: row.enabled !== false,
          showInSalary: row.showInSalary === true,
          showInSalaryFooter: typeof row.showInSalaryFooter === 'boolean' ? row.showInSalaryFooter : row.showInFooter !== false,
          showInHistory: row.showInHistory === true,
          showInHistoryDetails: typeof row.showInHistoryDetails === 'boolean' ? row.showInHistoryDetails : row.showInHistory === true,
          showInDropdown: typeof row.showInDropdown === 'boolean' ? row.showInDropdown : fallback.showInDropdown,
          showInBlocks: typeof row.showInBlocks === 'boolean' ? row.showInBlocks : fallback.showInBlocks,
          showInFooter: row.showInFooter !== false,
          includeInTotal: row.includeInTotal === true,
          ...(row.showIncome === true ? { showIncome: true } : {}),
          ...(row.inBlocksTotal === true ? { inBlocksTotal: true } : {}),
          inNetSalary: typeof row.inNetSalary === 'boolean' ? row.inNetSalary : fallback.inNetSalary === true,
          ...(row.newSalariesOnly === true ? { newSalariesOnly: true } : {})
        };
      }).filter(Boolean)
      : d.defaultRows.map(row => {
        const legacyAmount = row.id === 'monthly_saving' ? s.monthlySaving
          : row.id === 'monthly_investment' ? s.monthlyInvestment
            : row.id.startsWith('monthly_pay_') ? s.monthlyPay && s.monthlyPay[Number(row.id.slice(-1))]
              : row.id === 'tenth_spend' ? s.tenthSpendUah : row.amount;
        return { ...row, amount: nonNegative(legacyAmount, row.amount) };
      });
    // Settings saved before Other became a row still show it.
    const defaultRows = Array.isArray(s.defaultRows) && s.rowsVersion !== 2 && !mappedRows.some(row => row.id === OTHER)
      ? [...mappedRows, { ...d.defaultRows.find(row => row.id === OTHER) }]
      : mappedRows;
    const rowDefault = (id, fallback = 0) => defaultRows.find(row => row.id === id)?.amount ?? fallback;
    const seenDefaults = new Set();
    const otherDefaults = Array.isArray(s.otherDefaults) ? s.otherDefaults.map(item => {
      const id = String(item && item.id || '').trim();
      const name = String(item && item.name || '').trim();
      if (!/^default_[\w-]+$/.test(id) || !name || seenDefaults.has(id)) return null;
      seenDefaults.add(id);
      return { id, name, currency: CURRENCIES.includes(item.currency) ? item.currency : 'USD', amount: nonNegative(item.amount, 0), enabled: item.enabled !== false,
        ...(RATE_BASES.includes(item.base) ? { base: item.base } : {}),
        showInSalary: item.showInSalary === true,
        showInSalaryFooter: typeof item.showInSalaryFooter === 'boolean' ? item.showInSalaryFooter : item.showInFooter !== false,
        showInHistory: item.showInHistory === true, showInHistoryDetails: typeof item.showInHistoryDetails === 'boolean' ? item.showInHistoryDetails : item.showInHistory === true, showInDropdown: item.showInDropdown === true, showInBlocks: item.showInBlocks === true, showInFooter: item.showInFooter !== false, includeInTotal: item.includeInTotal === true,
        ...(item.showIncome === true ? { showIncome: true } : {}),
        ...(item.inBlocksTotal === true ? { inBlocksTotal: true } : {}),
        ...(item.inNetSalary === true ? { inNetSalary: true } : {}),
        ...(item.newSalariesOnly === true ? { newSalariesOnly: true } : {}) };
    }).filter(Boolean) : [];
    return {
      family,
      defaultRows,
      otherDefaults,
      visibilityVersion: 1,
      rowsVersion: 2,
      monthlySaving: rowDefault('monthly_saving', d.monthlySaving),
      monthlyInvestment: rowDefault('monthly_investment', d.monthlyInvestment),
      allocation,
      monthlyPay: d.monthlyPay.map((v, i) => rowDefault(`monthly_pay_${i}`, nonNegative(s.monthlyPay && s.monthlyPay[i], v))),
      tenthSpendUah: defaultRows.find(row => row.id === 'tenth_spend' && row.enabled)?.amount || 0
    };
  };

  // Salary left after everything in the details: 5%, 1%, 10%, per-person amounts and monthly pay (UAH at the month's rate).
  const salaryLeftOf = (e, rate, family = DEFAULT_FAMILY, foreignRates = {}) => {
    if (!(rate > 0)) return null;
    const salary = salaryOf(e);
    const alloc = allocationOf(e, family);
    const savingUsd = currencyToUsd(savingOf(e), defaultRowCurrency(e, 'monthly_saving'), rate, foreignRates, salary);
    const investmentUsd = currencyToUsd(investmentOf(e), defaultRowCurrency(e, 'monthly_investment'), rate, foreignRates, salary);
    const monthlyPayUsd = payOf(e).map((amount, i) => currencyToUsd(amount, defaultRowCurrency(e, `monthly_pay_${i}`), rate, foreignRates, salary));
    const otherSpending = (e.otherDefaults || []).filter(item => item.enabled !== false).map(item => currencyToUsd(item.amount, item.currency, rate, foreignRates, salary));
    const familyUsd = entryFamily(e, family).map(member => member.enabled === false ? 0 : currencyToUsd(alloc[memberId(member)] || 0, memberCurrency(member), rate, foreignRates, salary));
    if ([savingUsd, investmentUsd, ...monthlyPayUsd, ...otherSpending, ...familyUsd].some(amount => amount === null)) return null;
    const spent = (salary - netSalaryOf(e)) + tenthFromSalary(salary, e) + savingUsd + investmentUsd
      + familyUsd.reduce((s, amount) => s + amount, 0)
      + monthlyPayUsd.reduce((s, amount) => s + amount, 0) + otherSpending.reduce((s, amount) => s + amount, 0);
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

  const parseItem = ({ who, note, amount }, family = PEOPLE) => {
    const value = round2(parseFloat(amount));
    if (!(ITEM_WHO.includes(who) || family.includes(who) || /^person_[\w-]+$/.test(who) || ROW_WHO.test(who)) || !(value > 0)) return null;
    return { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), who, note: String(note || '').trim(), amount: value };
  };

  const mapMonth = (data, month, fn) => data.map(e => e.month === month ? fn(e) : e);

  const addItem = (data, month, kind, item) =>
    mapMonth(data, month, e => ({ ...e, [kind]: [...itemsOf(e, kind), item] }));

  const removeItem = (data, month, kind, id) =>
    mapMonth(data, month, e => ({ ...e, [kind]: itemsOf(e, kind).filter(s => s.id !== id) }));

  const updateItem = (data, month, kind, item, nextKind = kind) =>
    mapMonth(data, month, entry => {
      if (!itemsOf(entry, kind).some(saved => saved.id === item.id)) return entry;
      if (kind === nextKind) return { ...entry, [kind]: itemsOf(entry, kind).map(saved => saved.id === item.id ? { ...saved, ...item } : saved) };
      return { ...entry, [kind]: itemsOf(entry, kind).filter(saved => saved.id !== item.id), [nextKind]: [...itemsOf(entry, nextKind), item] };
    });

  const toCsv = data => ['Month,Salary,Net salary,10%,After 10%,Me,Wife,Son,Total,Income,Spent,Left',
    ...data.map(e => [e.month, salaryOf(e), netSalaryOf(e), round2(e.tenth || 0), afterTenthOf(e), ...PEOPLE.map(f => round2(e[f])), sum(e), incomeOf(e), spentOf(e), leftOf(e)].join(','))].join('\n');

  const isValidItem = s => s && typeof s.id === 'string' && (ITEM_WHO.includes(s.who) || /^person_[\w-]+$/.test(s.who) || ROW_WHO.test(s.who))
    && typeof s.note === 'string' && Number.isFinite(s.amount);
  const isValidDefaultRow = row => {
    const fallback = row && DEFAULT_ROWS.find(item => item.id === row.id);
    return !!fallback && typeof row.name === 'string' && row.name.trim() && (fallback.id === OTHER ? row.currency === 'USD' : CURRENCIES.includes(row.currency))
      && Number.isFinite(row.amount) && row.amount >= 0 && typeof row.enabled === 'boolean'
      && (row.base === undefined || RATE_BASES.includes(row.base))
      && typeof row.showInSalary === 'boolean' && typeof row.showInHistory === 'boolean'
      && (row.showInBlocks === undefined || typeof row.showInBlocks === 'boolean')
      && (row.showInHistoryDetails === undefined || typeof row.showInHistoryDetails === 'boolean')
      && (row.showInDropdown === undefined || typeof row.showInDropdown === 'boolean')
      && (row.newSalariesOnly === undefined || typeof row.newSalariesOnly === 'boolean')
      && (row.showInFooter === undefined || typeof row.showInFooter === 'boolean')
      && (row.showInSalaryFooter === undefined || typeof row.showInSalaryFooter === 'boolean')
      && (row.showIncome === undefined || typeof row.showIncome === 'boolean')
      && (row.inBlocksTotal === undefined || typeof row.inBlocksTotal === 'boolean')
      && (row.inNetSalary === undefined || typeof row.inNetSalary === 'boolean')
      && typeof row.includeInTotal === 'boolean';
  };
  const isValidMonthlyDefault = item => item && /^default_[\w-]+$/.test(item.id) && typeof item.name === 'string'
    && item.name.trim() && CURRENCIES.includes(item.currency) && Number.isFinite(item.amount) && item.amount >= 0
    && (item.base === undefined || RATE_BASES.includes(item.base))
    && (item.enabled === undefined || typeof item.enabled === 'boolean')
    && (item.showInSalary === undefined || typeof item.showInSalary === 'boolean')
    && (item.showInBlocks === undefined || typeof item.showInBlocks === 'boolean')
    && (item.showInHistoryDetails === undefined || typeof item.showInHistoryDetails === 'boolean')
    && (item.showInDropdown === undefined || typeof item.showInDropdown === 'boolean')
    && (item.newSalariesOnly === undefined || typeof item.newSalariesOnly === 'boolean')
    && (item.showInFooter === undefined || typeof item.showInFooter === 'boolean')
    && (item.showInSalaryFooter === undefined || typeof item.showInSalaryFooter === 'boolean')
    && (item.showIncome === undefined || typeof item.showIncome === 'boolean')
    && (item.inBlocksTotal === undefined || typeof item.inBlocksTotal === 'boolean')
    && (item.inNetSalary === undefined || typeof item.inNetSalary === 'boolean')
    && (item.showInHistory === undefined || typeof item.showInHistory === 'boolean')
    && (item.includeInTotal === undefined || typeof item.includeInTotal === 'boolean');

  const isValidSavingsData = parsed => Array.isArray(parsed) && parsed.every(e =>
    e && /^\d{4}-\d{2}$/.test(e.month) && FIELDS.every(f => Number.isFinite(e[f]))
    && (e.salary === undefined || Number.isFinite(e.salary))
    && (e.monthlyPay === undefined || (Array.isArray(e.monthlyPay) && e.monthlyPay.every(Number.isFinite)))
    && (e.monthlySaving === undefined || Number.isFinite(e.monthlySaving))
    && (e.monthlyInvestment === undefined || Number.isFinite(e.monthlyInvestment))
    && (e.allocation === undefined || (e.allocation && typeof e.allocation === 'object' && !Array.isArray(e.allocation) && Object.values(e.allocation).every(Number.isFinite)))
    && (e.familySetup === undefined || (Array.isArray(e.familySetup) && e.familySetup.every(item => item && typeof item.id === 'string' && typeof item.enabled === 'boolean' && (item.currency === undefined || CURRENCIES.includes(item.currency)))))
    && (e.defaultRows === undefined || (Array.isArray(e.defaultRows) && e.defaultRows.every(isValidDefaultRow)))
    && (e.otherDefaults === undefined || (Array.isArray(e.otherDefaults) && e.otherDefaults.every(isValidMonthlyDefault)))
    && KINDS.every(k => e[k] === undefined || (Array.isArray(e[k]) && e[k].every(isValidItem))));

  const BACKUP_FORMAT = 'family-savings-backup-v2';
  const isValidSettings = s => s && Array.isArray(s.family)
    && s.family.every(person => person && /^[\w-]+$/.test(person.id) && typeof person.name === 'string'
      && typeof person.enabled === 'boolean' && Number.isFinite(person.monthlyAmount) && person.monthlyAmount >= 0
      && (person.currency === undefined || CURRENCIES.includes(person.currency))
      && (person.newSalariesOnly === undefined || typeof person.newSalariesOnly === 'boolean')
      && (person.showIncome === undefined || typeof person.showIncome === 'boolean')
      && (person.inBlocksTotal === undefined || typeof person.inBlocksTotal === 'boolean')
      && FAMILY_FLAGS.every(flag => person[flag] === undefined || typeof person[flag] === 'boolean'))
    && Number.isFinite(s.monthlySaving) && s.monthlySaving >= 0
    && Number.isFinite(s.monthlyInvestment) && s.monthlyInvestment >= 0
    && Array.isArray(s.defaultRows) && s.defaultRows.every(isValidDefaultRow)
    && Array.isArray(s.otherDefaults) && s.otherDefaults.every(isValidMonthlyDefault)
    && Array.isArray(s.monthlyPay) && s.monthlyPay.length === MONTHLY_PAY_UAH.length && s.monthlyPay.every(v => Number.isFinite(v) && v >= 0)
    && Number.isFinite(s.tenthSpendUah) && s.tenthSpendUah >= 0;
  const createBackup = (data, settings) => ({ format: BACKUP_FORMAT, data, settings: normalizeSettings(settings) });
  const isValidBackup = parsed => Array.isArray(parsed)
    ? isValidSavingsData(parsed)
    : !!parsed && parsed.format === BACKUP_FORMAT && isValidSavingsData(parsed.data) && isValidSettings(parsed.settings);

  return {
    FIELDS, ITEM_WHO, PEOPLE, fmt, sum, esc, salaryOf, salaryTotal, defaultRowValue, rowBaseValue, setRateLookup, netSalaryOf, netAfterRatesOf, netRowsOf, netSalaryTotal, tenthFromSalary, withTenth, afterTenthOf, afterTenthTotal, spendingsOf, incomesOf, spentOf, incomeOf, leftOf, spentTotals, incomeTotals, totals,
    sortDesc, parseAmount, resolveAmount, parseSalaryCsv, toSalaryCsv, nextFreeMonth, shiftMonth, copyEntry, upsert, remove, parseEntry, setSalary, MONTHLY_PAY_UAH, MONTHLY_PAY_LABELS, DEFAULT_ROWS, CURRENCIES, currencyToUsd, payOf, setMonthlyPay, setDefaultRows, setOtherDefaults, allocationOf, setAllocation, entryMember, entryFamily, savingOf, setMonthlySaving, savingLeftOf, investmentOf, setMonthlyInvestment, investmentLeftOf, salaryLeftOf, salaryIncomeOf, taxOf, onePercentOf, monthLabel, salaryDateOf, isValidGithubConfig, githubUrl, encodeContent, decodeContent, encryptText, decryptText, isEncrypted, rateDate, prevDate, uahToUsd, TENTH_SPEND_UAH, addTenthSpending, DEFAULT_SETTINGS, normalizeSettings, parseItem, addItem, removeItem, updateItem, toCsv, BACKUP_FORMAT, createBackup, isValidBackup
  };
})();

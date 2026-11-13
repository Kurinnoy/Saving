(() => {
  const key = 'savingsViewMode';
  const viewport = document.querySelector('meta[name="viewport"]');
  const mobileRules = Array.from(document.styleSheets)
    .flatMap(sheet => Array.from(sheet.cssRules))
    .filter(rule => rule instanceof CSSMediaRule && /max-width:\s*(600|700)px/.test(rule.media.mediaText));
  const originalMedia = mobileRules.map(rule => rule.media.mediaText);
  let mode;
  try { mode = localStorage.getItem(key); } catch { mode = null; }
  if (mode !== 'mobile' && mode !== 'desktop') mode = null;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  document.querySelector('nav').appendChild(button);

  function updateButton() {
    const mobile = mode === 'mobile' || (!mode && matchMedia('(max-width: 600px)').matches);
    button.textContent = mobile ? 'Desktop view' : 'Mobile view';
    button.title = button.textContent;
  }

  function applyMode() {
    viewport.content = mode === 'desktop' ? 'width=1024' : 'width=device-width, initial-scale=1';
    mobileRules.forEach((rule, index) => {
      rule.media.mediaText = mode === 'mobile' ? 'all' : mode === 'desktop' ? 'not all' : originalMedia[index];
    });
    updateButton();
    requestAnimationFrame(() => window.dispatchEvent(new Event('resize')));
  }

  button.addEventListener('click', () => {
    const mobile = mode === 'mobile' || (!mode && matchMedia('(max-width: 600px)').matches);
    mode = mobile ? 'desktop' : 'mobile';
    try { localStorage.setItem(key, mode); } catch {}
    applyMode();
  });
  window.addEventListener('resize', updateButton);
  applyMode();
})();
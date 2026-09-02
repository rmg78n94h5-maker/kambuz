(() => {
  'use strict';
  const VERSION = '1.4.0';

  function applyVersion() {
    document.querySelectorAll('.app-version').forEach(el => {
      if (el.textContent !== `v${VERSION}`) el.textContent = `v${VERSION}`;
      el.style.fontSize = '';
    });
  }

  function start() {
    applyVersion();
    const root = document.getElementById('app') || document.documentElement;
    let timer;
    new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(applyVersion, 20);
    }).observe(root, { childList: true, subtree: true, characterData: true });
  }

  window.KAMBUZ_DISPLAY_VERSION = VERSION;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

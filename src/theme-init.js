// Apply theme before first paint to avoid a flash (kept external for a strict CSP).
(function () {
  var p = localStorage.getItem('markly.theme') || 'system';
  var dark = p === 'dark' || (p === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  var z = parseFloat(localStorage.getItem('markly.zoom') || '1');
  if (z && z !== 1) document.documentElement.style.setProperty('--zoom', z);
  if (localStorage.getItem('markly.toc') === '0') document.documentElement.classList.add('toc-hidden');
})();

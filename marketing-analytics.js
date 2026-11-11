(function () {
  'use strict';
  // Replaced at build time with public sitemap paths, never account/order URLs.
  const publicPaths = new Set(/* PUBLIC_PATHS */ []);
  function permittedPath(value) {
    const path = value.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    return publicPaths.has(path === '/index' ? '/' : path);
  }
  function optedOut() {
    return navigator.globalPrivacyControl === true || navigator.doNotTrack === '1' || window.doNotTrack === '1';
  }
  if (location.hostname !== 'altapurelabs.com' || !permittedPath(location.pathname) || optedOut()) return;
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  window.va('beforeSend', function (event) {
    // No custom events, form contents, campaign identifiers or private pages.
    if (optedOut() || event.type !== 'pageview') return null;
    try {
      const url = new URL(event.url);
      if (url.origin !== location.origin || !permittedPath(url.pathname)) return null;
      url.search = '';
      url.hash = '';
      return { ...event, url: url.toString() };
    } catch (_) { return null; }
  });
  const script = document.createElement('script');
  script.defer = true;
  script.src = '/_vercel/insights/script.js';
  document.head.appendChild(script);
}());

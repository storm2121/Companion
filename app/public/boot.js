// Runs before the app's code arrives: if this device last showed the room, mark <html> so
// index.html's first style block paints the room's ground (night or day) instead of
// classic's — a reload in the room never flashes classic first. Tiny and synchronous on
// purpose. The marks are cleared the moment the real page takes over (designModes.js).
// An external file rather than inline because the site's CSP allows no inline script.
(function () {
  try {
    // The public pages paint their flat paper ground before React.
    // A returning person still enters through the real auth guard.
    if (/^\/(?:login|register|sage|desk(?:\/[^/]+)?|auth\/complete)?\/?$/.test(location.pathname)) {
      document.documentElement.setAttribute('data-public', '');
      if (/^\/(?:sage|desk(?:\/[^/]+)?)?\/?$/.test(location.pathname)) {
        document.documentElement.setAttribute('data-public-site', '');
      }
      return;
    }
    if (localStorage.getItem('companion:design') !== 'room') return;
    var root = document.documentElement;
    root.setAttribute('data-boot', 'room');
    if (localStorage.getItem('companion:mood') === 'day') root.setAttribute('data-boot-mood', 'day');
  } catch (e) {
    // Storage blocked (private mode): the first paint is classic's, as it always was.
  }
})();

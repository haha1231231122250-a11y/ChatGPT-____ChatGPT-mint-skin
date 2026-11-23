export function mountBrowserCompatibility() {
  const html = document.documentElement;
  // Docked Chromium is a native WebContentsView. Its renderer-side wrapper
  // exposes these markers, while the persistent prewarm <webview> stays hidden.
  const docked = '[data-browser-sidebar-primary-focus-target], [data-browser-sidebar-chrome-expanded]';
  const candidates = docked + ', webview';
  let activeKind = '';
  let app = null;

  function isOnScreen(element) {
    const rect = element.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8 || rect.right <= 0 || rect.bottom <= 0 ||
        rect.left >= innerWidth || rect.top >= innerHeight) return false;
    if (element.closest('[hidden]')) return false;
    const style = getComputedStyle(element);
    return style.visibility === 'visible' && style.display !== 'none' && Number(style.opacity) > 0;
  }

  function findOpenKind(root) {
    // A docked browser stays painted when native dialogs temporarily make its
    // hit targets inert. Keep the skin out of the way throughout that state.
    if (Array.from(root.querySelectorAll(docked)).some(isOnScreen)) return 'docked';
    const liveGuest = Array.from(root.querySelectorAll('webview')).some((view) =>
      !view.closest('[inert], [aria-hidden="true"]') && isOnScreen(view));
    return liveGuest ? 'webview' : '';
  }

  function sync() {
    const root = document.getElementById('root');
    if (root !== app) {
      observer.disconnect();
      app = root;
      if (app) observer.observe(app, {
        subtree: true, childList: true, attributes: true,
        attributeFilter: ['hidden', 'inert', 'aria-hidden', 'class', 'style',
          'data-browser-sidebar-primary-focus-target', 'data-browser-sidebar-chrome-expanded'],
      });
    }
    const kind = app ? findOpenKind(app) : '';
    if (kind === activeKind && (html.dataset.ccsPane || '') === (kind ? 'on' : '')) return;
    activeKind = kind;
    if (kind) {
      html.dataset.ccsPane = 'on';
      html.dataset.ccsPaneKind = kind;
    } else {
      delete html.dataset.ccsPane;
      delete html.dataset.ccsPaneKind;
    }
    document.dispatchEvent(new Event('ccs-browser-pane-change'));
  }

  const containsCandidate = (node) => node.nodeType === 1 &&
    (node.matches(candidates) || Boolean(node.querySelector(candidates)));
  const observer = new MutationObserver((records) => {
    if (records.some((record) => record.type === 'attributes'
      ? containsCandidate(record.target)
      : Array.from(record.addedNodes).some(containsCandidate) ||
        Array.from(record.removedNodes).some(containsCandidate))) sync();
  });

  sync();
  // A CSS visibility transition can finish without another DOM mutation.
  const timer = setInterval(sync, 200);
  window.addEventListener('resize', sync);
  return () => {
    observer.disconnect();
    clearInterval(timer);
    window.removeEventListener('resize', sync);
    delete html.dataset.ccsPane;
    delete html.dataset.ccsPaneKind;
  };
}

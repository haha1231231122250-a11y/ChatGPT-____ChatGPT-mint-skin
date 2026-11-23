export const astraRuntime = () => '(' + mountAstra.toString() + ')(payload.astraExpressions)';

function mountAstra(expressions) {
  const button = document.getElementById('ccs-astra');
  if (!button) return;
  const img = button.querySelector('img');
  const original = img.src;
  const status = button.querySelector('[role="status"]');
  const scenes = [
    ['cool', 'think', 'cheer', 'Astra 戴上了墨镜'],
    ['sleepy', 'shy', 'greet', 'Astra 打了个哈欠'],
    ['surprise', 'happy', 'pet', 'Astra 送来一颗小星星'],
  ];
  const key = 'ccs-astra-link';
  let linked = true;
  try { linked = localStorage.getItem(key) !== '0'; } catch {}
  let step = 0;
  let acceptedAt = -Infinity;
  let secondFrame;
  let resetFrame;
  const show = (pose) => {
    img.src = expressions[pose] || original;
    button.dataset.expression = pose;
  };
  const click = () => {
    const now = performance.now();
    if (now - acceptedAt < 650) return;
    acceptedAt = now;
    const [first, second, action, line] = scenes[step++ % scenes.length];
    clearTimeout(secondFrame);
    clearTimeout(resetFrame);
    show(first);
    status.textContent = line;
    if (linked) window.__ccsAssistant?.act(action);
    secondFrame = setTimeout(() => show(second), 1200);
    resetFrame = setTimeout(() => {
      show('happy');
      status.textContent = '';
    }, 2600);
  };
  button.addEventListener('click', click);
  window.__ccsAstra = {
    get linked() { return linked; },
    setLinked(value) {
      linked = Boolean(value);
      try { localStorage.setItem(key, linked ? '1' : '0'); } catch {}
    },
    dispose() {
      clearTimeout(secondFrame);
      clearTimeout(resetFrame);
      button.removeEventListener('click', click);
      delete window.__ccsAstra;
    },
  };
}

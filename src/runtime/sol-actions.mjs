export function mountSolActions(root, { canAct, toPose, feedback, onPet, onTouch, clickLines }) {
  const actions = {
    greet: { label: '打招呼', pose: 'wave', sticker: 'done', lines: ['嗨，我在这儿！', '你好呀，挥个手！', '今天见到你啦。', '来打个招呼吧。'] },
    pet: { label: '摸摸头', pose: 'blink', sticker: 'hug', lines: ['被摸头啦！', '嘿嘿，有点痒。', '今天的摸头收到啦。', '送你一颗小爱心。'] },
    cheer: { label: '给我打气', pose: 'cheer', sticker: 'done', lines: ['这一步也算数。', '照自己的节奏来。', '给你一个大拇指！', '再试一次也很好。'] },
  };
  const lastLines = {};
  let lastActionAt = -Infinity;
  const controller = new AbortController();
  const listen = (target, name, callback) => target.addEventListener(name, callback, { signal: controller.signal });
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'ccs-sol-actions-toggle';
  trigger.textContent = '•••';
  trigger.setAttribute('aria-label', 'Sol 互动');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-controls', 'ccs-sol-actions');
  const menu = document.createElement('div');
  menu.id = 'ccs-sol-actions';
  menu.hidden = true;
  menu.setAttribute('role', 'group');
  menu.setAttribute('aria-label', 'Sol 互动');

  function close(restoreFocus = false) {
    if (menu.hidden) return;
    menu.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus({ preventScroll: true });
  }

  function act(name, fromSprite = false) {
    const action = Object.hasOwn(actions, name) ? actions[name] : null;
    if (!action || !canAct()) return false;
    const now = performance.now();
    if (now - lastActionAt < 650) return false;
    lastActionAt = now;
    onTouch();
    const milestone = name === 'pet' ? onPet() : '';
    const preferred = fromSprite ? clickLines.filter((line) => line !== lastLines[name]) : [];
    const choices = preferred.length ? preferred : action.lines.filter((line) => line !== lastLines[name]);
    const line = milestone || choices[Math.floor(Math.random() * choices.length)];
    lastLines[name] = line;
    feedback(line, action.sticker);
    toPose(action.pose, 1650);
    return true;
  }

  for (const [name, action] of Object.entries(actions)) {
    const item = document.createElement('button');
    item.type = 'button';
    item.textContent = action.label;
    listen(item, 'click', () => { act(name); close(true); });
    menu.append(item);
  }
  root.append(trigger, menu);
  listen(trigger, 'click', () => {
    if (!canAct()) return;
    if (!menu.hidden) { close(); return; }
    menu.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    menu.firstElementChild.focus({ preventScroll: true });
  });
  listen(root, 'keydown', (event) => {
    if (event.key === 'Escape' && !menu.hidden) {
      event.stopPropagation();
      close(true);
    }
  });
  listen(document, 'click', (event) => {
    if (!menu.contains(event.target) && !trigger.contains(event.target)) close();
  });
  return {
    act,
    close,
    dispose() {
      controller.abort();
      trigger.remove();
      menu.remove();
    },
  };
}

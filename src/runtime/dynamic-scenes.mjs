// Runs in the renderer behind the application, with no input handlers.
export function mountDynamicScenes(base) {
  const layouts = {
    garden: { particles: [['leaf', 12], ['petal', 16]], light: true },
    rain: { particles: [['rain-far', 18], ['rain-near', 13], ['drop', 7]] },
    fireflies: { particles: [['firefly', 18], ['ripple', 5]] },
  };
  const layer = document.createElement('div');
  layer.className = 'ccs-bg-effects';
  layer.setAttribute('aria-hidden', 'true');
  base.append(layer);
  const picture = document.createElement('div');
  picture.className = 'ccs-scene-picture';
  layer.append(picture);
  const environment = document.createElement('div');
  environment.className = 'ccs-scene-environment';
  layer.append(environment);
  let scene = '';

  function setScene(wallpaper) {
    const definition = layouts[wallpaper?.id];
    const next = definition ? wallpaper.id : '';
    if (next === scene) return;
    scene = next;
    layer.dataset.scene = scene;
    environment.replaceChildren();
    if (!definition) {
      picture.style.removeProperty('background-image');
      return;
    }
    picture.style.backgroundImage = 'url("' + wallpaper.url + '")';
    picture.style.setProperty('--scene-anchor', wallpaper.anchor + '%');
    for (const [name, [x, y]] of Object.entries(wallpaper.portraits)) {
      picture.style.setProperty('--' + name + '-x', x + '%');
      picture.style.setProperty('--' + name + '-y', y + '%');
    }
    if (definition.light) {
      const light = document.createElement('span');
      light.className = 'ccs-scene-light';
      environment.append(light);
    }
    for (const [type, count] of definition.particles) {
      for (let i = 0; i < count; i += 1) {
        const node = document.createElement('i');
        node.dataset.effect = type;
        node.style.setProperty('--x', (3 + i * 37 % 95) + '%');
        node.style.setProperty('--y', (9 + i * 23 % 82) + '%');
        node.style.setProperty('--phase', (-i * 0.91 - 0.2) + 's');
        node.style.setProperty('--speed', (0.85 + (i % 8) * 0.11).toFixed(2));
        environment.append(node);
      }
    }
  }

  return {
    setScene,
    setPlaying(value) { layer.dataset.playing = String(value && !!scene); },
    dispose() { layer.remove(); },
  };
}

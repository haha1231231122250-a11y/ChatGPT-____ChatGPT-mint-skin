// Drive Sol through every assistant state and capture screenshots.
//   node tools/assistant-test.mjs                 # all configured states
//   node tools/assistant-test.mjs --state done    # one state
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';
import { PROJECT_ROOT, loadConfig } from '../src/assets.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
const port = Number(opt('port', DEFAULT_PORT));
const only = opt('state', '');
const config = loadConfig(PROJECT_ROOT);
const states = config.assistant?.states ? Object.keys(config.assistant.states) : ['idle', 'listening', 'thinking', 'done', 'error'];
const targets = only ? [only] : states;

const shell = await findShellTarget(port, {});
if (!shell) {
  console.error('[sol] no shell target at port', port);
  process.exit(2);
}
const cdp = await CDP.connect(shell.webSocketDebuggerUrl);

const outDir = path.join(PROJECT_ROOT, 'shots', 'assistant');
mkdirSync(outDir, { recursive: true });

const has = await cdp.evaluate('!!(window.__ccsAssistant && window.__ccsAssistant.setState)');
if (!has) {
  console.error('[sol] assistant runtime not installed; run tools/theme-lab.mjs --skin first');
  cdp.close();
  process.exit(3);
}

for (const state of targets) {
  const res = await cdp.evaluate(`(() => {
    const api = window.__ccsAssistant;
    api.setState(${JSON.stringify(state)});
    return { state: api.state, signals: api.signals() };
  })()`);
  await new Promise((r) => setTimeout(r, 700));
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true }, undefined, 15000);
  const file = path.join(outDir, `${state}.png`);
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`[sol] ${state}`, JSON.stringify(res), `-> ${path.relative(PROJECT_ROOT, file)}`);
}

await cdp.evaluate("window.__ccsAssistant && window.__ccsAssistant.setState('idle')");
cdp.close();

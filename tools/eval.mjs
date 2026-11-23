// Run an arbitrary expression in the main window and print the result.
// Usage: node tools/eval.mjs --file recon/probe.js
//        node tools/eval.mjs --expr "document.title"
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { CDP, DEFAULT_PORT, findShellTarget } from '../src/cdp.mjs';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};

const code = opt('file', '') ? readFileSync(path.resolve(opt('file', '')), 'utf8') : opt('expr', 'null');
const port = Number(opt('port', DEFAULT_PORT));

const target = await findShellTarget(port, {});
if (!target) {
  console.error('[eval] no shell target at port', port);
  process.exit(2);
}
const cdp = await CDP.connect(target.webSocketDebuggerUrl);
const out = await cdp.evaluate(code);
console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1));
cdp.close();

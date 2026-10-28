import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { doctor, hookCommand, install, uninstall } from './install.ts';
import { serve, WEB_DIR } from './server.ts';
import { simulate } from './simulate.ts';

const [cmd, ...rest] = process.argv.slice(2);
const repoFile = (p: string) => fileURLToPath(new URL('../' + p, import.meta.url));

try {
  const cfg = loadConfig(rest);
  switch (cmd) {
    case 'serve': {
      const { port } = await serve(cfg);
      console.log(`foreman-vision: http://127.0.0.1:${port}/`);
      if (!existsSync(join(WEB_DIR, 'index.html'))) console.log('warning: web/dist missing, run npm run build first for the UI');
      break;
    }
    case 'simulate':
      await simulate(cfg, rest);
      break;
    case 'install': {
      const hook = repoFile('hook/fv-hook.sh');
      console.log(install(cfg.settingsPath, hookCommand(hook, cfg.spoolDir)));
      break;
    }
    case 'uninstall':
      console.log(uninstall(cfg.settingsPath));
      break;
    case 'doctor':
      console.log(doctor(cfg));
      break;
    default:
      console.error('usage: node src/cli.ts serve [--port N] | simulate [x.jsonl] [--copies N] [--speed X] [--scenario pixel|hybrid|done|fire] | install | uninstall | doctor');
      process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}

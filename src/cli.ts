import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { doctor, hookCommand, install, uninstall } from './install.ts';
import { serve, WEB_DIR, writePortFile } from './server.ts';
import { simulate } from './simulate.ts';

const [cmd, ...rest] = process.argv.slice(2);
const repoFile = (p: string) => fileURLToPath(new URL('../' + p, import.meta.url));

try {
  const cfg = loadConfig(rest);
  switch (cmd) {
    case 'serve': {
      const { port } = await serve(cfg);
      process.on('exit', writePortFile(cfg.portFile!, port));
      // a signal skips 'exit' unless handled
      for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(sig, () => process.exit());
      console.log(`foreman-vision: http://127.0.0.1:${port}/`);
      if (!existsSync(join(WEB_DIR, 'index.html'))) console.log('warning: web/dist missing, run npm run build first for the UI');
      break;
    }
    case 'simulate':
      await simulate(cfg, rest);
      break;
    case 'install': {
      const hook = repoFile('hook/fv-hook.sh');
      console.log(install(cfg.settingsPath, hookCommand(hook, cfg.spoolDir), hookCommand(repoFile('hook/fv-ask.sh'), cfg.portFile!)));
      console.log('restart any open Claude Code sessions: they do not pick up hooks added while they run');
      break;
    }
    case 'uninstall':
      console.log(uninstall(cfg.settingsPath));
      break;
    case 'doctor':
      console.log(doctor(cfg));
      break;
    default:
      console.error('usage: node src/cli.ts serve [--port N] | simulate [x.jsonl] [--copies N] [--speed X] [--scenario pixel|hybrid|done|fire|ask] | install | uninstall | doctor');
      process.exitCode = 1;
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
}

import {requireProjectRoot} from '../project.js';
import {isAppContainerRunning, resolveHostComposer, run} from '../run.js';
import {C, CliError, PAD} from '../ui.js';
import {execInApp} from './docker.js';

export const SHORTCUTS = ['migrate', 'migrate:fresh', 'migrate:rollback', 'seed', 'seed:fresh', 'test', 'test:integration', 'stan'];

const note = (msg) => console.error(`${PAD}${C.cyan}◌${C.reset} ${C.dim}${msg}${C.reset}`);

export const composer = async (args) => {
  const root = requireProjectRoot();

  if (await isAppContainerRunning(root)) {
    note('Running Composer in the Docker app container');
    return execInApp(['composer', ...args], root);
  }

  const host = resolveHostComposer();
  const notFound = new CliError('Composer not found', 'Start the Docker stack with simpl up, or install Composer on this machine.');
  if (!host) throw notFound;
  note('Running Composer on this machine (Docker stack not running)');
  try {
    return await run(host.command, [...host.prefix, ...args], root);
  } catch (err) {
    if (err.code === 'ENOENT') throw host.command === 'php' ? new CliError('PHP not found', `Composer needs php on your PATH to run ${host.prefix[0]}.`) : notFound;
    throw err;
  }
};

// Composer only forwards arguments to a script after `--`; without it, `--filter` etc. are rejected as Composer options.
export const composerScript = (script, args) => composer([script, ...args.length && args[0] !== '--' ? ['--', ...args] : args]);

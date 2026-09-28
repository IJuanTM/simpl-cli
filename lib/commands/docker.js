import {requireProjectRoot} from '../project.js';
import {isAppContainerRunning, run} from '../run.js';
import {CliError, interactive} from '../ui.js';

const compose = async (args, root = requireProjectRoot()) => {
  try {
    return await run('docker', ['compose', ...args], root);
  } catch (err) {
    if (err.code === 'ENOENT') throw new CliError('Docker is not installed or not on your PATH', 'Install Docker Desktop, or run simpl help manual for a setup without Docker.');
    throw err;
  }
};

// `docker compose exec` allocates a TTY by default and fails outright when stdin isn't one (CI, piped input).
export const execInApp = (command, root) => compose(['exec', ...interactive ? [] : ['-T'], '-u', 'www-data', 'app', ...command], root);

export const up = (args) => compose(['up', '-d', '--build', ...args]);

export const down = (args) => compose(['down', ...args]);

export const logs = (args) => compose(['logs', ...args]);

export const sh = async () => {
  const root = requireProjectRoot();
  if (!await isAppContainerRunning(root)) throw new CliError('The Docker stack is not running', 'Start it with simpl up.');
  return execInApp(['bash'], root);
};

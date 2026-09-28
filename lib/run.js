import {execFile, spawn} from 'node:child_process';
import fs from 'node:fs';
import {constants} from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';
import {CliError} from './ui.js';

const execFileAsync = promisify(execFile);
const ignoreSigint = () => {
};

export const run = (command, args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {cwd, stdio: 'inherit'});
  // Ctrl+C reaches the child directly; the CLI must outlive it so the child's own exit code is what gets reported.
  process.on('SIGINT', ignoreSigint);
  const done = () => process.off('SIGINT', ignoreSigint);
  child.on('error', err => {
    done();
    reject(err);
  });
  child.on('close', (code, signal) => {
    done();
    resolve(code ?? 128 + (constants.signals[signal] ?? 0));
  });
});

export const isAppContainerRunning = async (root) => {
  try {
    const {stdout} = await execFileAsync('docker', ['compose', 'ps', '--status', 'running', '--services'], {cwd: root});
    return stdout.split(/\r?\n/).includes('app');
  } catch {
    return false;
  }
};

const findOnWindowsPath = (name) => {
  const extensions = (process.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean);
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean))
    for (const ext of extensions) {
      const candidate = path.join(dir, name + ext.toLowerCase());
      if (fs.existsSync(candidate)) return candidate;
    }
  return null;
};

// Node refuses to spawn .bat/.cmd files without a shell, and Composer-Setup's composer.bat only wraps `php composer.phar`.
export const resolveHostComposer = () => {
  if (process.platform !== 'win32') return {command: 'composer', prefix: []};
  const found = findOnWindowsPath('composer');
  if (!found) return null;
  if (!/\.(bat|cmd)$/i.test(found)) return {command: found, prefix: []};
  const phar = path.join(path.dirname(found), 'composer.phar');
  if (!fs.existsSync(phar)) throw new CliError(`Found ${found}, but no composer.phar next to it`, 'Install Composer with the official Composer-Setup installer, or start the Docker stack with simpl up.');
  return {command: 'php', prefix: [phar]};
};

import {readEnv, readEnvValue, requireEnv} from '../env.js';
import {requireProjectRoot} from '../project.js';
import {isAppContainerRunning, run, runningContainers} from '../run.js';
import {C, CliError, heading, interactive, line, row} from '../ui.js';

const noDocker = () => new CliError('Docker is not installed or not on your PATH', 'Install Docker Desktop, or run simpl help manual for a setup without Docker.');

const compose = async (args, root = requireProjectRoot()) => {
  try {
    return await run('docker', ['compose', ...args], root);
  } catch (err) {
    throw err.code === 'ENOENT' ? noDocker() : err;
  }
};

// `docker compose exec` allocates a TTY by default and fails outright when stdin isn't one (CI, piped input).
export const execInApp = (command, root) => compose(['exec', ...interactive ? [] : ['-T'], '-u', 'www-data', 'app', ...command], root);

const ENDPOINTS = [
  {service: 'phpmyadmin', label: 'phpMyAdmin (database UI)', port: 80, url: true},
  {service: 'mailpit', label: 'Mailpit (mail inbox)', port: 8025, url: true},
  {service: 'db', label: 'Database (MariaDB)', port: 3306, url: false},
];

const serviceEntries = async (root) => {
  let containers;
  try {
    containers = await runningContainers(root);
  } catch (err) {
    throw err.code === 'ENOENT' ? noDocker() : err;
  }
  if (!containers.some(({Service}) => Service === 'app')) return null;

  const publishedPort = (service, port) => containers.find(({Service}) => Service === service)?.Publishers?.find(({TargetPort, PublishedPort}) => TargetPort === port && PublishedPort)?.PublishedPort;
  const entries = [['Site', readEnvValue(readEnv(root), 'APP_URL') || `https://localhost:${publishedPort('app', 443)}`]];
  for (const {service, label, port, url} of ENDPOINTS) {
    const published = publishedPort(service, port);
    if (published) entries.push([label, `${url ? 'http://' : ''}localhost:${published}`]);
  }
  return entries;
};

const printUrls = (entries) => {
  line();
  heading('Services:');
  for (const [label, value] of entries) row(label, `${C.cyan}${value}${C.reset}`);
  line();
};

// A stale cached PHP base image breaks the build once roave/security-advisories flags that PHP patch release.
export const up = async (args) => {
  const root = requireProjectRoot();
  requireEnv(root);
  let code = await compose(['build', '--pull'], root);
  if (code === 0) code = await compose(['up', '-d', ...args], root);
  if (code === 0) {
    const entries = await serviceEntries(root);
    if (entries) printUrls(entries);
  }
  return code;
};

export const urls = async () => {
  const root = requireProjectRoot();
  requireEnv(root);
  const entries = await serviceEntries(root);
  if (!entries) throw new CliError('The Docker stack is not running', 'Start it with simpl up.');
  printUrls(entries);
};

export const down = (args) => compose(['down', ...args]);

export const logs = (args) => compose(['logs', ...args]);

export const sh = async () => {
  const root = requireProjectRoot();
  if (!await isAppContainerRunning(root)) throw new CliError('The Docker stack is not running', 'Start it with simpl up.');
  return execInApp(['bash'], root);
};

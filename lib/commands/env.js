import fs from 'node:fs';
import path from 'node:path';
import {parseFlags} from '../args.js';
import {envPath, generateKey, hasEnvKey, quoteEnvValue, readEnv, readEnvValue, requireExample, syncEnv, writeEnvValue} from '../env.js';
import {askAppUrl, defaultAppUrl, requireProjectRoot, toAppName, validateAppName} from '../project.js';
import {askValid, C, CliError, confirm, heading, info, interactive, item, line, plural, row, styled, success, titleBox, warn} from '../ui.js';

const options = {
  key: {type: 'boolean'},
  force: {type: 'boolean'},
  help: {type: 'boolean', short: 'h'},
};

export const help = () => {
  titleBox('Environment file');
  line();
  heading('Usage:');
  row('simpl env [options]');
  line();
  heading('Options:');
  row('--key', 'Generate a new APP_KEY');
  row('--force', 'Recreate src/.env from src/.env.example');
  row('--help, -h', 'Show this help message');
  line();
  heading('Examples:');
  row('simpl env');
  row('simpl env --key');
  line();
  heading('Note:');
  item('Without src/.env, creates it from src/.env.example and asks for the app name and URL.');
  item('With src/.env, adds the variables it is missing from src/.env.example, keeping every existing value.');
  item('Asks for the app name or URL when it is empty.');
  item('An empty APP_KEY is generated either way.');
  line();
};

const askAppValues = async (root, existing, all) => {
  const values = {};
  let name = readEnvValue(existing, 'APP_NAME');
  const url = readEnvValue(existing, 'APP_URL')?.replace(/\/+$/, '');
  if (all || !name) {
    name = await askValid('App name', name || toAppName(path.basename(root)), name => validateAppName(name, 'App name'));
    values.APP_NAME = quoteEnvValue(name);
  }
  if (all || !url) values.APP_URL = quoteEnvValue(`${await askAppUrl(url || defaultAppUrl(name))}/`);
  return values;
};

const KEY_LOSS = 'Data encrypted with the current APP_KEY, such as authenticator app secrets, can no longer be read';

const confirmChange = (question) => {
  if (!interactive) throw new CliError('This change needs confirmation', 'Run it in an interactive terminal.');
  return confirm(question);
};

const cancelled = () => {
  line();
  info('Cancelled, src/.env was left unchanged');
  line();
};

const regenerateKey = async (root) => {
  const content = readEnv(root);
  if (!hasEnvKey(content, 'APP_KEY')) throw new CliError('src/.env has no APP_KEY', 'The auth add-on adds it.');

  if (readEnvValue(content, 'APP_KEY')) {
    warn(KEY_LOSS);
    if (!await confirmChange(`${C.dim}Generate a new${C.reset} ${C.cyan}APP_KEY${C.reset}${C.dim}?${C.reset}`)) return cancelled();
  }

  writeEnvValue(root, 'APP_KEY', generateKey(), content);
  line();
  success(styled('APP_KEY generated!', C.bold, C.green), true);
  line();
};

export const run = async (args) => {
  const {values} = parseFlags(args, options);
  if (values.help) return help();

  if (values.key && values.force) throw new CliError('--key and --force cannot be combined', 'Use one of them at a time.');

  const root = requireProjectRoot();
  titleBox('Environment file');
  line();
  if (values.key) return regenerateKey(root);

  requireExample(root);

  const existing = fs.existsSync(envPath(root)) ? readEnv(root) : null;
  const recreate = values.force && existing !== null;
  if (recreate) {
    warn('This replaces src/.env, including every value set in it');
    if (readEnvValue(existing, 'APP_KEY')) warn(KEY_LOSS);
    if (!await confirmChange(`${C.dim}Recreate${C.reset} ${C.cyan}src/.env${C.reset}${C.dim}?${C.reset}`)) return cancelled();
    line();
  }

  const app = await askAppValues(root, existing ?? '', recreate || existing === null);
  const {created, added, keyGenerated} = syncEnv(root, app, {recreate});

  line();
  if (created) success(`Created ${C.cyan}src/.env${C.reset} from ${C.cyan}src/.env.example${C.reset}`);
  else {
    const set = Object.keys(app);
    if (added) success(`Added ${plural(added, 'environment variable')} to ${C.cyan}src/.env${C.reset}`);
    if (set.length) success(`Set ${set.map(key => `${C.cyan}${key}${C.reset}`).join(' and ')}`);
    if (!added && !set.length) info('src/.env already has every variable from src/.env.example');
  }
  if (keyGenerated) success(`Generated ${C.cyan}APP_KEY${C.reset}`);
  line();
  success(styled('Environment file ready!', C.bold, C.green), true);
  line();
};

import fs from 'node:fs';
import path from 'node:path';
import {readEnv, readEnvValue} from './env.js';
import {isUnsupportedVersion, unsupportedVersion} from './releases.js';
import {askValid, CliError} from './ui.js';

const SIMPL_FILE = '.simpl';

const findProjectRoot = () => {
  let dir = process.cwd();
  while (true) {
    if (fs.statSync(path.join(dir, SIMPL_FILE), {throwIfNoEntry: false})?.isFile()) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
};

export const requireProjectRoot = () => {
  const root = findProjectRoot();
  if (!root) throw new CliError('Not a Simpl project', `No ${SIMPL_FILE} file found in this folder or any parent folder.`);
  readProjectConfig(root);
  return root;
};

export const readProjectConfig = (root) => {
  let config;
  try {
    config = JSON.parse(fs.readFileSync(path.join(root, SIMPL_FILE), 'utf8'));
  } catch (err) {
    throw new CliError(`Invalid ${SIMPL_FILE} file: ${err.message}`);
  }
  if (!config?.version) throw new CliError(`Invalid ${SIMPL_FILE} file: missing version field`);
  if (isUnsupportedVersion(config.version)) throw unsupportedVersion(config.version);
  return config;
};

export const projectNameToSlug = (name = '') => name.trim().toLowerCase().replace(/[\s_]+/g, '-');

export const validateAppName = (name, label = 'Project name') => {
  if (!name?.trim()) return `${label} cannot be empty`;
  return /^[a-zA-Z0-9 _-]+$/.test(name) ? null : `${label} can only contain letters, numbers, spaces, hyphens, and underscores`;
};

export const toAppName = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-zA-Z0-9 _-]+/g, ' ').replace(/\s+/g, ' ').trim();

export const defaultAppUrl = (name) => `http://${projectNameToSlug(toAppName(name))}.local`;

export const validateUrl = (url) => {
  const trimmed = url?.trim().replace(/\/+$/, '');
  if (!trimmed) return {error: 'URL cannot be empty'};
  return /^https?:\/\/.+/.test(trimmed) ? {url: trimmed} : {error: 'URL must start with http:// or https://'};
};

export const askAppUrl = async (defaultUrl) => validateUrl(await askValid('App URL', defaultUrl, url => validateUrl(url).error)).url;

export const placeholders = (name, url) => ({'@app-name': name, '@app-url': url});

export const applyPlaceholders = (data, replacements) => {
  const content = data.toString('utf8');
  let modified = content;
  for (const [search, replace] of Object.entries(replacements)) modified = modified.split(search).join(replace);
  return modified === content ? data : Buffer.from(modified, 'utf8');
};

// Add-on files use the same placeholders as core, so their values are read back from what `simpl new` wrote into the project.
export const readProjectPlaceholders = (root) => {
  const env = readEnv(root);
  const name = readEnvValue(env, 'APP_NAME'), url = readEnvValue(env, 'APP_URL')?.replace(/\/+$/, '');
  return name && url ? placeholders(name, url) : null;
};

export const markAddonInstalled = (root, addonName) => {
  const config = readProjectConfig(root);
  config.addons = [...new Set([...config.addons || [], addonName])].sort();
  fs.writeFileSync(path.join(root, SIMPL_FILE), JSON.stringify(config, null, 2) + '\n', 'utf8');
};

import fs from 'node:fs';
import path from 'node:path';
import {isUnsupportedVersion, unsupportedVersion} from './releases.js';
import {CliError} from './ui.js';

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
  if (!config.version) throw new CliError(`Invalid ${SIMPL_FILE} file: missing version field`);
  if (isUnsupportedVersion(config.version)) throw unsupportedVersion(config.version);
  return config;
};

export const placeholders = (name, url) => ({'@app-name': name, '@app-url': url});

export const applyPlaceholders = (data, replacements) => {
  const content = data.toString('utf8');
  let modified = content;
  for (const [search, replace] of Object.entries(replacements)) modified = modified.split(search).join(replace);
  return modified === content ? data : Buffer.from(modified, 'utf8');
};

// Add-on files use the same placeholders as core, so their values are read back from what `simpl new` wrote into the project.
export const readProjectPlaceholders = (root) => {
  let env;
  try {
    env = fs.readFileSync(path.join(root, 'src', '.env'), 'utf8');
  } catch {
    return null;
  }
  const value = (key) => env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1].trim().replace(/^(["'])(.*)\1$/, '$2');
  const name = value('APP_NAME'), url = value('APP_URL')?.replace(/\/+$/, '');
  return name && url ? placeholders(name, url) : null;
};

export const markAddonInstalled = (root, addonName) => {
  const config = readProjectConfig(root);
  config.addons = [...new Set([...config.addons || [], addonName])].sort();
  fs.writeFileSync(path.join(root, SIMPL_FILE), JSON.stringify(config, null, 2) + '\n', 'utf8');
};

import {randomBytes} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {envLine, mergeContent, normalizeEol, stripMarkers} from './merge.js';
import {CliError} from './ui.js';

export const envPath = (root) => path.join(root, 'src', '.env');

const examplePath = (root) => path.join(root, 'src', '.env.example');

const noEnv = () => new CliError('No src/.env file found', 'Create it with simpl env.');

const noExample = () => new CliError('No src/.env.example file found', 'It ships with every Simpl project, restore it from a fresh install.');

export const requireEnv = (root) => {
  if (!fs.existsSync(envPath(root))) throw noEnv();
};

export const requireExample = (root) => {
  if (!fs.existsSync(examplePath(root))) throw noExample();
};

const readLf = (file, missing) => {
  try {
    return normalizeEol(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw err.code === 'ENOENT' ? missing() : new CliError(`Could not read src/${path.basename(file)}: ${err.message}`);
  }
};

export const readEnv = (root) => readLf(envPath(root), noEnv);

const readExample = (root) => readLf(examplePath(root), noExample);

// 32 random bytes as hex, the key length Crypto.php decodes for libsodium's secretbox.
export const generateKey = () => randomBytes(32).toString('hex');

export const hasEnvKey = (content, key) => envLine(key).test(content);

// Mirrors phpdotenv: a quoted value ends at its closing quote, an unquoted one at any #.
export const readEnvValue = (content, key) => {
  const raw = content.match(envLine(key))?.groups.value.trim();
  if (raw === undefined) return undefined;
  const doubleQuoted = raw.match(/^"((?:[^"\\]|\\.)*)"/);
  if (doubleQuoted) return doubleQuoted[1].replace(/\\(.)/g, '$1');
  return raw.match(/^'([^']*)'/)?.[1] ?? raw.replace(/#.*$/, '').trim();
};

// phpdotenv expands ${VAR} inside double quotes, so $ is escaped along with \ and ".
export const quoteEnvValue = (value) => `"${value.replace(/[\\"$]/g, '\\$&')}"`;

// A replacer function, since a replacement string would expand $ sequences in the value.
const setEnvValue = (content, key, value) => hasEnvKey(content, key)
  ? content.replace(envLine(key), (line, prefix) => `${prefix}${key}=${value}`)
  : `${content.replace(/\n*$/, '\n')}${key}=${value}\n`;

export const writeEnvValue = (root, key, value, content = readEnv(root)) => fs.writeFileSync(envPath(root), setEnvValue(content, key, value), 'utf8');

export const appValues = (name, url) => ({APP_NAME: quoteEnvValue(name), APP_URL: quoteEnvValue(`${url}/`)});

export const syncEnv = (root, values = {}, {example = readExample(root), recreate = false} = {}) => {
  example = stripMarkers(example);
  const created = recreate || !fs.existsSync(envPath(root));
  const before = created ? '' : readEnv(root);

  const merged = created ? null : mergeContent(before, example, [], true);
  let content = merged?.content ?? example;
  const added = merged?.operations.reduce((sum, op) => sum + (op.success ? op.lines : 0), 0) ?? 0;

  for (const [key, value] of Object.entries(values)) content = setEnvValue(content, key, value);

  const keyGenerated = hasEnvKey(content, 'APP_KEY') && !readEnvValue(content, 'APP_KEY');
  if (keyGenerated) content = setEnvValue(content, 'APP_KEY', generateKey());

  if (content !== before) fs.writeFileSync(envPath(root), content, 'utf8');
  return {created, added, keyGenerated};
};

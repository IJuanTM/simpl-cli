import path from 'node:path';

export const normalizeEol = (text) => text.replaceAll('\r\n', '\n');

export const stripMarkers = (content) => content.split('\n').filter(line => !/@addon-(insert|end)/.test(line)).join('\n');

const placeholderLine = (name) => new RegExp(`@addon-placeholder:${name}(?![\\w-])`);

// A block is the lines between an @addon-insert:<name> line and the next @addon-end line.
const extractBlocks = (content) => {
  const blocks = [];
  let block = null;
  for (const line of content.split('\n')) {
    const name = line.match(/@addon-insert:([\w-]+)/)?.[1];
    if (name) blocks.push(block = {name, lines: []});
    else if (line.includes('@addon-end')) block = null;
    else block?.lines.push(line);
  }
  return blocks.filter(({lines}) => lines.some(line => line.trim()));
};

const indentOf = (line) => line.match(/^[ \t]*/)[0];

// A block keeps its own relative indentation and moves as a whole to the placeholder's depth.
const reindent = (lines, indent) => {
  const own = Math.min(...lines.filter(line => line.trim()).map(line => indentOf(line).length));
  return lines.map(line => line.trim() ? indent + line.slice(own) : '');
};

const append = (content, lines) => (content.trim() ? content.replace(/\n*$/, '\n\n') : '') + lines.join('\n') + '\n';

// All or nothing: with a placeholder missing the file is left as it is, so a later run can add every block exactly once.
const mergeBlocks = (target, blocks) => {
  const lines = target.split('\n'), missing = new Set();

  for (const block of blocks.filter(({name}) => name !== 'append')) {
    const placeholder = placeholderLine(block.name);
    const index = lines.findIndex(line => placeholder.test(line));
    if (index === -1) missing.add(block.name);
    else lines.splice(index, 0, ...reindent(block.lines, indentOf(lines[index])));
  }
  if (missing.size) return {content: target, added: 0, missing: [...missing]};

  const content = blocks.filter(({name}) => name === 'append').reduce((text, block) => append(text, block.lines), lines.join('\n'));
  return {content, added: blocks.reduce((sum, block) => sum + block.lines.length, 0), missing: []};
};

export const envLine = (key = '[A-Za-z_][A-Za-z0-9_]*') => new RegExp(`^(?<prefix>[ \\t]*(?:export[ \\t]+)?)(?<key>${key})[ \\t]*=(?<value>.*)$`, 'm');

const ENV_KEY = envLine();

// A group's leading comments and blank lines are only added together with its first new variable.
const mergeEnv = (target, example) => {
  const lines = [];
  const existing = new Set(target.split('\n').map(line => line.match(ENV_KEY)?.groups.key).filter(Boolean));
  let header = [], inGroup = false, added = 0;

  for (const line of stripMarkers(example).split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('#') || !trimmed) {
      if (inGroup) [header, inGroup] = [[], false];
      header.push(line);
      continue;
    }
    inGroup = true;
    const key = line.match(ENV_KEY)?.groups.key;
    if (!key || existing.has(key)) continue;
    existing.add(key);
    lines.push(...header, line);
    header = [];
    added++;
  }

  // The append adds its own blank line, so a group's leading blank line would double it.
  while (lines.length && !lines[0].trim()) lines.shift();
  return {content: added ? append(target, lines) : target, added, missing: []};
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

const addMissingKeys = (target, addon) => {
  let added = 0;
  for (const [key, value] of Object.entries(addon)) {
    if (!Object.hasOwn(target, key)) {
      target[key] = value;
      added++;
    } else if (isObject(target[key]) && isObject(value)) added += addMissingKeys(target[key], value);
  }
  return added;
};

// Keys the project doesn't have yet are added, at any depth; a value it already has is kept.
const mergeJson = (target, addon) => {
  const data = JSON.parse(target), fragment = JSON.parse(addon);
  if (!isObject(data) || !isObject(fragment)) throw new Error('Only JSON objects can be merged');
  const added = addMissingKeys(data, fragment);
  return {content: added ? JSON.stringify(data, null, target.match(/^[ \t]+(?=")/m)?.[0] ?? 2) + '\n' : target, added, missing: []};
};

// How an add-on file is merged into the project's file at the same path, or null when it can't be.
export const mergeKind = (relativePath, content) => {
  if (path.posix.basename(relativePath) === '.env.example') return 'env';
  if (relativePath.endsWith('.json')) return 'json';
  return extractBlocks(content).length ? 'blocks' : null;
};

export const mergeFile = (kind, target, addon) => {
  if (kind === 'env') return mergeEnv(target, addon);
  if (kind === 'json') return mergeJson(target, addon);
  return mergeBlocks(target, extractBlocks(addon));
};

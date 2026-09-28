import fs from 'node:fs';
import path from 'node:path';
import {closestMatch, parseFlags} from '../args.js';
import {extractMarkers, mergeContent} from '../merge.js';
import {applyPlaceholders, markAddonInstalled, readProjectConfig, readProjectPlaceholders, requireProjectRoot} from '../project.js';
import {addonSource, getAvailableAddons, getVersions, localReleasesDir, readRelease} from '../releases.js';
import {ask, C, CliError, confirm, confirmSuggestion, divider, error, heading, info, installBox, interactive, item, line, out, PAD, plural, printAnswer, row, styled, success, task, titleBox, warn} from '../ui.js';

const options = {
  list: {type: 'boolean', short: 'l'},
  local: {type: 'boolean'},
  help: {type: 'boolean', short: 'h'},
};

export const help = () => {
  titleBox('Install an add-on');
  line();
  heading('Usage:');
  row('simpl add [name] [options]', 'Aliases: simpl add-on, simpl addon');
  line();
  heading('Options:');
  row('--list, -l', 'List available add-ons');
  row('--local', 'Only use local release files (SIMPL_LOCAL_RELEASES)');
  row('--help, -h', 'Show this help message');
  line();
  heading('Examples:');
  row('simpl add');
  row('simpl add auth');
  row('simpl add --list');
  line();
  heading('Note:');
  item('Works from anywhere inside a Simpl project.');
  item('The add-on version matches the framework version in the project\'s .simpl file.');
  line();
};

const listAddons = (addons) => addons.forEach((name, i) => out(PAD + C.cyan + `${i + 1}.` + C.reset + ' ' + name));

const loadAddonList = (versions, version, local) => {
  if (!versions[version]) throw new CliError(`Version ${version} not found`, local ? `There is no ${version} folder in the local releases folder ${localReleasesDir()}.` : 'The version in your .simpl file is not listed on the CDN.');
  return getAvailableAddons(versions, version, local);
};

const selectAddon = async (addons, preset) => {
  let input = preset;
  while (true) {
    if (!input && !interactive) throw new CliError('Add-on name is required', 'Pass it as the first argument, e.g. simpl add auth.');
    input ||= await ask(`Add-on to install ${C.dim}(name or number)${C.reset}`);
    if (!input) {
      warn('Selection cannot be empty');
      line();
      continue;
    }

    if (/^\d+$/.test(input) && addons[input - 1]) return addons[input - 1];
    if (addons.includes(input)) return input;

    line();
    error(`Add-on ${styled(input, C.bold)} not found`);
    const suggestion = closestMatch(input, addons);
    if (suggestion && await confirmSuggestion(suggestion)) return suggestion;
    line();
    heading('Available add-ons:');
    listAddons(addons);
    if (!interactive) throw new CliError('Pass one of the add-ons above, e.g. simpl add <name>');
    line();
    input = null;
  }
};

const readManifest = (entries) => {
  const manifest = entries.find(e => e.path === 'addon.json');
  if (!manifest) return {dependencies: []};
  try {
    const {dependencies} = JSON.parse(manifest.data.toString('utf8'));
    return {dependencies: Array.isArray(dependencies) ? dependencies : []};
  } catch {
    return {dependencies: []};
  }
};

const isSameFile = (destPath, data) => {
  const existing = fs.readFileSync(destPath);
  return existing.equals(data) || existing.toString('utf8').replaceAll('\r\n', '\n') === data.toString('utf8');
};

const processAddonFiles = (entries, root) => {
  const copied = [], present = [], skipped = [], toMerge = [];

  for (const {path: relativePath, data, mode} of entries) {
    if (relativePath === 'README.md' || relativePath === 'addon.json') continue;
    const destPath = path.join(root, ...relativePath.split('/'));

    if (!fs.existsSync(destPath)) {
      fs.mkdirSync(path.dirname(destPath), {recursive: true});
      fs.writeFileSync(destPath, data, mode ? {mode} : undefined);
      copied.push(relativePath);
    } else if (isSameFile(destPath, data)) present.push(relativePath);
    else {
      const content = data.toString('utf8');
      const markers = extractMarkers(content);
      const isEnv = path.posix.basename(relativePath) === '.env';
      if (markers.length || isEnv) toMerge.push({content, destPath, relativePath, markers, isEnv});
      else skipped.push(relativePath);
    }
  }

  return {copied, present, skipped, toMerge};
};

const printOperation = (op, isEnv) => {
  const count = plural(op.lines, isEnv ? 'environment variable' : 'line');
  if (op.success) {
    if (op.type === 'prepend') success(`Prepended ${count} to file start`);
    else if (op.type === 'append') success(`Appended ${count} to file end`);
    else if (op.type === 'replace') success(`Replaced marker ${C.cyan}${op.markerName}${C.reset} with ${count}`);
    else success(`Inserted ${count} ${C.cyan}${op.type}${C.reset} ${styled(op.searchText, C.dim)}`);
  } else if (op.type === 'notfound') {
    warn(`Target line not found, code not added: ${styled(op.markerName ?? op.searchText, C.dim)}`);
  } else {
    info(`Content already exists (${op.type})`);
  }
};

const mergeFiles = (toMerge, problems) => {
  const merged = [], failed = [], unchanged = [];

  for (const {content, destPath, relativePath, markers, isEnv} of toMerge) {
    line();
    info(relativePath);
    try {
      const target = fs.readFileSync(destPath, 'utf8');
      const result = mergeContent(target.replaceAll('\r\n', '\n'), content, markers, isEnv);
      if (result.content !== target) fs.writeFileSync(destPath, result.content, 'utf8');
      for (const op of result.operations) printOperation(op, isEnv);

      const missing = result.operations.filter(op => op.type === 'notfound');
      for (const op of missing) problems.push(`${relativePath} ${C.dim}(target line not found: ${op.markerName ?? op.searchText})${C.reset}`);
      if (result.operations.some(op => op.success)) merged.push(relativePath);
      else if (!missing.length) unchanged.push(relativePath);
    } catch (err) {
      error(`Error: ${err.message}`);
      failed.push(relativePath);
      problems.push(`${relativePath} ${C.dim}(${err.message})${C.reset}`);
    }
  }

  return {merged, failed, unchanged};
};

const installAddon = async (addonName, context, chain = []) => {
  const {root, version, local, addons, installed, problems, replacements} = context;
  if (installed.has(addonName)) return;
  if (chain.includes(addonName)) throw new CliError(`Circular add-on dependency detected: ${[...chain, addonName].join(' → ')}`);
  chain = [...chain, addonName];

  installBox(addonName, version);
  line();
  const source = addonSource(version, addonName, local);
  task(source.local ? `💻 Reading local ${C.cyan}${addonName}${C.reset} add-on files...` : `📦 Downloading ${C.cyan}${addonName}${C.reset} add-on...`);
  const entries = (await readRelease(source)).map(entry => ({...entry, data: applyPlaceholders(entry.data, replacements)}));

  const installedBefore = installed.size, problemsBefore = problems.length;
  for (const dep of readManifest(entries).dependencies) {
    if (installed.has(dep)) continue;
    if (!addons.includes(dep)) throw new CliError(`${addonName} requires the ${dep} add-on, which is ${local ? 'missing in the local releases folder' : `not available for v${version}`}`);
    line();
    warn(`${styled(addonName, C.bold)} requires the ${styled(dep, C.bold)} add-on, which is not installed`);
    if (!await confirm(`${C.dim}Install${C.reset} ${C.cyan}${dep}${C.reset} ${C.dim}first?${C.reset}`, true)) throw new CliError(`Cannot install ${addonName} without ${dep}`);
    await installAddon(dep, context, chain);
  }
  if (installed.size > installedBefore) installBox(addonName, version);

  const {copied, present, skipped, toMerge} = processAddonFiles(entries, root);

  if (copied.length) {
    line();
    success(`Copied ${plural(copied.length, 'new file')}`);
  }

  if (present.length) {
    line();
    info(`${plural(present.length, 'file')} already in the project, left unchanged`);
  }

  if (skipped.length) {
    line();
    info(`Skipped ${plural(skipped.length, 'existing file')} with different content and no merge markers:`);
    for (const file of skipped) item(file, true);
  }

  if (toMerge.length) {
    line();
    task('🔀 Merging existing files...');
    const {merged, failed, unchanged} = mergeFiles(toMerge, problems);
    divider();
    if (merged.length) success(`Merged ${plural(merged.length, 'file')}`);
    if (unchanged.length) info(`${plural(unchanged.length, 'file')} unchanged (content already exists)`);
    if (failed.length) warn(`${plural(failed.length, 'file')} failed to merge`);
  }

  installed.add(addonName);
  line();
  const newProblems = problems.length - problemsBefore;
  if (newProblems) warn(`${addonName} not fully installed, ${plural(newProblems, 'merge problem')}, see below`, true);
  else {
    markAddonInstalled(root, addonName);
    success(styled(`${addonName} installed!`, C.bold, C.green), true);
  }
};

export const run = async (args) => {
  const {values, positionals} = parseFlags(args, options);
  if (values.help) return help();

  if (positionals.length > 1) throw new CliError('Only one add-on can be installed at a time', `Run simpl add ${positionals[0]} first, then the others.`);
  const root = requireProjectRoot();
  const config = readProjectConfig(root);
  const {version} = config;
  const installed = new Set(config.addons || []);

  if (values.list) {
    titleBox('Available add-ons', `v${version}`);
    line();
    task(values.local ? '💻 Reading local add-ons...' : '📦 Fetching available add-ons...');
    const addons = loadAddonList(await getVersions(values.local), version, values.local);
    line();
    heading('Available add-ons:');
    if (!addons.length) info('No add-ons available for this version');
    else listAddons(addons);
    line();
    return;
  }

  titleBox('Install an add-on', `v${version}`);
  line();
  task(values.local ? '💻 Reading local add-ons...' : '📦 Fetching available add-ons...');
  const addons = loadAddonList(await getVersions(values.local), version, values.local);
  if (!addons.length) {
    line();
    warn('No add-ons available for this version');
    line();
    return;
  }

  let addonName;
  if (positionals[0]) {
    addonName = await selectAddon(addons, positionals[0]);
    line();
    printAnswer('Add-on to install', addonName);
  } else {
    line();
    heading('Available add-ons:');
    listAddons(addons);
    line();
    addonName = await selectAddon(addons);
  }

  if (installed.has(addonName)) {
    line();
    info(`${addonName} is already installed in this project`);
    line();
    return;
  }

  const replacements = readProjectPlaceholders(root);
  if (!replacements) throw new CliError('Could not read APP_NAME and APP_URL from src/.env', 'The add-on files need them to fill in the project name and URL.');

  const problems = [];
  await installAddon(addonName, {root, version, local: values.local, addons, installed, problems, replacements});

  if (problems.length) {
    divider();
    warn(`${plural(problems.length, 'merge problem')}, this add-on code was not added:`, true);
    for (const problem of problems) item(problem);
    line();
    info(`Restore the target lines or add the missing parts by hand, then run simpl add ${addonName} again to finish.`);
    line();
    return 1;
  }

  line();
  success(styled('Installation complete!', C.bold, C.green), true);
  line();
};

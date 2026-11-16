import fs from 'node:fs';
import path from 'node:path';
import {closestMatch, parseFlags} from '../args.js';
import {syncEnv} from '../env.js';
import {mergeFile, mergeKind, normalizeEol, stripMarkers} from '../merge.js';
import {allMergedFiles, applyPlaceholders, isFrameworkTest, markAddonInstalled, mergedFiles, readProjectConfig, readProjectPlaceholders, recordMergedFiles, requireProjectRoot} from '../project.js';
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
  item('The add-on\'s own tests are installed when the project was created with --tests.');
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
  return existing.equals(data) || normalizeEol(existing.toString('utf8')) === data.toString('utf8');
};

const processAddonFiles = (entries, root, problems) => {
  const copied = [], present = [], skipped = [], toMerge = [];
  const mergedInto = allMergedFiles(root);

  for (const {path: relativePath, data, mode} of entries) {
    if (relativePath === 'README.md' || relativePath === 'addon.json') continue;
    const destPath = path.join(root, ...relativePath.split('/'));
    const content = data.toString('utf8');
    const kind = mergeKind(relativePath, content);
    const copyData = kind === 'env' ? Buffer.from(stripMarkers(content), 'utf8') : data;

    const stat = fs.statSync(destPath, {throwIfNoEntry: false});
    if (!stat && kind === 'blocks') problems.push(`${relativePath} ${C.dim}(file not found in the project, the add-on adds code to it)${C.reset}`);
    else if (!stat) {
      try {
        fs.mkdirSync(path.dirname(destPath), {recursive: true});
        fs.writeFileSync(destPath, copyData, mode ? {mode} : undefined);
        copied.push(relativePath);
      } catch (err) {
        problems.push(`${relativePath} ${C.dim}(${err.message})${C.reset}`);
      }
    } else if (stat.isDirectory()) problems.push(`${relativePath} ${C.dim}(a folder with this name already exists)${C.reset}`);
    else if (isSameFile(destPath, copyData)) present.push(relativePath);
    else if (kind) toMerge.push({content, destPath, relativePath, kind});
    else if (mergedInto.has(relativePath)) present.push(relativePath);
    else skipped.push(relativePath);
  }

  return {copied, present, skipped, toMerge};
};

const UNIT = {blocks: 'line', env: 'environment variable', json: 'key'};

const mergeFiles = (toMerge, problems, root, addonName) => {
  const merged = [], failed = [], unchanged = [];
  const recorded = mergedFiles(root, addonName);

  for (const {content, destPath, relativePath, kind} of toMerge) {
    line();
    info(relativePath);
    if (recorded.has(relativePath)) {
      info('Add-on code was already added');
      unchanged.push(relativePath);
      continue;
    }

    try {
      const result = mergeFile(kind, normalizeEol(fs.readFileSync(destPath, 'utf8')), content);

      for (const name of result.missing) {
        warn(`Placeholder not found, code not added: ${styled(`@addon-placeholder:${name}`, C.dim)}`);
        problems.push(`${relativePath} ${C.dim}(placeholder not found: @addon-placeholder:${name})${C.reset}`);
      }
      if (result.missing.length) continue;

      if (result.added) {
        fs.writeFileSync(destPath, result.content, 'utf8');
        // Recorded right after each write, so an install that gets interrupted never adds a block twice on the next run.
        if (kind === 'blocks') recordMergedFiles(root, addonName, recorded.add(relativePath));
        success(`Added ${plural(result.added, UNIT[kind])}`);
        merged.push(relativePath);
      } else {
        info('Content already exists');
        unchanged.push(relativePath);
      }
    } catch (err) {
      error(`Error: ${err.message}`);
      failed.push(relativePath);
      problems.push(`${relativePath} ${C.dim}(${err.message})${C.reset}`);
    }
  }

  return {merged, failed, unchanged};
};

const installAddon = async (addonName, context, chain = []) => {
  const {root, version, local, tests, addons, installed, problems, replacements} = context;
  if (installed.has(addonName)) return;
  if (chain.includes(addonName)) throw new CliError(`Circular add-on dependency detected: ${[...chain, addonName].join(' → ')}`);
  chain = [...chain, addonName];

  installBox(addonName, version);
  line();
  const source = addonSource(version, addonName, local);
  task(source.local ? `💻 Reading local ${C.cyan}${addonName}${C.reset} add-on files...` : `📦 Downloading ${C.cyan}${addonName}${C.reset} add-on...`);
  const entries = (await readRelease(source)).filter(entry => tests || !isFrameworkTest(entry.path)).map(entry => ({...entry, data: applyPlaceholders(entry.data, replacements)}));

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

  const {copied, present, skipped, toMerge} = processAddonFiles(entries, root, problems);

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
    info(`Skipped ${plural(skipped.length, 'existing file')} with different content and nothing to merge:`);
    for (const file of skipped) item(file, true);
  }

  if (toMerge.length) {
    line();
    task('🔀 Merging existing files...');
    const {merged, failed, unchanged} = mergeFiles(toMerge, problems, root, addonName);
    divider();
    if (merged.length) success(`Merged ${plural(merged.length, 'file')}`);
    if (unchanged.length) info(`${plural(unchanged.length, 'file')} unchanged (add-on code already there)`);
    if (failed.length) warn(`${plural(failed.length, 'file')} failed to merge`);
  }

  const envExample = entries.find(entry => entry.path === 'src/.env.example');
  if (envExample) {
    const env = syncEnv(root, {}, {example: envExample.data.toString('utf8')});
    if (env.added || env.keyGenerated) line();
    if (env.added) success(`Added ${plural(env.added, 'environment variable')} to ${C.cyan}src/.env${C.reset}`);
    if (env.keyGenerated) success(`Generated ${C.cyan}APP_KEY${C.reset} in ${C.cyan}src/.env${C.reset}`);
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
  await installAddon(addonName, {root, version, local: values.local, tests: config.tests === true, addons, installed, problems, replacements});

  if (problems.length) {
    divider();
    warn(`${plural(problems.length, 'merge problem')}, add-on code is missing from:`, true);
    for (const problem of problems) item(problem);
    line();
    info(`Restore the missing files or placeholder lines, then run simpl add ${addonName} again to finish.`);
    line();
    return 1;
  }

  line();
  success(styled('Installation complete!', C.bold, C.green), true);
  line();
};

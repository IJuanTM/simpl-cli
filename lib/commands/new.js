import fs from 'node:fs';
import path from 'node:path';
import {closestMatch, parseFlags} from '../args.js';
import {applyPlaceholders, placeholders} from '../project.js';
import {coreSource, getLatestVersion, getVersions, isUnsupportedVersion, readRelease, unsupportedVersion} from '../releases.js';
import {ask, C, CliError, confirmSuggestion, divider, error, heading, installBox, interactive, item, line, plural, printAnswer, row, styled, success, task, titleBox} from '../ui.js';

const options = {
  name: {type: 'string', short: 'n'},
  url: {type: 'string', short: 'u'},
  version: {type: 'string', short: 'v'},
  local: {type: 'boolean'},
  'list-versions': {type: 'boolean'},
  help: {type: 'boolean', short: 'h'},
};

export const help = () => {
  titleBox('Create a new project');
  line();
  heading('Usage:');
  row('simpl new [name] [options]', 'Alias: simpl install');
  line();
  heading('Options:');
  row('--name, -n <name>', 'Project name (also accepted as the first argument)');
  row('--url, -u <url>', 'App URL, must start with http:// or https://');
  row('--version, -v <version>', 'Framework version, or latest for the newest release');
  row('--local', 'Only use local release files (SIMPL_LOCAL_RELEASES)');
  row('--list-versions', 'List all available versions');
  row('--help, -h', 'Show this help message');
  line();
  heading('Examples:');
  row('simpl new');
  row('simpl new "My Project" --url=http://my-project.local');
  row('simpl new --version=latest --name="Simpl Test"');
  line();
};

const printVersionList = (versions) => {
  line();
  heading('Available versions:');
  for (const [v, meta] of Object.entries(versions)) item(
    (meta['is-latest'] ? styled(v, C.bold) + ' ' + styled('(latest)', C.green) : styled(v, C.dim))
    + (meta['is-pre-release'] ? ' ' + styled('(pre-release)', C.yellow) : ''),
  );
};

const resolveVersionInput = (versions, input) => {
  const value = String(input || '').trim();
  if (value.toLowerCase() === 'latest') return getLatestVersion(versions);
  return versions[value] ? value : null;
};

const resolveVersion = async (versions, preset) => {
  const suggestionOptions = [...Object.keys(versions), 'latest'];
  let input = preset;

  while (true) {
    input ??= interactive ? await ask('Simpl version', 'latest') : 'latest';
    if (isUnsupportedVersion(input)) {
      if (!interactive) throw unsupportedVersion(input);
      line();
      error(unsupportedVersion(input).message);
      line();
      input = preset = null;
      continue;
    }
    const version = resolveVersionInput(versions, input);
    if (version) {
      if (preset || !interactive) printAnswer('Simpl version', version);
      return version;
    }

    line();
    error(`Version ${styled(input, C.bold)} not found`);
    const suggestion = closestMatch(input, suggestionOptions);
    if (suggestion && await confirmSuggestion(suggestion)) {
      const suggested = resolveVersionInput(versions, suggestion);
      line();
      printAnswer('Simpl version', suggested);
      return suggested;
    }
    printVersionList(versions);
    if (!interactive) throw new CliError('Pass one of the versions above with --version');
    line();
    input = preset = null;
  }
};

const projectNameToSlug = (name = '') => name.trim().toLowerCase().replace(/[\s_]+/g, '-');

const validateProjectName = (name) => {
  if (!name?.trim()) return 'Project name cannot be empty';
  if (!/^[a-zA-Z0-9 _-]+$/.test(name)) return 'Project name can only contain letters, numbers, spaces, hyphens, and underscores';
  return fs.existsSync(projectNameToSlug(name)) ? `Directory "${projectNameToSlug(name)}" already exists` : null;
};

const validateUrl = (url) => {
  const trimmed = url?.trim().replace(/\/+$/, '');
  if (!trimmed) return {error: 'URL cannot be empty'};
  return /^https?:\/\/.+/.test(trimmed) ? {url: trimmed} : {error: 'URL must start with http:// or https://'};
};

const resolveProjectName = async (preset) => {
  if (preset) {
    const err = validateProjectName(preset);
    if (err) throw new CliError(err);
    printAnswer('Project name', preset);
    return preset;
  }
  if (!interactive) throw new CliError('Project name is required', 'Pass it as the first argument or with --name.');
  while (true) {
    const name = await ask('Project name');
    const err = validateProjectName(name);
    if (!err) return name;
    error(err);
    line();
  }
};

const resolveAppUrl = async (preset, projectName) => {
  if (preset) {
    const {url, error: err} = validateUrl(preset);
    if (url) {
      printAnswer('App URL', url);
      return url;
    }
    if (!interactive) throw new CliError(`Invalid URL: ${err}`);
    line();
    error(`Invalid URL: ${err}`);
    line();
  }
  const slug = projectNameToSlug(projectName);
  while (true) {
    const {url, error: err} = validateUrl(await ask('App URL', `http://${slug}.local`));
    if (url) return url;
    if (!interactive) throw new CliError(`Invalid URL: ${err}`);
    error(err);
    line();
  }
};

const printGettingStarted = (folder) => {
  divider();
  heading('Getting started:');
  item(`Go to the project: ${C.dim}cd ${folder}${C.reset}`);
  item(`Install JS dependencies and build the assets: ${C.dim}npm install${C.reset}`);
  item(`Start the Docker stack: ${C.dim}simpl up${C.reset} ${C.dim}(served at https://localhost/)${C.reset}`);
  item(`Watch and live-reload while developing: ${C.dim}npm run dev${C.reset}`);
  line();
  heading('Add-ons:');
  item(`Install one: ${C.dim}simpl add <name>${C.reset}`);
  item(`List them: ${C.dim}simpl add --list${C.reset}`);
  line();
  heading('Not using Docker?');
  item(`Use your own local server ${C.dim}(e.g. WAMP or XAMPP)${C.reset}, see ${C.dim}simpl help manual${C.reset}`);
};

export const run = async (args) => {
  const {values, positionals} = parseFlags(args, options);
  if (values.help) return help();

  if (values['list-versions']) {
    titleBox('Available versions');
    line();
    task(values.local ? '💻 Reading local releases...' : '📦 Fetching available versions...');
    printVersionList(await getVersions(values.local));
    line();
    return;
  }

  titleBox('Create a new project');
  line();
  task(values.local ? '💻 Reading local releases...' : '📦 Fetching available versions...');
  const versions = await getVersions(values.local);
  line();
  const version = await resolveVersion(versions, values.version);

  const projectName = await resolveProjectName(values.name || positionals.join(' '));
  const appUrl = await resolveAppUrl(values.url, projectName);
  const folder = projectNameToSlug(projectName);
  const targetDir = path.join(process.cwd(), folder);

  installBox(projectName, version);
  line();
  const source = coreSource(version, values.local);
  task(source.local ? '💻 Reading local release files...' : '📦 Downloading files...');
  const entries = await readRelease(source);

  line();
  task('⚙️ Configuring project...');
  const replacements = placeholders(projectName, appUrl);
  for (const {path: entryPath, data, mode} of entries) {
    const dest = path.join(targetDir, ...entryPath.split('/'));
    fs.mkdirSync(path.dirname(dest), {recursive: true});
    fs.writeFileSync(dest, applyPlaceholders(data, replacements), mode ? {mode} : undefined);
  }

  line();
  success(`Created ${plural(entries.length, 'file')} in ${C.cyan}${folder}${C.reset}`);
  success(`Configured ${C.cyan}${projectName}${C.reset} with URL ${C.cyan}${appUrl}${C.reset}`);
  printGettingStarted(folder);
  line();
  success(styled('Installation complete!', C.bold, C.green), true);
  line();
};

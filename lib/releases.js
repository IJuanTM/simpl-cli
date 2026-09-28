import fs from 'node:fs';
import path from 'node:path';
import {CliError} from './ui.js';
import {readZip} from './zip.js';

export const CDN_BASE = 'https://cdn.simpl.iwanvanderwal.nl/framework';
const VERSIONS_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 120_000;

const MIN_MAJOR = 2;

export const isUnsupportedVersion = (version) => Number.parseInt(version, 10) < MIN_MAJOR;

export const unsupportedVersion = (version) => new CliError(`Simpl ${version} is not supported`, `This CLI only works with Simpl ${MIN_MAJOR}.0.0 and newer.`);

export const localReleasesDir = () => process.env.SIMPL_LOCAL_RELEASES || path.join(process.cwd(), 'simpl-local-releases');

const cdnUnreachable = () => new CliError('The CDN server is currently unreachable', 'Please try again later.');

// The body is read inside the try too, since the timeout can also fire mid-download.
const download = async (url, timeout) => {
  let res, body;
  try {
    res = await fetch(url, {signal: AbortSignal.timeout(timeout)});
    if (res.ok) body = Buffer.from(await res.arrayBuffer());
  } catch {
    throw cdnUnreachable();
  }
  if (!res.ok) throw new CliError(`Download failed: HTTP ${res.status} for ${url}`);
  return body;
};

const readLocalVersions = () => {
  const dir = localReleasesDir();
  const names = fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes: true}).filter(e => e.isDirectory()).map(e => e.name) : [];
  if (!names.length) throw new CliError(`No local releases found in ${dir}`, 'Set SIMPL_LOCAL_RELEASES to the folder that holds <version>/core.zip.');
  const isPreRelease = (name) => name.includes('-');
  names.sort((a, b) => b.split('-')[0].localeCompare(a.split('-')[0], undefined, {numeric: true}) || isPreRelease(a) - isPreRelease(b) || b.localeCompare(a, undefined, {numeric: true}));
  const latest = names.find(name => !isPreRelease(name)) ?? names[0];
  return Object.fromEntries(names.map(name => [name, {'is-latest': name === latest, 'is-pre-release': isPreRelease(name)}]));
};

export const getVersions = async (local) => {
  if (local) return readLocalVersions();
  const body = await download(`${CDN_BASE}/versions.json`, VERSIONS_TIMEOUT_MS);
  let versions;
  try {
    ({versions} = JSON.parse(body));
  } catch {
    throw new CliError('The CDN returned an invalid versions list');
  }
  if (!versions || !Object.keys(versions).length) throw new CliError('The CDN returned no versions');
  return versions;
};

export const getLatestVersion = (versions) => Object.entries(versions).find(([, meta]) => meta['is-latest'] === true)?.[0] ?? Object.keys(versions)[0];

const releaseSource = (segments, local) => {
  if (!local) return {local: false, location: `${CDN_BASE}/${segments.join('/')}`};
  const localZip = path.join(localReleasesDir(), ...segments);
  if (!fs.existsSync(localZip)) throw new CliError(`Missing in the local releases folder: ${localZip}`);
  return {local: true, location: localZip};
};

export const coreSource = (version, local) => releaseSource([version, 'core.zip'], local);

export const addonSource = (version, name, local) => releaseSource([version, 'add-ons', `${name}.zip`], local);

// A NUL byte marks a binary file (git's own heuristic), which must not be touched.
const toLf = (data) => data.includes(0) || !data.includes('\r\n') ? data : Buffer.from(data.filter((byte, i) => byte !== 13 || data[i + 1] !== 10));

export const readRelease = async ({local, location}) => readZip(local ? fs.readFileSync(location) : await download(location, DOWNLOAD_TIMEOUT_MS))
  .map(entry => ({...entry, data: toLf(entry.data)}));

export const getAvailableAddons = (versions, version, local) => {
  if (!local) return [...versions[version]?.['add-ons'] || []].sort();
  const localAddonsDir = path.join(localReleasesDir(), version, 'add-ons');
  if (!fs.existsSync(localAddonsDir)) return [];
  return fs.readdirSync(localAddonsDir, {withFileTypes: true})
    .filter(e => e.isFile() && e.name.endsWith('.zip'))
    .map(e => e.name.slice(0, -4))
    .sort();
};

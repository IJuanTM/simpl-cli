import {parseArgs} from 'node:util';
import {CliError, didYouMean} from './ui.js';

const editDistance = (a, b) => {
  const m = a.length, n = b.length;
  const dp = Array.from({length: m + 1}, (_, i) => Array.from({length: n + 1}, (_, j) => i === 0 ? j : j === 0 ? i : 0));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
  }
  return dp[m][n];
};

export const closestMatch = (input, options) => {
  let best = null, bestDist = Infinity;
  for (const opt of options) {
    const dist = editDistance(input.toLowerCase(), opt.toLowerCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = opt;
    }
  }
  return bestDist <= Math.max(1, Math.floor(input.length / 3)) ? best : null;
};

const flagName = (key) => key.length === 1 ? `-${key}` : `--${key}`;

// Non-strict so unknown flags can get a "did you mean" hint instead of parseArgs' generic error.
export const parseFlags = (args, options) => {
  const {values, positionals} = parseArgs({args, options, strict: false, allowPositionals: true});

  for (const [key, value] of Object.entries(values)) {
    if (!Object.hasOwn(options, key)) {
      const suggestion = closestMatch(flagName(key), Object.entries(options).flatMap(([name, {short}]) => short ? [`--${name}`, `-${short}`] : [`--${name}`]));
      throw new CliError(`Unknown option: ${flagName(key)}`, ...suggestion ? [didYouMean(suggestion)] : [], 'Run with --help to see all available options.');
    }
    if (options[key].type !== 'string') continue;
    if (value === true || value.startsWith('-')) throw new CliError(`Option --${key} needs a value`);
    values[key] = value.trim();
  }

  return {values, positionals};
};

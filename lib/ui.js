import {createInterface} from 'node:readline/promises';

const CODES = {
  reset: '\x1b[0m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m',
  cyan: '\x1b[36m', blue: '\x1b[34m', gray: '\x1b[90m', bold: '\x1b[1m', dim: '\x1b[2m',
};

export const C = Object.fromEntries(Object.entries(CODES).map(([name, code]) => [name, process.stdout.hasColors?.() ? code : '']));

const BOX_WIDTH = 62;
export const PAD = '  ';

export const interactive = Boolean(process.stdin.isTTY);

export class CliError extends Error {
  constructor(message, ...hints) {
    super(message);
    this.hints = hints;
  }
}

export const styled = (msg, ...styles) => styles.join('') + msg + C.reset;
export const line = (msg = '') => console.log(msg);
export const out = (msg, color = C.reset) => console.log(color + msg + C.reset);
const prefixed = (symbol, color, msg, bold = false, dim = false) => out(PAD + color + symbol + C.reset + ' ' + (bold ? styled(msg, C.bold) : dim ? styled(msg, C.dim) : msg));

export const success = (msg, bold = false) => prefixed('✓', C.green, msg, bold);
export const error = (msg, bold = false) => prefixed('✕', C.red, msg, bold);
export const warn = (msg, bold = false) => prefixed('⚠', C.yellow, msg, bold);
export const info = (msg) => prefixed('◌', C.cyan, msg, false, true);
export const task = (msg) => out(PAD + msg);
export const item = (msg, dim = false) => out(PAD + C.cyan + '•' + C.reset + ' ' + (dim ? styled(msg, C.dim) : msg));
export const heading = (msg) => out(PAD + styled(msg, C.bold), C.blue);
export const plural = (count, word) => `${styled(String(count), C.bold)} ${word}${count !== 1 ? 's' : ''}`;

export const row = (left, right = '') => out(PAD + styled(right ? left.padEnd(30) : left, C.dim) + right);

export const box = (title) => {
  const parts = title.split(/(\x1b\[[0-9;]*m)/);
  const length = parts.reduce((sum, part, i) => i % 2 ? sum : sum + part.length, 0);
  let displayTitle = title, remaining = BOX_WIDTH - 5;
  if (length > BOX_WIDTH - 2) displayTitle = parts.map((part, i) => {
    if (i % 2) return part;
    const kept = part.slice(0, remaining);
    remaining -= kept.length;
    return kept;
  }).join('') + '...';
  const spaces = ' '.repeat(Math.max(0, BOX_WIDTH - 2 - length));
  line();
  out(PAD + '╭' + '─'.repeat(BOX_WIDTH) + '╮');
  out(PAD + '│ ' + styled(displayTitle, C.bold) + spaces + ' │');
  out(PAD + '╰' + '─'.repeat(BOX_WIDTH) + '╯');
};

export const installBox = (name, version) => box(`Installing: ${C.cyan}${name}${C.reset} ${C.dim}(v${version})${C.reset}`);

export const titleBox = (title, detail) => box(`Simpl ${C.dim}-${C.reset} ${C.blue}${title}${C.reset}` + (detail ? ` ${C.dim}(${detail})${C.reset}` : ''));

export const divider = () => {
  line();
  out(PAD + '─'.repeat(16), C.dim);
  line();
};

export const printAnswer = (question, value) => out(`${PAD}${question}: ${C.cyan}${value}${C.reset}`);

// Without a TTY there is nobody to answer, so the default is taken (and echoed) instead of waiting on stdin.
export const ask = async (question, defaultValue = '', hint = defaultValue) => {
  if (!interactive) {
    if (defaultValue) printAnswer(question, defaultValue);
    return defaultValue;
  }
  const rl = createInterface({input: process.stdin, output: process.stdout});
  try {
    return (await rl.question(`${PAD}${question}${hint ? ` ${C.dim}(${hint})${C.reset}` : ''}: `)).trim() || defaultValue;
  } finally {
    rl.close();
  }
};

export const confirm = async (question, defaultYes = false) => {
  line();
  while (true) {
    const answer = (await ask(question, defaultYes ? 'yes' : 'no', defaultYes ? 'Y/n' : 'y/N')).toLowerCase();
    if (['y', 'yes'].includes(answer)) return true;
    if (['n', 'no'].includes(answer)) return false;
    warn('Please answer [Y] Yes or [N] No');
    line();
  }
};

export const didYouMean = (suggestion) => `${C.dim}Did you mean${C.reset} ${C.cyan}${suggestion}${C.reset}${C.dim}?${C.reset}`;

export const confirmSuggestion = async (suggestion) => {
  if (interactive) return confirm(`${C.cyan}◌${C.reset} ${didYouMean(suggestion)}`);
  info(didYouMean(suggestion));
  return false;
};

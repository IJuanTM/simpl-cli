#!/usr/bin/env node
import pkg from '../package.json' with {type: 'json'};
import * as add from '../lib/commands/add.js';
import {composer, composerScript, SHORTCUTS} from '../lib/commands/composer.js';
import {down, logs, sh, up} from '../lib/commands/docker.js';
import * as help from '../lib/commands/help.js';
import * as newProject from '../lib/commands/new.js';
import {closestMatch} from '../lib/args.js';
import {CliError, didYouMean, error, info, line} from '../lib/ui.js';

const topicHelp = {
  manual: help.manual,
  new: newProject.help, install: newProject.help,
  add: add.help, 'add-on': add.help, addon: add.help,
};

const commands = {
  new: newProject.run, install: newProject.run,
  add: add.run, 'add-on': add.run, addon: add.run,
  up, down, logs, sh, composer,
  help: ([topic]) => {
    if (!topic) return help.general(pkg.version);
    if (!Object.hasOwn(topicHelp, topic)) throw new CliError(`Unknown help topic: ${topic}`, 'Topics: manual, new, add.');
    return topicHelp[topic]();
  },
  ...Object.fromEntries(SHORTCUTS.map(script => [script, args => composerScript(script, args)])),
};

const [name, ...args] = process.argv.slice(2);

try {
  if (!name || name === '--help' || name === '-h') help.general(pkg.version);
  else if (name === '--version' || name === '-v') console.log(pkg.version);
  else if (!Object.hasOwn(commands, name)) {
    const suggestion = closestMatch(name, Object.keys(commands));
    throw new CliError(`Unknown command: ${name}`, ...suggestion ? [didYouMean(`simpl ${suggestion}`)] : [], 'Run simpl help to see all commands.');
  } else {
    const code = await commands[name](args);
    if (typeof code === 'number') process.exitCode = code;
  }
} catch (err) {
  line();
  if (err.name === 'AbortError') {
    info('Cancelled');
    process.exitCode = 130;
  } else {
    error(err.message);
    for (const hint of err.hints ?? []) info(hint);
    process.exitCode = 1;
  }
  line();
}

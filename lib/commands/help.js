import {C, heading, item, line, out, PAD, row, titleBox} from '../ui.js';
import {SHORTCUTS} from './composer.js';

export const general = (version) => {
  titleBox('CLI', `v${version}`);
  line();
  heading('Projects:');
  row('simpl new [name]', 'Create a new project (alias: install)');
  row('simpl add [add-on]', 'Install an add-on (aliases: add-on, addon)');
  line();
  heading('Docker:');
  row('simpl up', 'Build and start the Docker stack');
  row('simpl down', 'Stop the Docker stack');
  row('simpl logs', 'Show container logs, e.g. simpl logs -f app');
  row('simpl sh', 'Open a shell in the app container');
  line();
  heading('Composer:');
  row('simpl composer <args>', 'Run Composer, in the app container if the stack is up');
  row('simpl <script> [args]', 'Run a Composer script, one of:');
  for (const group of Object.values(Object.groupBy(SHORTCUTS, script => script.split(':')[0]))) row('', group.join(', '));
  line();
  heading('More:');
  row('simpl <command> --help', 'Options for new and add');
  row('simpl help manual', 'Set up a project without Docker');
  row('simpl --version', 'Show the CLI version');
  line();
};

export const manual = () => {
  titleBox('Manual setup', 'without Docker');
  line();
  out(PAD + 'Docker is the default, but any local server that runs PHP and Apache works too.');
  line();
  heading('Requirements:');
  item(`PHP and Composer ${C.dim}(see the Simpl README for the required versions)${C.reset}`);
  item('A local web server with PHP and Apache, e.g. WAMP or XAMPP');
  line();
  heading('Steps:');
  item(`Install PHP dependencies: ${C.dim}composer install${C.reset}`);
  item(`Install JS dependencies and build the assets: ${C.dim}npm install${C.reset}`);
  item(`Point a virtual host for your ${C.dim}APP_URL${C.reset} at the project's ${C.dim}src/public${C.reset} folder`);
  item(`Watch and live-reload while developing: ${C.dim}npm run dev${C.reset}`);
  line();
  heading('Note:');
  item(`${C.dim}simpl composer${C.reset}, ${C.dim}simpl migrate${C.reset} etc. use this machine's Composer when Docker isn't running.`);
  line();
};

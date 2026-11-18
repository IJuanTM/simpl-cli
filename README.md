# Simpl CLI

Command-line tool for the [Simpl](https://simpl.iwanvanderwal.nl/) PHP framework. Creates new projects, installs add-ons and gives you short commands for the Docker development stack.

Replaces `@ijuantm/simpl-install` and `@ijuantm/simpl-addon`.

## Installation

```bash
npm install -g @ijuantm/simpl
```

Or run it once without installing:

```bash
npx @ijuantm/simpl new
```

## Commands

| Command                 | Description                                                                                |
|-------------------------|--------------------------------------------------------------------------------------------|
| `simpl new [name]`      | Create a new project in a new folder (alias: `simpl install`).                             |
| `simpl add [add-on]`    | Install an add-on into the current project (aliases: `simpl add-on`, `simpl addon`).       |
| `simpl env`             | Create `src/.env` from `src/.env.example`, or add the variables it is missing.             |
| `simpl up`              | Build and start the Docker stack (`build --pull`, then `up -d`), then list its URLs.       |
| `simpl urls`            | Show the URLs and ports of the running services (site, phpMyAdmin, Mailpit, database).     |
| `simpl down`            | Stop the Docker stack (`docker compose down`).                                             |
| `simpl logs`            | Show container logs (`docker compose logs`), e.g. `simpl logs -f app`.                     |
| `simpl sh`              | Open a shell in the app container, as the same user Apache runs as.                        |
| `simpl composer <args>` | Run Composer in the app container, or on this machine when the Docker stack isn't running. |
| `simpl <script> [args]` | Shortcut for `simpl composer <script> -- [args]`. See the list below.                      |
| `simpl help [topic]`    | Show help. `simpl help manual` explains how to run a project without Docker.               |

Extra arguments to `up`, `down` and `logs` are passed on to `docker compose`.

Composer shortcuts: `migrate`, `migrate:fresh`, `migrate:rollback`, `seed`, `seed:fresh`, `test`, `test:integration`, `stan`. Arguments after the script name go to the script itself, so `simpl test --filter UserTest` runs `composer test -- --filter UserTest`. The `migrate` and `seed` scripts come with the `db` add-on.

Every command except `new` works from any folder inside a project, found by walking up to the nearest `.simpl` file. `up`, `add` and the Composer shortcuts (except `stan`) need the project's `src/.env` and stop with a hint to run `simpl env` when it is missing.

### `simpl new`

```bash
simpl new
simpl new "My Project" --url=http://my-project.local
simpl new --version=latest --name="Simpl Test"
simpl new "My Project" --tests
simpl new --list-versions
```

| Option                | Description                                                  |
|-----------------------|--------------------------------------------------------------|
| `--name`, `-n <name>` | Project name (also accepted as the first argument).          |
| `--url`, `-u <url>`   | App URL, must start with `http://` or `https://`.            |
| `--version`, `-v <v>` | Framework version, or `latest` for the newest release.       |
| `--tests`             | Include Simpl's own tests, also for add-ons installed later. |
| `--local`             | Only use local release files (see below).                    |
| `--list-versions`     | List all available versions.                                 |

The project gets a `src/.env` copied from `src/.env.example`, with `APP_NAME` and `APP_URL` set to the project name and URL.

Every project gets the PHPUnit setup, the test helpers and an `ExampleTest.php` per test suite, so `simpl test` works right away. Simpl's own test classes (every other `*Test.php` under `tests/`) are only installed with `--tests`, which adds `"tests": true` to the project's `.simpl` file.

### `simpl add`

```bash
simpl add
simpl add auth
simpl add --list
```

| Option         | Description                                  |
|----------------|----------------------------------------------|
| `--list`, `-l` | List the add-ons available for this project. |
| `--local`      | Only use local release files (see below).    |

The add-on version always matches the framework version in the project's `.simpl` file. Add-ons that depend on another add-on offer to install that one first. An add-on's own tests are installed when that file has `"tests": true`, which `simpl new --tests` sets.

Files that don't exist in the project yet are copied. A file that already exists is merged when the add-on's copy holds blocks for it, and skipped otherwise. A block is the lines between an `@addon-insert:<name>` line and the next `@addon-end` line:

```php
// @addon-insert:controllers
new AuthController();
// @addon-end
```

The project's file marks where a block goes with a line containing `@addon-placeholder:<name>`, in whatever comment style the file uses:

```php
new SessionController();
// @addon-placeholder:controllers
```

The block's lines are added above the placeholder line, at its indentation. The placeholder stays in the file, so every add-on that has a block for it adds its lines there. A name is made of letters, digits, hyphens and underscores. The name `append` needs no placeholder: `@addon-insert:append` adds the block to the end of the file.

A `.json` file is merged by key instead: keys the project's file doesn't have yet are added, at any depth, and values it already has are kept. An add-on's `src/.env.example` is merged into the project's `src/.env.example`, adding only variables that aren't defined yet, and those variables are then added to `src/.env` as well, with an empty `APP_KEY` generated.

If a placeholder can't be found, none of the add-on's blocks for that file are added: the install still finishes, lists the affected files at the end and exits with code 1. The add-on is then not listed under `addons` in `.simpl`, so running the same command again after restoring the placeholder finishes the install. The files an add-on has added its blocks to are listed under `merged` in `.simpl`, and a repeated install leaves those files alone. Remove a path from that list to have its blocks added again, for example after restoring the file to an older version.

### `simpl env`

```bash
simpl env
simpl env --key
```

| Option    | Description                                  |
|-----------|----------------------------------------------|
| `--key`   | Generate a new `APP_KEY`.                    |
| `--force` | Recreate `src/.env` from `src/.env.example`. |

Without a `src/.env` (e.g. right after cloning a project), it copies `src/.env.example` and asks for the app name and URL. With one, it adds the variables from `src/.env.example` that `src/.env` doesn't define yet and never changes an existing value, but still asks for the app name or URL when it is empty. An empty `APP_KEY` is generated either way. `--key` and `--force` ask for confirmation first, since a new key makes data encrypted with the old one unreadable and `--force` replaces every value you set.

### Docker or your own local server

Docker is the default: `simpl up` serves the project and `simpl composer`, `simpl migrate` etc. run inside the container, so you don't need PHP or Composer on your machine. If you'd rather use a local server of your own (e.g. WAMP or XAMPP), see `simpl help manual`. The Composer commands then use the Composer installed on your machine automatically, whenever the project's Docker stack isn't running.

## Local release files

`--local` installs from zip files on disk instead of downloading them, using this layout:

```
<releases>/<version>/core.zip
<releases>/<version>/add-ons/<name>.zip
```

`<releases>` is the `SIMPL_LOCAL_RELEASES` environment variable, or `simpl-local-releases` in the current folder. With `--local` the CDN is never contacted: the versions are the folders in `<releases>` (`latest` is the highest one that isn't a pre-release, which is a version ending in `a` or `b`, e.g. `2.1.0a`), and a missing zip is reported as missing from that folder. Without `--local`, everything comes from the CDN.

## Scripting

When input isn't an interactive terminal (CI, piped input), nothing is prompted. Defaults are used where there is one, dependency add-ons are installed automatically, and anything required but missing or invalid makes the command fail with exit code 1. Exit codes of Docker and Composer commands are passed through unchanged.

## Requirements

- **Node.js** >= 24
- **Docker** with Compose v2 for `up`, `down`, `logs` and `sh`

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
| `simpl up`              | Build and start the Docker stack (`docker compose up -d --build`).                         |
| `simpl down`            | Stop the Docker stack (`docker compose down`).                                             |
| `simpl logs`            | Show container logs (`docker compose logs`), e.g. `simpl logs -f app`.                     |
| `simpl sh`              | Open a shell in the app container, as the same user Apache runs as.                        |
| `simpl composer <args>` | Run Composer in the app container, or on this machine when the Docker stack isn't running. |
| `simpl <script> [args]` | Shortcut for `simpl composer <script> -- [args]`. See the list below.                      |
| `simpl help [topic]`    | Show help. `simpl help manual` explains how to run a project without Docker.               |

Extra arguments to `up`, `down` and `logs` are passed on to `docker compose`.

Composer shortcuts: `migrate`, `migrate:fresh`, `migrate:rollback`, `seed`, `seed:fresh`, `test`, `test:integration`, `stan`. Arguments after the script name go to the script itself, so `simpl test --filter UserTest` runs `composer test -- --filter UserTest`. The `migrate` and `seed` scripts come with the `db` add-on.

Every command except `new` works from any folder inside a project, found by walking up to the nearest `.simpl` file.

### `simpl new`

```bash
simpl new
simpl new "My Project" --url=http://my-project.local
simpl new --version=latest --name="Simpl Test"
simpl new --list-versions
```

| Option                | Description                                            |
|-----------------------|--------------------------------------------------------|
| `--name`, `-n <name>` | Project name (also accepted as the first argument).    |
| `--url`, `-u <url>`   | App URL, must start with `http://` or `https://`.      |
| `--version`, `-v <v>` | Framework version, or `latest` for the newest release. |
| `--local`             | Only use local release files (see below).              |
| `--list-versions`     | List all available versions.                           |

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

The add-on version always matches the framework version in the project's `.simpl` file. Add-ons that depend on another add-on offer to install that one first.

Files that don't exist in the project yet are copied. Existing files are merged using the markers in the add-on's copy of the file, and are skipped if it has none:

```php
// @addon-insert:after('existing line')
new AuthController();
// @addon-end
```

| Marker                          | Effect                                          |
|---------------------------------|-------------------------------------------------|
| `@addon-insert:after('text')`   | Insert after the first line containing `text`.  |
| `@addon-insert:before('text')`  | Insert before the first line containing `text`. |
| `@addon-insert:replace('text')` | Replace the first line containing `text`.       |
| `@addon-insert:prepend`         | Add to the start of the file.                   |
| `@addon-insert:append`          | Add to the end of the file.                     |

Content that is already present is not added again, so re-running an install is safe. For `.env` files only variables that aren't defined yet are added. If the line a marker points to can't be found, that part is not added: the install still finishes, lists the affected files at the end and exits with code 1. The add-on is then not marked as installed in `.simpl`, so running the same command again after fixing those files finishes the install, skipping everything that was already added.

### Docker or your own local server

Docker is the default: `simpl up` serves the project and `simpl composer`, `simpl migrate` etc. run inside the container, so you don't need PHP or Composer on your machine. If you'd rather use a local server of your own (e.g. WAMP or XAMPP), see `simpl help manual`. The Composer commands then use the Composer installed on your machine automatically, whenever the project's Docker stack isn't running.

## Local release files

`--local` installs from zip files on disk instead of downloading them, using this layout:

```
<releases>/<version>/core.zip
<releases>/<version>/add-ons/<name>.zip
```

`<releases>` is the `SIMPL_LOCAL_RELEASES` environment variable, or `simpl-local-releases` in the current folder. With `--local` the CDN is never contacted: the versions are the folders in `<releases>` (`latest` is the highest one that isn't a pre-release), and a missing zip is reported as missing from that folder. Without `--local`, everything comes from the CDN.

## Scripting

When input isn't an interactive terminal (CI, piped input), nothing is prompted. Defaults are used where there is one, dependency add-ons are installed automatically, and anything required but missing or invalid makes the command fail with exit code 1. Exit codes of Docker and Composer commands are passed through unchanged.

## Requirements

- **Node.js** >= 24
- **Docker** with Compose v2 for `up`, `down`, `logs` and `sh`

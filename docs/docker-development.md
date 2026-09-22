# Docker development

**Player delivery:** the planned [local launcher and browser Web UI](superpowers/plans/2026-09-13-local-web-ui-delivery.md) does not require players to install Docker. The Compose workflow below is development infrastructure, not the native file-operation service or the player distribution.

Docker provides a Linux environment for the existing installer browser demo,
TypeScript tests, type checking and static frontend builds. The image uses the
official `node:22.23.2-bookworm-slim` tag, with Linux dependencies installed by
`npm ci` from the repository lockfile. Application processes run as the image's
unprivileged `node` user.

This environment does not build or execute the Windows installer, PowerShell
engine, WebView2 or real-game acceptance. Docker is a development tool, not an
end-user requirement. There is no website service yet; add it when the website
workspace exists.

## Prerequisites

- A running Docker engine using Linux containers, Docker Compose v2 and BuildKit
  with the local output exporter. Docker Desktop supplies these on macOS and
  Windows; a Linux engine with the Compose and Buildx plugins also works.
- Internet access for the first image pull and dependency installation.
- Run commands from the repository root. Host Node/npm is optional: every npm
  alias below has an equivalent direct Docker command.

The pinned image has both amd64 and arm64 variants, so Apple Silicon does not
need an emulated Windows or amd64 environment. The exact version tag is pinned;
the base OS image can receive rebuilt security fixes under that tag.

## Start and stop the browser demo

```sh
npm run docker:config
npm run docker:dev
```

Without host Node/npm:

```sh
docker compose config --quiet
docker compose up --build --renew-anon-volumes installer
```

Open <http://127.0.0.1:5173/installer.html>. The preview uses the existing demo
bridge. It does not touch game files. Vite listens on `0.0.0.0` inside its
container, while the published host port is restricted to `127.0.0.1`.

The default port is 5173. To avoid another local Vite server, on macOS/Linux use:

```sh
AIMLOOM_DEV_PORT=5174 npm run docker:dev
```

In PowerShell, set `$env:AIMLOOM_DEV_PORT = '5174'` before starting the service.
The URL then uses port 5174. The container still uses port 5173.

Changes under `packages/app/src` and `packages/core/src`, plus the installer HTML,
Vite config and app TypeScript config, are mounted read-only and picked up by
Vite. Polling is enabled for Docker Desktop/WSL file notifications. Package
manifests, test files, CLI scripts and fixtures are part of the image snapshot:
stop and restart with the command above after changing these files.

Press Ctrl+C to stop the foreground service. Remove the project's stopped
containers, network and disposable dependency volumes with:

```sh
npm run docker:down
# Equivalent: docker compose down --volumes
```

This preserves source files and `dist/docker-installer`. It removes only this
Compose project's containers/network/volumes; it does not delete host
`node_modules` or prune unrelated Docker resources.

## Run checks

```sh
npm run docker:check
# Equivalent: docker compose run --build --rm checks
```

The `checks` service runs `npm test` followed by `npm run typecheck`. It rebuilds
the image first, then checks the source snapshot in that image. It has no host
bind mounts and does not share the running preview's dependency volumes.

The build context includes the tracked Themes and configuration corpus required
by the core fixtures. Tests create synthetic sound/crosshair files in the
container's temporary directory. Native Rust, PowerShell and Windows acceptance
checks remain separate and are not included in this command.

## Build the static installer frontend

```sh
npm run docker:build
# Equivalent:
docker build --target installer-artifact --output type=local,dest=dist/docker-installer .
```

This rebuilds from the current source snapshot and runs `npm run build:installer`
inside Docker. BuildKit exports only the frontend files, including
`installer.html`, to `dist/docker-installer/` on the host. This is a browser
artifact, not a Windows EXE or release ZIP. The destination is already covered
by the repository's `dist/` ignore rule. The exporter can merge into an existing
destination; use a new output directory when an exact, clean artifact inventory
is required, for example `--output type=local,dest=dist/docker-installer-review`.

## Dependency changes and rebuilds

The image copies root and workspace manifests before `npm ci`, so ordinary
source edits reuse the dependency layer. Do not run `npm install` in a running
container to update repository dependencies: update manifests and the lockfile
through the normal project workflow, then restart `npm run docker:dev`.

The start command always uses `--renew-anon-volumes`. It creates fresh anonymous
volumes from the rebuilt image for root, app and core `node_modules`, including
workspace-specific packages and Vite's writable caches. Host macOS/Windows
dependencies are neither copied into the image nor mounted into the container.
Do not omit that flag when recreating the preview after a dependency change.

To force a fresh dependency installation from the existing lockfile:

```sh
docker compose down --volumes
docker compose build --pull --no-cache installer checks
docker compose up --renew-anon-volumes installer
```

The build context is allowlisted in `.dockerignore`. It excludes local
credentials, Git/Codex state, binaries and native build outputs. Live mounts are
limited to browser-development inputs; no game directory, credential directory
or Docker socket is mounted. When adding a workspace, update the Dockerfile's
manifest copies and `.dockerignore`; add any necessary workspace dependency
volume and live source mounts explicitly.

## Verification boundaries

`docker compose config --quiet` validates Compose configuration without starting
containers. Actual container validation requires a running Docker engine:
start the preview, check that the service becomes healthy with
`docker compose ps`, load `installer.html`, change a visible UI string and
confirm hot reload, then run the checks and export commands above. A successful
host `npm test` run alone is not evidence that Docker works.

## Mac installation and remote-shell notes

Docker Desktop was installed from the official Apple Silicon DMG on this Mac. Homebrew's
cask attempted to create administrator-owned `/usr/local/bin` links and rolled back when
the remote session could not supply a sudo password. The verified DMG was then installed
directly at `/Applications/Docker.app`, and first-run setup was handled on the Mac.

The working CLI links are in `/opt/homebrew/bin` (`docker` and the bundled credential
helpers). Compose and Buildx are linked in `~/.docker/cli-plugins` to the installed app.
The selected context is `desktop-linux`; no TCP Docker daemon endpoint is needed. This
installation is managed by Docker Desktop rather than a successful Homebrew cask receipt.

On the first live preview, macOS may ask Docker Desktop to access the Documents folder
containing this checkout. Allow access to the intended project when prompted. The build
and checks use source snapshots, while live preview also requires the bind mounts.

An SSH session may fail to pull even a public image with `keychain cannot be accessed`
because Docker Desktop's credential helper cannot interact with the login keychain.
For this project's public Node image, a separate, temporary anonymous CLI configuration
works without changing the regular Docker credentials:

```sh
AIMLOOM_DOCKER_ENDPOINT="$(docker context inspect desktop-linux --format '{{.Endpoints.docker.Host}}')"
AIMLOOM_PUBLIC_DOCKER_CONFIG="$(mktemp -d /tmp/aimloom-docker-public.XXXXXX)"
cat > "$AIMLOOM_PUBLIC_DOCKER_CONFIG/config.json" <<'JSON'
{
  "auths": {"https://index.docker.io/v1/": {}},
  "cliPluginsExtraDirs": ["/Applications/Docker.app/Contents/Resources/cli-plugins"]
}
JSON
DOCKER_CONFIG="$AIMLOOM_PUBLIC_DOCKER_CONFIG" DOCKER_HOST="$AIMLOOM_DOCKER_ENDPOINT" npm run docker:check
DOCKER_CONFIG="$AIMLOOM_PUBLIC_DOCKER_CONFIG" DOCKER_HOST="$AIMLOOM_DOCKER_ENDPOINT" npm run docker:build
DOCKER_CONFIG="$AIMLOOM_PUBLIC_DOCKER_CONFIG" DOCKER_HOST="$AIMLOOM_DOCKER_ENDPOINT" npm run docker:dev
```

The empty Docker Hub entry contains no credentials and prevents automatic helper discovery
for this anonymous profile; an entirely empty `auths` object still triggers discovery.
This is supported by the [Docker CLI configuration loader](https://github.com/docker/cli/blob/master/cli/config/config.go)
and its [authentication-configuration check](https://github.com/docker/cli/blob/master/cli/config/configfile/file.go).
Use the normal authenticated configuration for private images; do not log in with this
temporary public-only profile. It is not stored in the repository or selected globally.

Recorded results: [Docker verification](superpowers/notes/2026-09-13-docker-verification.md).

Official references: [Node image tag and architectures](https://github.com/docker-library/official-images/blob/master/library/node),
[Compose up options](https://docs.docker.com/reference/cli/docker/compose/up/),
[Docker build contexts and .dockerignore](https://docs.docker.com/build/building/context/),
[local build exporter](https://docs.docker.com/build/exporters/local-tar/).

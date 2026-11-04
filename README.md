# FerWeb

FerWeb is a self-hosted workspace for software projects, GitHub repositories, persistent AI conversations, model evaluations and supervised coding tasks. The application previously discussed as ProjectForge is named **FerWeb** in this repository.

React + TypeScript + Redux, Express + TypeScript, PostgreSQL, Python and Qdrant run in Linux containers. A trusted Codex controller launches restricted code containers; it is a privileged component for a dedicated, controlled host. See the [isolation boundaries](docs/codex.md).

## Requirements

- Docker Engine/Desktop with Linux containers and Docker Compose **2.24.4 or newer**. Windows users can keep editing in Windows with Docker Desktop's WSL2 backend.
- Node **24.22.2** and npm **11.19.1** on the host for orchestration only. Builds, services and tests run in Docker.
- Git for cloning and enumerating clean source inputs during release acceptance.
- Internet access to retrieve pinned images/packages on the first build. Providers remain unconfigured until explicitly connected; tests do not download models.
- Start with 4 CPUs and 8 GiB available to Docker; this is not a measured capacity guarantee. Actual conditions/results are in the [release review](docs/release-review.md).

## Start development from a clean clone

Run these commands **from the repository directory**, where `package.json` lives:

```powershell
git clone https://github.com/fercuacas/FerWeb.git
cd FerWeb
npm run setup
npm run docker:up
npm run owner:create
npm run docker:status
```

On Linux/macOS, change into your checkout and run the same npm commands. No host `npm install` is required. Setup generates a private `.env` without printing credentials and preserves existing values. Owner creation prompts for an email and hidden password (12–128 characters); it refuses to replace an existing owner. There is no public registration.

Open [FerWeb](http://127.0.0.1:5173/) using that exact origin. Sign in, create a project and add a task. Readiness is available through `/api/health/ready`. API port 3001 is loopback-only in development; PostgreSQL, AI, Qdrant and controllers have no published ports.

```powershell
npm run docker:logs
npm run docker:stop
npm run docker:up
npm run docker:restart
```

Stop/restart preserve data. The existing development database is **`ferweb_postgres_data`**; never remove it to fix startup. `.local` contains backups, not a second active database. See [Docker operation](docs/docker.md).

## Prepare a release candidate

```powershell
npm run release:setup
npm run release:build
npm run release:check
```

Setup creates a separate `.env.release`, without overwriting it. The build produces compiled runtime images. Acceptance uses fresh randomly named projects and removes only their disposable resources; it does not publish images or deploy a user instance. Its private report is `.local/release-verification.json`.

After an operator authorizes starting an instance:

```powershell
npm run release:start
npm run release:owner
npm run release:status
```

The default release project is `ferweb-release`, with separate volumes and web at [127.0.0.1:8080](http://127.0.0.1:8080/) on loopback. The API is not published. It does not migrate the development database automatically. `release:stop` preserves volumes. Follow the [deployment and recovery guide](docs/deployment.md) before using existing data or enabling external access. HTTPS, hostname and ingress have not been publicly deployed here.

## Configure integrations

Keys belong in ignored server-side files, never browser storage or Git:

- [GitHub App](docs/github.md): installation/repository read access, signed webhooks and explicit draft PR publication.
- [OpenAI / Ollama](docs/ai.md): model catalog, streaming and host-local Ollama via `host.docker.internal`.
- [Repository context](docs/retrieval.md): local embeddings, exclusions, provenance and Qdrant.
- [Codex executor](docs/codex.md): dedicated credentials, limits, cancellation and actual isolation.
- [Review and PR](docs/reviews.md), [model lab](docs/laboratory.md), [context strategies](docs/context-optimization.md).

Development wrappers discover conventional private files. Release wrappers require explicitly setting `FERWEB_GITHUB_CONFIG_FILE`, `FERWEB_AI_CONFIG_FILE` or `FERWEB_CODEX_CONFIG_FILE` in the shell; they do not silently reuse development credentials. Real model calls/GitHub writes are explicit acceptance tests, excluded from automated tests.

## Verify changes

```powershell
npm run docker:format
npm run docker:check
npm run release:check
```

The full Docker check runs types, compilation, format, unit tests, PostgreSQL integration tests, browser tests and smoke checks. Model/GitHub transports are simulated; PostgreSQL, Qdrant, CLI processes and container boundaries are real where required. Release acceptance adds compiled images from a clean source copy, an authenticated browser journey, authorization, a durable simulated job, bounded CRUD load, restart persistence and paired backup/restore into a new environment.

GitHub Actions runs the same checks on pushes/PRs with read-only permissions and pinned actions. It has no publication/deployment step. A local pass is not a hosted CI pass; see [actual evidence and limits](docs/release-review.md).

## TLS inspection and troubleshooting

If a trusted proxy/antivirus intercepts HTTPS, provide its verified PEM certificate through `FERWEB_BUILD_CA_FILE`, or `.local/build-ca.pem`. Wrappers use a BuildKit secret for downloads and provider CA overlays when explicitly configured; they do not disable TLS verification. Never commit certificates, `.env*`, private JSON, dumps or logs. Do not export a private key as the CA certificate.

An npm `ENOENT ... package.json` error means the command ran outside the checkout. Start Docker Desktop if the daemon is unavailable. For occupied ports, change `WEB_PORT`/`API_PORT` in the correct env file and set `APP_ORIGIN` consistently. Inspect `docker:logs` for migrations; use the migrator, never edit applied SQL. Avoid `docker compose config` with real credentials because its output interpolates secrets.

## Documentation

- [Current status](docs/status.md), [release review](docs/release-review.md).
- [Deployment, migrations and recovery](docs/deployment.md), [load test](docs/load-testing.md), [demo](docs/demo.md).
- [Development map](docs/development.md), [API](docs/api.md), [architecture](docs/architecture.md), [product](docs/product.md), [roadmap](docs/roadmap.md).
- [Historical evidence](docs/history.md), only for investigating past checks.

Development documentation is maintained in Spanish; this README is the English installation entry point.

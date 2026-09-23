# @kvk/site — the Aimloom website (Phase 1)

Static, bilingual product site. Design: `docs/superpowers/specs/2026-09-17-aimloom-website-and-explore-design.md`.

    npm run dev -w @kvk/site       # http://127.0.0.1:4321/
    npm run build -w @kvk/site     # -> packages/site/dist
    npm test -w @kvk/site          # site-local Vitest 4.1; NOT part of the root `npm test`
    npm run typecheck -w @kvk/site

Deployment is one Cloudflare Worker (`aimloom-site`) serving `dist/` as static assets;
see `wrangler.jsonc`. Phase 2 (the explorer, D1, R2, the publish command) is not in this
workspace yet.

Version facts live only in `src/data/releases.json`. A release whose status is
`preparing` renders no download link anywhere.

`releases.json` also carries a top-level `beta`: `"<version>" | null`, naming the current beta
release. When set, it must name an entry whose status is `beta` and whose version is newer than
`recommended` by semver precedence (prereleases included, so `0.1.4-beta.1` outranks `0.1.3` but
not `0.1.4`); `recommended`, when set, must itself name a `stable` entry — the site never
recommends a beta. The Download page shows the beta as a secondary `#beta` section below the
stable release, with its own Setup, ZIP, hashes and known issues.

`/latest.json` (`src/pages/latest.json.ts`), read by the App's launch check, answers
`{ "version": "<recommended>", "beta": "<beta>" | null }`. `version` is **`null`** when
`recommended` is `null` or names a release whose status is `preparing` (nothing to download yet);
the App must treat that the same as "no newer version" and not attempt a fetch. `beta` is `null`
whenever the `beta` field is unset or no longer newer than `version` — a beta that a stable release
has caught up with or passed disappears from the endpoint on its own, without editing
`releases.json` by hand.

A release's files can be served by the site itself: the ZIP's `primaryUrl` is then
`/files/<name>.zip`, and since v0.1.2 a release may also carry `setup: {url, bytes, sha256}` with
`/files/<name>.exe`; the Download page then leads with the Setup and offers the ZIP as portable.
Neither file is in git. Before a deploy, put the exact files attached to the GitHub release in
`packages/site/release-files/` (gitignored) — for every release still listed, 0.1.1 included;
`npm run stage:release` (run by both deploy scripts after `astro build`) copies each to
`dist/files/` only if its size and SHA-256 match `releases.json`, and fails the deploy otherwise.
`npm test` rebuilds `dist/` and so removes staged files: run the link and a11y checks after
`build` + `stage:release`, not after the tests. `mirrorUrl` is optional while the repository
is private; the Download page then shows one link.

## The feedback address

Every footer and the Guide give `feedback@aimloom.dev` (`FEEDBACK_EMAIL` in `src/layouts/Base.astro`; the
Guide's sentence is in the dictionaries; `tests/build.test.ts` pins both). It is a Cloudflare **Email Routing**
address on the site's own domain that forwards to the owner's mailbox, so no personal address is published.
Routing only receives: a reply goes out from the owner's own address. **The address must receive mail before a
deploy advertises it** — check `dig +short MX aimloom.dev` (Cloudflare's `route*.mx.cloudflare.net`) and send a
test message. It is the only report channel until v0.1.3's one-click report (ROADMAP REPORT, FEEDBACK-APP).

## Checks before a deploy

    npm run build -w @kvk/site && npm run stage:release -w @kvk/site && npm run check:links -w @kvk/site
    npx --workspace @kvk/site playwright install chromium   # once
    npm run check:a11y -w @kvk/site                          # axe at 1280 and 390 px + overflow check
    node packages/site/scripts/check-a11y.mjs packages/site/dist --shots <dir>   # also saves full-page renders

`check:a11y` serves `dist/` over a local HTTP server (the pages reference `/_astro/*.css`
absolutely, so `file://` would audit unstyled pages) and fails on any serious/critical axe
violation or any horizontal overflow.

## Deploying the Worker

    npx --workspace @kvk/site wrangler login          # once, interactive OAuth; no token in the repo
    npm run deploy:preview -w @kvk/site               # -> the account's workers.dev address (preview Worker)
    npm run deploy -w @kvk/site                       # production -> https://aimloom.dev

`wrangler.jsonc` is tracked and carries **placeholder** D1 database ids (`00000000-…-0000` /
`…-0001`) so the repository can go public with no real Cloudflare identifier in git. The real
ids live in an untracked local file, `~/.config/aimloom/site.json` (or `$AIMLOOM_SITE_CONFIG`),
shaped `{ "d1": { "production": "<id>", "preview": "<id>" } }`. `deploy`, `deploy:preview`,
`report` and `reports` all run `scripts/wrangler-config.mjs` first, which reads that file and
`wrangler.jsonc` and writes a generated, gitignored `.wrangler.generated.jsonc` with the real
ids substituted in; the deploy itself runs with `--config .wrangler.generated.jsonc`. Without
that local file the script stops with a clear error — it never deploys with placeholder ids.

What exists (2026-09-19):
- the maintainer's Cloudflare account, with `wrangler login` on the maintainer's Mac;
- the Workers `aimloom-site` (production) and `aimloom-site-preview`;
- the domain **`aimloom.dev`**, bought through Cloudflare Registrar on 2026-09-19 (it renews
  2027-09-19). It is attached to production as a custom domain in `wrangler.jsonc`.

`workers_dev: true` keeps the account's `workers.dev` address for `aimloom-site` alive beside
the domain. With a route present, wrangler would otherwise switch it off. `tests/deploy-config.test.ts`
pins both, and pins that no environment can claim the domain: wrangler **inherits** `routes`, so
`env.preview` must say `"routes": []`. On 2026-09-20 a preview deploy without it moved
`aimloom.dev` to the preview Worker; `npx wrangler triggers deploy --env=""` moved it back without
uploading anything. Read a deploy's whole output and check https://aimloom.dev after any deploy.

The D1 databases `aimloom` and `aimloom-preview` exist (the report backend, below). Since
2026-09-22 the R2 bucket `aimloom-files` exists with its custom domain `dl.aimloom.dev` (r2.dev off),
and `0002_catalogue.sql` is applied to both databases (next section). Deploy production only when a real release is
in `releases.json`, with its ZIP in `release-files/`.

## The explorer (v0.1.5)

Design: `docs/superpowers/specs/2026-09-22-website-explorer-design.md`. The Worker answers
`/<lang>/explore/`, `/<lang>/explore/<slug>/`, `/d/<slug>` and `/api/explore/items` from the same D1
database as reports (migration `0002_catalogue.sql`); the files are in the R2 bucket `aimloom-files`,
served from its custom domain `dl.aimloom.dev` (`FILES_ORIGIN` in `wrangler.jsonc`). The Worker has
no R2 binding: a download is a counted `302`.

**Provisioning, once** (the maintainer, logged in with `wrangler login`):

    npx wrangler r2 bucket create aimloom-files
    # Dashboard → R2 → aimloom-files → Settings → Custom domains → add dl.aimloom.dev; keep r2.dev off.
    npm run wrangler-config -w @kvk/site
    cd packages/site
    npx wrangler d1 migrations apply aimloom-preview --remote --config .wrangler.generated.jsonc --env preview
    npx wrangler d1 migrations apply aimloom --remote --config .wrangler.generated.jsonc --env=""

Apply the migration **before** deploying the Worker that reads it.

**Sign-in and uploads** (spec §11). Sign-in is Steam OpenID (`/auth/steam/*`); the session cookie is
`aimloom_session`. Uploads by a trusted creator go to `aimloom-files` and are live at once; everyone
else's wait in the **private** bucket `aimloom-uploads` (create it once: `npx wrangler r2 bucket
create aimloom-uploads`, no custom domain, r2.dev off) until `/<lang>/explore/review/` approves them.
That page opens only for the SteamIDs in the secret `ADMIN_STEAM_IDS` (`npx wrangler secret put
ADMIN_STEAM_IDS --config .wrangler.generated.jsonc --env=""`, and again `--env preview`; a
comma-separated list, never in git). Apply `0003_uploads.sql` like 0002, before the deploy.

**Backups.** D1's Time Travel restores any minute of the last 7 days (free plan). About once a week,
with the weekly look at the database, run `npm run site:backup -w @kvk/site`: it writes the
production database as SQL and every uploaded file it points at to `private/backups/<date>/`
(gitignored in the private records; files already in an earlier backup are copied, not downloaded).
Set the Turnstile keys on **production only**: preview shares the buckets, so its uploads must stay
closed (`tests/deploy-config.test.ts`).

**Publishing an item by hand** — only content whose author has given permission; keep the evidence in the
private records, never here. A folder holds `item.json` and exactly one file:

    {
      "slug": "night-blue", "kind": "theme",
      "title": { "zh": "夜蓝", "en": "Night Blue" },
      "summary": { "zh": "…", "en": "…" },
      "author": "…", "authorUrl": "https://…",      // authorUrl optional, https only
      "licence": "CC-BY-4.0",                       // an SPDX id, or "permission"
      "code": "CSGO-…",                             // crosshairs only, optional
      "featured": 1                                 // optional position in the Featured row
    }

    npm run site:publish -w @kvk/site -- <folder> --dry-run            # checks only, prints the plan
    npm run site:publish -w @kvk/site -- <folder>                      # preview database
    npm run site:publish -w @kvk/site -- <folder> --env production     # backs up to backups/ first

Every check runs before anything is uploaded, and uploads through the site run the same ones
(`src/lib/item-checks.ts`): the App's own file-name rules; `parseScheme` for a theme; a crosshair PNG
walked chunk by chunk, fully decoded and stored re-encoded (≤ 512 px); a WAV or Ogg file whose every
chunk or page is accounted for, with nothing after the end (≤ 5 MiB). Uploads also need a Cloudflare
Turnstile pass: set `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET` as secrets in both environments, or
uploads stay closed.
A new file gets a new SHA-256 key; old objects are never overwritten or deleted by the command.

## The report backend

`src/worker/index.ts` runs first for `/api/*` only (everything else stays a static asset,
`wrangler.jsonc`'s `run_worker_first`). It serves two endpoints. Neither is called by the App
yet — that is a separate, not-yet-started plan; this is the backend and the owner's tools for it.

- `POST /api/reports` (`src/worker/reports.ts`) accepts one JSON crash/feedback report from the
  App, stores it, and answers `{ number }`. Failure codes: `METHOD_NOT_ALLOWED` (405),
  `UNSUPPORTED_MEDIA_TYPE` (415, requires `content-type: application/json`), `UNKNOWN_CLIENT`
  (400, the `User-Agent` must start `Aimloom/x.y.z`), `TOO_LARGE` (413), `INVALID_JSON` (400),
  `INVALID_REPORT` (400, with the offending `field`, capped to 64 characters — see "What a report
  must look like" below), `DAILY_LIMIT` (429), `STORAGE_FULL` (507), `STORAGE_FAILED` (500), and
  `RATE_LIMITED` (429) from the shared limiter in front of it.
- `POST /api/steam/resolve` (`src/worker/steam.ts`) turns a pasted `steamcommunity.com` profile
  URL into `{ steamId, name }` by fetching that profile's public XML view. It requires the same
  client and content-type as the report route above (`UNKNOWN_CLIENT`, `UNSUPPORTED_MEDIA_TYPE`) —
  **the App must send the `Aimloom/x.y.z` User-Agent and `application/json` on this route too**, or
  every request is refused. Failure codes: `METHOD_NOT_ALLOWED` (405), `UNSUPPORTED_MEDIA_TYPE`
  (415), `UNKNOWN_CLIENT` (400), `TOO_LARGE` (413, body over 4 KiB), `INVALID_STEAM_URL` (400),
  `STEAM_NOT_FOUND` (404), `STEAM_UNREACHABLE` (502), `RATE_LIMITED` (429).

Both routes reject a request whose `content-length` already exceeds the route's cap before
reading anything, and cap the body read itself (`src/worker/body.ts`'s `readCapped`) so a lying or
absent `content-length` cannot buffer past that cap either — the request never gets a chance to
OOM the isolate, and a body that disconnects mid-read answers our own error code, never
Cloudflare's default error page.

A report is **one row of the D1 table `reports`** (`migrations/0001_reports.sql`): every column
but `body` is an index (`number`, `created_at`, `day`, `app_label`, `lang`, `windows`, `has_log`,
`has_contact`, `steam_id`, `bytes`, `mail`), and `body` holds the whole report as JSON. There is
no R2 bucket — R2 is not enabled on the Cloudflare account, and the user chose on 2026-09-20 to
keep report bodies in the database instead of standing up R2 for them.

Four ceilings guard the table, all in `src/worker/reports.ts`, checked cheapest-first so a flood
about to be refused never pays for a full-table scan:

1. **per address**: 3 requests per 60 seconds through the `REPORT_LIMIT` rate-limit binding (fails
   open — see the spec, §5.2 step 3);
2. **per UTC day, by count**: at most 300 reports (`DAILY_CEILING`, `DAILY_LIMIT`), read from an
   indexed `WHERE day = ?` query;
3. **per UTC day, by bytes**: at most 64 MiB (`DAILY_BYTES_CEILING`, also `DAILY_LIMIT`), from the
   same indexed query as #2 at no extra cost — this is what stops 300 reports × up to 1 MiB each
   from reaching 300 MiB in a single day against a 400 MiB archive;
4. **archive total**: once the table's total `bytes` reaches 400 MiB (`ARCHIVE_CEILING_BYTES`,
   `STORAGE_FULL`) new reports are refused until old ones age out. Only checked once #2 and #3
   pass, with an unindexed full-table `SUM(bytes)`.

Retention is 180 days (`RETENTION_DAYS`), enforced two ways: every incoming report first runs
`deleteExpired` (`DELETE FROM reports WHERE created_at < now - 180d`), and a Cron Trigger
(`wrangler.jsonc`'s top-level `triggers`, `17 4 * * *` UTC, calling the same `deleteExpired`
through the Worker's `scheduled` export in `src/worker/index.ts`) runs it once a day regardless of
traffic — so the Privacy page's "deleted after 180 days" holds even in a week with no reports at
all, not only "whenever a new report arrives".

### What a report must look like

`src/worker/report-schema.ts` is the contract; every key is required and no other key is allowed
at any level (`INVALID_REPORT` with the offending `field`, an empty string sends `null` for an
optional field — an empty string is always refused):

| Field | Rule |
|---|---|
| `app.label` | `^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$`, ≤40 chars — strict semver, so `v0.1.3` is refused |
| `app.commit` | `^([0-9a-f]{7,40}\|unknown)$`, ≤40 chars |
| `app.built` | any non-empty string, ≤40 chars |
| `system.windows` | any non-empty string, ≤40 chars |
| `system.displayLanguage` | any non-empty string, ≤20 chars |
| `system.langChoice` | one of `system`, `zh`, `en` |
| `system.lang` | one of `zh`, `en` |
| `system.powershell` | any non-empty string ≤40 chars, or `null` |
| `game.found` | boolean |
| `account` | `{ steamId, name, verified: false }` or `null` |
| `account.steamId` | exactly 17 digits |
| `account.name` | any non-empty string, ≤64 chars |
| `description` | any non-empty string, ≤2,000 characters, or `null` |
| `contact` | any non-empty string, ≤200 characters, or `null` |
| `log` | any non-empty string, ≤512 KiB (measured in UTF-8 bytes), or `null` |

The `Aimloom/<version>` User-Agent is matched as a *prefix* (`/^Aimloom\/\d+\.\d+\.\d+/`), so a
pre-release build like `Aimloom/0.1.3-test.2` passes.

Bindings (`wrangler.jsonc`): `DB` is the D1 database (`aimloom` in production,
`aimloom-preview`, its own separate database, under `env.preview`), `MAIL` is a Cloudflare Email
Routing send binding used to forward each report to the owner, and `REPORT_LIMIT` /
`STEAM_LIMIT` are the two Workers Rate Limiting bindings in front of the endpoints above.
`REPORT_TO` (the owner's mailbox) is a **secret**, never a var or binding field in
`wrangler.jsonc` (`tests/deploy-config.test.ts` pins that): set it with
`npx --workspace @kvk/site wrangler secret put REPORT_TO` for production, and
`npx --workspace @kvk/site wrangler secret put REPORT_TO --env preview` for preview.

**Reading reports** — `packages/site/scripts/report.mjs`, run through `npx wrangler d1 execute`
against the remote database (there is nothing to read locally):

    npm run report -w @kvk/site -- AL-260921-7K3F     # print one stored report's body, indented
    npm run report -w @kvk/site -- AL-260921-7K3F --preview   # same, against aimloom-preview
    npm run reports -w @kvk/site                       # latest 20 rows, WITHOUT their bodies
    npm run reports -w @kvk/site -- --preview

`commandFor(args)` and `bodyFrom(stdout)` are exported from the script and unit-tested
(`tests/report-tool.test.ts`) as pure functions, since a report number reaches both a shell
command line and a SQL string: `commandFor` accepts only the exact `AL-######-XXXX` shape
(`report-number.ts`'s alphabet) and throws on anything else.

`npm test` now also runs the Worker's own suite against `workerd`
(`vitest.workers.config.ts`, `@cloudflare/vitest-plugin`) — equivalent to running
`npm run test:worker -w @kvk/site` on its own.

Design: the reviewed Figma frames and the decisions they produced are in
`docs/design/figma/README.md`.

# VPS deployment

The application is mounted at `/pocket-partner/`, with its API at `/pocket-partner/api/`. It uses the existing HTTPS reverse proxy, a dedicated PostgreSQL container and a dedicated private file volume. The app does not publish a new host port.

## Setup

- Place the checkout in `/srv/pocket-partner`.
- Copy `deploy/.env.example` to `deploy/.env`, choose a long random database password, and set the actual HTTPS origin and ElevenLabs key.
- Create `deploy/secrets/firebase-admin.json` and `deploy/secrets/firebase-web.json`. Keep the directory private, readable by the app's container user (UID 1000), and excluded from Git.
- Set `PROXY_NETWORK` to the existing reverse proxy's Docker network.
- Build with `docker compose -f deploy/compose.yaml build app`.
- Start the database with `docker compose -f deploy/compose.yaml up -d db`.
- Apply the schema with `docker compose -f deploy/compose.yaml run --rm app node build/server/migrate.js`.
- Start the app and worker with `docker compose -f deploy/compose.yaml up -d app worker`.
- Route only `/pocket-partner` and `/pocket-partner/*` to `pocket-partner-web:4174`, preserving the prefix. Validate the reverse proxy configuration before reloading it.

Run these commands from `deploy/` using `docker compose` without `-f` when using its local `.env` automatically, or pass `--env-file deploy/.env` explicitly from the repository root.

Health: `GET /pocket-partner/api/health`. It checks database connectivity without exposing application data. Other data endpoints require a valid Firebase token and group authorization. Check `docker compose ps` and the app/worker logs after a deployment. Logs exclude auth tokens, keys and uploaded script text.

## Updates and rollback

Build a new tagged image and keep the previous image available. Apply additive migrations, switch `IMAGE_TAG`, and recreate only Pocket Partner's containers. Avoid rebuilding or restarting unrelated hosted projects. For rollback, set `IMAGE_TAG` to the previous image and recreate the app and worker. Restore the matching database/file snapshot if a future migration changes data incompatibly.

## Backups

`backup.sh` briefly stops the app and worker to capture a consistent database dump and files archive, then restarts them. It writes private snapshots under `/var/backups/pocket-partner` and retains three days. The supplied systemd service and timer schedule it daily at 03:30 UTC; install them in `/etc/systemd/system/`, reload systemd and enable `pocket-partner-backup.timer`. Adjust the schedule outside your rehearsal hours. Copy snapshots to another machine or backup provider for disaster recovery; a backup on the same VPS is not protection against loss of that VPS.

To restore: stop the app and worker; restore the database dump into an empty `pocket` database using `pg_restore -U pocket -d pocket`; restore `files.tar.gz` into the `pocket-partner_files` volume; then restart and verify group/file access. Restore credentials from their separate private storage. Test restores before relying on a backup policy.

## Limits

Keep the worker at one replica. It also takes an exclusive PostgreSQL lease to prevent accidental parallel workers. AI allowances count text characters reserved before dispatch, including failed requests with uncertain billing outcomes. Raising these allowances does not change provider subscription settings. Firebase remains on its free plan.

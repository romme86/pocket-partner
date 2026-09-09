CREATE TABLE IF NOT EXISTS app_users (
 uid text PRIMARY KEY, email text NOT NULL, name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS groups (
 id uuid PRIMARY KEY, name text NOT NULL, owner_uid text NOT NULL REFERENCES app_users(uid), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS memberships (
 group_id uuid REFERENCES groups(id) ON DELETE CASCADE, uid text REFERENCES app_users(uid) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('owner','editor','member')), PRIMARY KEY(group_id,uid)
);
CREATE TABLE IF NOT EXISTS files (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 storage_name text NOT NULL UNIQUE, mime text NOT NULL, bytes bigint NOT NULL CHECK(bytes>=0),
 name text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scripts (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 title text NOT NULL, author text NOT NULL DEFAULT '', kind text NOT NULL CHECK(kind IN ('play','scene')),
 color integer NOT NULL DEFAULT 0 CHECK(color BETWEEN 0 AND 4), original_file_id uuid REFERENCES files(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS characters (
 id uuid PRIMARY KEY, script_id uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
 name text NOT NULL, voice_id text NOT NULL DEFAULT '', delivery text NOT NULL DEFAULT 'neutral' CHECK(delivery IN ('neutral','expressive')),
 UNIQUE(script_id,name)
);
CREATE TABLE IF NOT EXISTS scenes (
 id uuid PRIMARY KEY, script_id uuid NOT NULL REFERENCES scripts(id) ON DELETE CASCADE,
 title text NOT NULL, position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS lines (
 id uuid PRIMARY KEY, scene_id uuid NOT NULL REFERENCES scenes(id) ON DELETE CASCADE,
 character_id uuid REFERENCES characters(id) ON DELETE SET NULL, text text NOT NULL,
 position integer NOT NULL, revision integer NOT NULL DEFAULT 1,
 audio_id uuid REFERENCES files(id) ON DELETE SET NULL, audio_kind text CHECK(audio_kind IN ('recorded','ai')),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lines_scene_position ON lines(scene_id,position);
CREATE INDEX IF NOT EXISTS scenes_script ON scenes(script_id);
CREATE INDEX IF NOT EXISTS files_group ON files(group_id);
CREATE TABLE IF NOT EXISTS invitations (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE, role text NOT NULL CHECK(role IN ('editor','member')),
 created_by text NOT NULL REFERENCES app_users(uid), expires_at timestamptz NOT NULL,
 used_at timestamptz, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS practice (
 uid text REFERENCES app_users(uid) ON DELETE CASCADE, line_id uuid REFERENCES lines(id) ON DELETE CASCADE,
 score integer NOT NULL DEFAULT 0 CHECK(score>=0), repeats integer NOT NULL DEFAULT 0,
 hints integer NOT NULL DEFAULT 0, remembered integer NOT NULL DEFAULT 0, saved boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(uid,line_id)
);
CREATE TABLE IF NOT EXISTS practice_events (
 id uuid PRIMARY KEY, uid text NOT NULL REFERENCES app_users(uid) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS budgets (
 scope text NOT NULL, period text NOT NULL, characters bigint NOT NULL DEFAULT 0 CHECK(characters>=0), PRIMARY KEY(scope,period)
);
CREATE TABLE IF NOT EXISTS jobs (
 id uuid PRIMARY KEY, group_id uuid NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
 line_id uuid NOT NULL REFERENCES lines(id) ON DELETE CASCADE, requested_by text NOT NULL REFERENCES app_users(uid),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','done','failed','cancelled')),
 payload jsonb NOT NULL, error text, created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_one_active_line ON jobs(line_id) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS jobs_queued ON jobs(created_at) WHERE status='queued';

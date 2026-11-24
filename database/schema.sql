-- Incidex database schema (PostgreSQL)
-- Running this file resets the database: it drops the tables and builds them fresh.
-- Order matters because of the foreign keys.

DROP TABLE IF EXISTS incident_history;
DROP TABLE IF EXISTS incident_comments;
DROP TABLE IF EXISTS incidents;
DROP TABLE IF EXISTS users;

-- ---------------------------------------------------------------------------
-- users: everyone who can log in
--   reporter = can report incidents and comment on their own
--   analyst  = works incidents (status, assignment, comments)
--   admin    = everything, including deleting
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    email         VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role          VARCHAR(20)  NOT NULL DEFAULT 'reporter'
                  CHECK (role IN ('reporter', 'analyst', 'admin')),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- incidents: the main table
-- ---------------------------------------------------------------------------
CREATE TABLE incidents (
    id             SERIAL PRIMARY KEY,
    title          VARCHAR(150) NOT NULL,
    description    TEXT         NOT NULL,
    category       VARCHAR(30)  NOT NULL
                   CHECK (category IN ('phishing', 'malware', 'unauthorized_access',
                                       'data_leak', 'dos', 'other')),
    severity       VARCHAR(10)  NOT NULL
                   CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    status         VARCHAR(20)  NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'investigating', 'contained', 'resolved', 'closed')),
    affected_asset VARCHAR(150),
    reported_by    INTEGER      NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    assigned_to    INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resolved_at    TIMESTAMPTZ
);

-- ---------------------------------------------------------------------------
-- incident_comments: notes/discussion on an incident
-- ---------------------------------------------------------------------------
CREATE TABLE incident_comments (
    id          SERIAL PRIMARY KEY,
    incident_id INTEGER     NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    comment     TEXT        NOT NULL CHECK (length(trim(comment)) > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- incident_history: audit trail, one row per field that changed
-- ---------------------------------------------------------------------------
CREATE TABLE incident_history (
    id            SERIAL PRIMARY KEY,
    incident_id   INTEGER     NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
    changed_by    INTEGER     REFERENCES users(id) ON DELETE SET NULL,
    field_changed VARCHAR(30) NOT NULL,
    old_value     TEXT,
    new_value     TEXT,
    changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for the things the dashboard filters/sorts by the most
CREATE INDEX idx_incidents_status      ON incidents(status);
CREATE INDEX idx_incidents_severity    ON incidents(severity);
CREATE INDEX idx_incidents_category    ON incidents(category);
CREATE INDEX idx_incidents_created_at  ON incidents(created_at DESC);
CREATE INDEX idx_incidents_assigned_to ON incidents(assigned_to);
CREATE INDEX idx_comments_incident     ON incident_comments(incident_id);
CREATE INDEX idx_history_incident      ON incident_history(incident_id);

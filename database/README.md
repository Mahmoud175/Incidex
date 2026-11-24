# Incidex – Database

PostgreSQL database for Incidex. The backend talks to it through the functions in `db/`, so nobody else on the team has to write SQL.

![ER diagram](erd.png)

## Files

| Path | What it is |
|---|---|
| `database/schema.sql` | Creates the 4 tables, constraints, and indexes. Running it again resets the database. |
| `database/erd.png` / `erd.dot` | ER diagram (regenerate with `dot -Tpng database/erd.dot -o database/erd.png`) |
| `db/index.js` | Shared connection pool + `query()` and `withTransaction()` helpers |
| `db/users.js` | Create users, login check (bcrypt), list/update/delete users |
| `db/incidents.js` | Incident CRUD, filtering, comments, history timeline, dashboard stats |
| `scripts/setupDb.js` | `npm run db:setup` – builds the tables and loads demo data |
| `scripts/testDb.js` | `npm run db:test` – 13 checks that the whole layer works |
| `.env.example` | Template for your `.env` (connection string) |

## Setup (about 5 minutes)

1. Make a free account at [neon.tech](https://neon.tech) and create a project called `incidex`.
2. On the project dashboard click **Connect** and copy the connection string.
3. In the repo folder:
   ```bash
   cp .env.example .env          # Windows: copy .env.example .env
   # paste the connection string into DATABASE_URL in .env
   npm install
   npm run db:setup
   npm run db:test
   ```
4. You should see `Done: 6 users, 11 incidents ...` and `All 13 checks passed.`

`.env` is in `.gitignore`, so the password never goes to GitHub. Share the connection string with the team privately (Discord DM, not the repo).

A local PostgreSQL works too: `DATABASE_URL=postgresql://postgres:yourpassword@localhost:5432/incidex`

## Demo accounts

All use the password `Incidex123!` (test data only).

| Email | Role |
|---|---|
| admin@incidex.test | admin |
| sarah@incidex.test, daniel@incidex.test | analyst |
| emily@incidex.test, marcus@incidex.test, priya@incidex.test | reporter |

## Tables

- **users** – `id, name, email (unique), password_hash, role (reporter | analyst | admin), created_at`
- **incidents** – `id, title, description, category, severity, status, affected_asset, reported_by → users, assigned_to → users (optional), created_at, updated_at, resolved_at`
  - category: `phishing, malware, unauthorized_access, data_leak, dos, other`
  - severity: `low, medium, high, critical`
  - status: `open → investigating → contained → resolved → closed`
- **incident_comments** – `id, incident_id → incidents, user_id → users, comment, created_at`
- **incident_history** – `id, incident_id → incidents, changed_by → users, field_changed, old_value, new_value, changed_at` (one row per field that changed, so we get a full timeline)

Deleting an incident also deletes its comments and history (`ON DELETE CASCADE`). A user who reported incidents can't be deleted (`ON DELETE RESTRICT`), so history doesn't lose who reported what.

## Using it from Express (for the backend)

```js
const incidents = require("./db/incidents");
const users = require("./db/users");

// GET /api/incidents?status=open&severity=high&search=vpn&sort=severity&limit=20&offset=0
router.get("/incidents", async (req, res, next) => {
  try {
    res.json(await incidents.getIncidents(req.query)); // { incidents, total, limit, offset }
  } catch (err) { next(err); }
});

// POST /api/incidents   (req.user comes from your login/session middleware)
const created = await incidents.createIncident(req.body, req.user.id);

// PATCH /api/incidents/:id   – only title, description, category, severity,
// status, affected_asset, assigned_to are changed; everything else is ignored
const updated = await incidents.updateIncident(req.params.id, req.body, req.user.id); // null = 404
```

### Function list

**db/incidents.js**

| Function | Returns |
|---|---|
| `createIncident(fields, reportedByUserId)` | new incident (status starts as `open`, history row added) |
| `getIncidents({ status, severity, category, assignedTo, reportedBy, search, from, to, sort, limit, offset })` | `{ incidents, total, limit, offset }` – sort: `newest` (default), `oldest`, `severity`, `updated` |
| `getIncidentById(id)` | incident with `reported_by_name` / `assigned_to_name`, or `null` |
| `updateIncident(id, changes, changedByUserId)` | updated incident or `null`; logs each changed field; sets/clears `resolved_at` automatically |
| `deleteIncident(id)` | `true` / `false` |
| `addComment(incidentId, userId, text)` / `getComments(incidentId)` / `deleteComment(id)` | comment rows (with `user_name`) |
| `getHistory(incidentId)` | timeline rows (with `changed_by_name`) |
| `getDashboardStats()` | `total, open_total, open_critical, unassigned, avg_hours_to_resolve, byStatus, bySeverity, byCategory, last14Days, recent` |

**db/users.js**

| Function | Returns |
|---|---|
| `createUser({ name, email, password, role })` | user without the hash (throws if the email is taken) |
| `verifyLogin(email, password)` | user or `null` |
| `getUserById(id)` / `getUserByEmail(email)` | user or `null` |
| `listUsers(role?)` | users, e.g. `listUsers("analyst")` for an "assign to" dropdown |
| `updateUserRole(id, role)` / `deleteUser(id)` | updated user / `true`/`false` |

Invalid category/severity/status values throw an `Error("Invalid ...")`, so the route can answer with a 400.

## Security notes

- Every query uses `$1, $2...` parameters, never string concatenation, so input can't become SQL injection (tested in `db:test`).
- Passwords are bcrypt hashes. `password_hash` is never returned by any function.
- Sorting only accepts the 4 known options, so `ORDER BY` can't be injected either.
- Status changes run in a transaction with a row lock, so two analysts updating the same incident at once won't lose a change or its history.

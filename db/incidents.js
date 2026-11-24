// Database functions for incidents, comments, history, and dashboard stats.
// The Express routes should call these instead of writing SQL themselves.

const { query, withTransaction } = require("./index");

const CATEGORIES = ["phishing", "malware", "unauthorized_access", "data_leak", "dos", "other"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const STATUSES = ["open", "investigating", "contained", "resolved", "closed"];

// Fields an update is allowed to change (anything else in the request is ignored).
const EDITABLE_FIELDS = [
  "title",
  "description",
  "category",
  "severity",
  "status",
  "affected_asset",
  "assigned_to",
];

// Incident columns plus the reporter's and assignee's names, so the frontend
// doesn't need a second request just to show "Reported by Sarah".
const INCIDENT_SELECT = `
  SELECT i.id, i.title, i.description, i.category, i.severity, i.status,
         i.affected_asset, i.reported_by, r.name AS reported_by_name,
         i.assigned_to, a.name AS assigned_to_name,
         i.created_at, i.updated_at, i.resolved_at
  FROM incidents i
  JOIN users r ON r.id = i.reported_by
  LEFT JOIN users a ON a.id = i.assigned_to`;

function checkAllowed(value, allowed, label) {
  if (value !== undefined && value !== null && !allowed.includes(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

// ---------------------------------------------------------------- create

async function createIncident(
  { title, description, category, severity, affected_asset = null, assigned_to = null },
  reportedBy
) {
  checkAllowed(category, CATEGORIES, "category");
  checkAllowed(severity, SEVERITIES, "severity");

  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO incidents
         (title, description, category, severity, affected_asset, reported_by, assigned_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [title, description, category, severity, affected_asset, reportedBy, assigned_to]
    );
    const id = rows[0].id;
    await client.query(
      `INSERT INTO incident_history (incident_id, changed_by, field_changed, old_value, new_value)
       VALUES ($1, $2, 'created', NULL, 'open')`,
      [id, reportedBy]
    );
    const result = await client.query(`${INCIDENT_SELECT} WHERE i.id = $1`, [id]);
    return result.rows[0];
  });
}

// ---------------------------------------------------------------- read

// filters (all optional): status, severity, category, assignedTo, reportedBy,
// search (matches title/description/asset), from, to (dates), limit, offset, sort
// Returns { incidents, total } so the frontend can paginate.
async function getIncidents(filters = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace("?", `$${params.length}`));
  };

  if (filters.status) {
    checkAllowed(filters.status, STATUSES, "status");
    add("i.status = ?", filters.status);
  }
  if (filters.severity) {
    checkAllowed(filters.severity, SEVERITIES, "severity");
    add("i.severity = ?", filters.severity);
  }
  if (filters.category) {
    checkAllowed(filters.category, CATEGORIES, "category");
    add("i.category = ?", filters.category);
  }
  if (filters.assignedTo) add("i.assigned_to = ?", Number(filters.assignedTo));
  if (filters.reportedBy) add("i.reported_by = ?", Number(filters.reportedBy));
  if (filters.from) add("i.created_at >= ?", filters.from);
  if (filters.to) add("i.created_at <= ?", filters.to);
  if (filters.search) {
    params.push(`%${filters.search}%`);
    const p = `$${params.length}`;
    where.push(`(i.title ILIKE ${p} OR i.description ILIKE ${p} OR i.affected_asset ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  // Only allow known sort options so the ORDER BY can't be injected.
  const sorts = {
    newest: "i.created_at DESC",
    oldest: "i.created_at ASC",
    severity:
      "CASE i.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, i.created_at DESC",
    updated: "i.updated_at DESC",
  };
  const orderBy = sorts[filters.sort] || sorts.newest;

  const limit = Math.min(Math.max(parseInt(filters.limit, 10) || 20, 1), 100);
  const offset = Math.max(parseInt(filters.offset, 10) || 0, 0);

  const countResult = await query(`SELECT COUNT(*)::int AS total FROM incidents i ${whereSql}`, params);
  const listResult = await query(
    `${INCIDENT_SELECT} ${whereSql} ORDER BY ${orderBy} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  return { incidents: listResult.rows, total: countResult.rows[0].total, limit, offset };
}

async function getIncidentById(id) {
  const { rows } = await query(`${INCIDENT_SELECT} WHERE i.id = $1`, [id]);
  return rows[0] || null;
}

// ---------------------------------------------------------------- update

// changes: any of EDITABLE_FIELDS. Every field that actually changes gets its
// own row in incident_history, all in one transaction.
// Returns the updated incident, or null if it doesn't exist.
async function updateIncident(id, changes, changedBy) {
  checkAllowed(changes.category, CATEGORIES, "category");
  checkAllowed(changes.severity, SEVERITIES, "severity");
  checkAllowed(changes.status, STATUSES, "status");

  return withTransaction(async (client) => {
    // FOR UPDATE locks the row so two analysts editing at once can't clobber each other.
    const current = await client.query("SELECT * FROM incidents WHERE id = $1 FOR UPDATE", [id]);
    if (current.rows.length === 0) return null;
    const before = current.rows[0];

    const sets = [];
    const params = [id];
    const historyRows = [];

    for (const field of EDITABLE_FIELDS) {
      if (!(field in changes)) continue;
      const newValue = changes[field] === "" ? null : changes[field];
      const oldValue = before[field];
      if (String(oldValue ?? "") === String(newValue ?? "")) continue; // no real change
      params.push(newValue);
      sets.push(`${field} = $${params.length}`);
      historyRows.push([field, oldValue, newValue]);
    }

    if (sets.length === 0) {
      const unchanged = await client.query(`${INCIDENT_SELECT} WHERE i.id = $1`, [id]);
      return unchanged.rows[0];
    }

    // Keep resolved_at in sync with the status.
    if ("status" in changes && changes.status !== before.status) {
      if (["resolved", "closed"].includes(changes.status) && !before.resolved_at) {
        sets.push("resolved_at = NOW()");
      } else if (!["resolved", "closed"].includes(changes.status)) {
        sets.push("resolved_at = NULL"); // reopened
      }
    }
    sets.push("updated_at = NOW()");

    await client.query(`UPDATE incidents SET ${sets.join(", ")} WHERE id = $1`, params);

    for (const [field, oldValue, newValue] of historyRows) {
      await client.query(
        `INSERT INTO incident_history (incident_id, changed_by, field_changed, old_value, new_value)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, changedBy, field, oldValue === null ? null : String(oldValue), newValue === null ? null : String(newValue)]
      );
    }

    const updated = await client.query(`${INCIDENT_SELECT} WHERE i.id = $1`, [id]);
    return updated.rows[0];
  });
}

// ---------------------------------------------------------------- delete

// Comments and history are removed automatically (ON DELETE CASCADE).
async function deleteIncident(id) {
  const { rowCount } = await query("DELETE FROM incidents WHERE id = $1", [id]);
  return rowCount > 0;
}

// ---------------------------------------------------------------- comments

async function addComment(incidentId, userId, comment) {
  return withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO incident_comments (incident_id, user_id, comment)
       VALUES ($1, $2, $3)
       RETURNING id, incident_id, user_id, comment, created_at`,
      [incidentId, userId, comment]
    );
    await client.query("UPDATE incidents SET updated_at = NOW() WHERE id = $1", [incidentId]);
    return rows[0];
  });
}

async function getComments(incidentId) {
  const { rows } = await query(
    `SELECT c.id, c.incident_id, c.user_id, u.name AS user_name, c.comment, c.created_at
     FROM incident_comments c
     JOIN users u ON u.id = c.user_id
     WHERE c.incident_id = $1
     ORDER BY c.created_at ASC, c.id ASC`,
    [incidentId]
  );
  return rows;
}

async function deleteComment(commentId) {
  const { rowCount } = await query("DELETE FROM incident_comments WHERE id = $1", [commentId]);
  return rowCount > 0;
}

// ---------------------------------------------------------------- history

async function getHistory(incidentId) {
  const { rows } = await query(
    `SELECT h.id, h.field_changed, h.old_value, h.new_value, h.changed_at,
            h.changed_by, u.name AS changed_by_name
     FROM incident_history h
     LEFT JOIN users u ON u.id = h.changed_by
     WHERE h.incident_id = $1
     ORDER BY h.changed_at ASC, h.id ASC`,
    [incidentId]
  );
  return rows;
}

// ---------------------------------------------------------------- dashboard

// Everything the dashboard cards/charts need in one call.
async function getDashboardStats() {
  const [totals, byStatus, bySeverity, byCategory, recent, perDay] = await Promise.all([
    query(`
      SELECT COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE status NOT IN ('resolved', 'closed'))::int AS open_total,
             COUNT(*) FILTER (WHERE severity = 'critical'
                              AND status NOT IN ('resolved', 'closed'))::int AS open_critical,
             COUNT(*) FILTER (WHERE assigned_to IS NULL
                              AND status NOT IN ('resolved', 'closed'))::int AS unassigned,
             ROUND(AVG(EXTRACT(EPOCH FROM (resolved_at - created_at)) / 3600)
                   FILTER (WHERE resolved_at IS NOT NULL)::numeric, 1)::float AS avg_hours_to_resolve
      FROM incidents`),
    query("SELECT status, COUNT(*)::int AS count FROM incidents GROUP BY status"),
    query("SELECT severity, COUNT(*)::int AS count FROM incidents GROUP BY severity"),
    query("SELECT category, COUNT(*)::int AS count FROM incidents GROUP BY category ORDER BY count DESC"),
    query(`${INCIDENT_SELECT} ORDER BY i.created_at DESC LIMIT 5`),
    query(`
      SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COUNT(i.id)::int AS count
      FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') d
      LEFT JOIN incidents i ON i.created_at::date = d::date
      GROUP BY d ORDER BY d`),
  ]);

  // Turn the GROUP BY rows into { open: 3, investigating: 1, ... } with zeros filled in.
  const toMap = (rows, key, allKeys) =>
    Object.fromEntries(allKeys.map((k) => [k, rows.find((r) => r[key] === k)?.count || 0]));

  return {
    ...totals.rows[0],
    byStatus: toMap(byStatus.rows, "status", STATUSES),
    bySeverity: toMap(bySeverity.rows, "severity", SEVERITIES),
    byCategory: toMap(byCategory.rows, "category", CATEGORIES),
    last14Days: perDay.rows,
    recent: recent.rows,
  };
}

module.exports = {
  CATEGORIES,
  SEVERITIES,
  STATUSES,
  createIncident,
  getIncidents,
  getIncidentById,
  updateIncident,
  deleteIncident,
  addComment,
  getComments,
  deleteComment,
  getHistory,
  getDashboardStats,
};

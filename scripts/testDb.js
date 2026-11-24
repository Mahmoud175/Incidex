// Quick check that the database layer works end to end.
//   npm run db:test
// Run `npm run db:setup` first. This creates a test incident, changes it,
// comments on it, checks everything, then deletes it again.

const assert = require("assert/strict");
const db = require("../db");
const users = require("../db/users");
const incidents = require("../db/incidents");

let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
}

async function main() {
  console.log("Testing Incidex database layer...");
  let testId;

  const reporter = await users.getUserByEmail("emily@incidex.test");
  const analyst = await users.getUserByEmail("sarah@incidex.test");
  assert.ok(reporter && analyst, "Demo users missing - run npm run db:setup first");

  await check("login works with the right password", async () => {
    const u = await users.verifyLogin("Emily@Incidex.test", "Incidex123!");
    assert.equal(u.email, "emily@incidex.test");
    assert.equal(u.password_hash, undefined);
  });

  await check("login fails with the wrong password", async () => {
    assert.equal(await users.verifyLogin("emily@incidex.test", "wrong"), null);
  });

  await check("duplicate email is rejected", async () => {
    await assert.rejects(
      users.createUser({ name: "Dup", email: "EMILY@incidex.test", password: "x" })
    );
  });

  await check("create incident", async () => {
    const inc = await incidents.createIncident(
      {
        title: "TEST - suspicious login",
        description: "Created by testDb.js",
        category: "unauthorized_access",
        severity: "high",
        affected_asset: "Test server",
      },
      reporter.id
    );
    testId = inc.id;
    assert.equal(inc.status, "open");
    assert.equal(inc.reported_by_name, reporter.name);
  });

  await check("invalid severity is rejected", async () => {
    await assert.rejects(
      incidents.createIncident(
        { title: "bad", description: "bad", category: "other", severity: "extreme" },
        reporter.id
      )
    );
  });

  await check("filter by status/severity/search", async () => {
    const { incidents: list, total } = await incidents.getIncidents({
      status: "open",
      severity: "high",
      search: "TEST - suspicious",
    });
    assert.equal(total, 1);
    assert.equal(list[0].id, testId);
  });

  await check("search text is treated as data (no SQL injection)", async () => {
    const { total } = await incidents.getIncidents({ search: "' OR 1=1 --" });
    assert.equal(total, 0);
  });

  await check("assign + change status writes history", async () => {
    const updated = await incidents.updateIncident(
      testId,
      { assigned_to: analyst.id, status: "investigating", not_a_column: "ignored" },
      analyst.id
    );
    assert.equal(updated.assigned_to_name, analyst.name);
    assert.equal(updated.status, "investigating");
    const fields = (await incidents.getHistory(testId)).map((h) => h.field_changed);
    assert.ok(fields.includes("created") && fields.includes("status") && fields.includes("assigned_to"));
  });

  await check("resolving sets resolved_at, reopening clears it", async () => {
    const resolved = await incidents.updateIncident(testId, { status: "resolved" }, analyst.id);
    assert.ok(resolved.resolved_at instanceof Date);
    const reopened = await incidents.updateIncident(testId, { status: "open" }, analyst.id);
    assert.equal(reopened.resolved_at, null);
  });

  await check("no-op update adds no history", async () => {
    const before = (await incidents.getHistory(testId)).length;
    await incidents.updateIncident(testId, { status: "open" }, analyst.id);
    assert.equal((await incidents.getHistory(testId)).length, before);
  });

  await check("comments", async () => {
    await incidents.addComment(testId, analyst.id, "Looking into it.");
    const comments = await incidents.getComments(testId);
    assert.equal(comments.length, 1);
    assert.equal(comments[0].user_name, analyst.name);
  });

  await check("dashboard stats", async () => {
    const s = await incidents.getDashboardStats();
    assert.ok(s.total >= 1);
    assert.equal(
      Object.values(s.byStatus).reduce((a, b) => a + b, 0),
      s.total
    );
    assert.equal(s.last14Days.length, 14);
  });

  await check("delete incident also removes its comments/history", async () => {
    assert.equal(await incidents.deleteIncident(testId), true);
    assert.equal(await incidents.getIncidentById(testId), null);
    assert.equal((await incidents.getComments(testId)).length, 0);
    assert.equal((await incidents.getHistory(testId)).length, 0);
    testId = null;
  });

  console.log(`All ${passed} checks passed.`);
  return testId;
}

main()
  .catch((err) => {
    console.error("TEST FAILED:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    // Clean up the test incident if a check failed halfway through.
    const { rows } = await db.query("SELECT id FROM incidents WHERE title = 'TEST - suspicious login'");
    for (const r of rows) await incidents.deleteIncident(r.id);
    await db.close();
  });

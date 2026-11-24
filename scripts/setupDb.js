// Builds the database from scratch: runs database/schema.sql, then fills it with
// demo data (users, incidents, comments, and history).
//
//   npm run db:setup
//
// WARNING: this wipes whatever is in the tables. Only point it at a dev/demo database.

const fs = require("fs");
const path = require("path");
const db = require("../db");
const users = require("../db/users");
const incidents = require("../db/incidents");

const DEMO_PASSWORD = "Incidex123!"; // test accounts only

const DEMO_USERS = [
  { name: "Admin User", email: "admin@incidex.test", role: "admin" },
  { name: "Sarah Mitchell", email: "sarah@incidex.test", role: "analyst" },
  { name: "Daniel Ortiz", email: "daniel@incidex.test", role: "analyst" },
  { name: "Emily Chen", email: "emily@incidex.test", role: "reporter" },
  { name: "Marcus Johnson", email: "marcus@incidex.test", role: "reporter" },
  { name: "Priya Patel", email: "priya@incidex.test", role: "reporter" },
];

// daysAgo = when it was reported. updates = what an analyst did afterwards.
const DEMO_INCIDENTS = [
  {
    reporter: "emily", daysAgo: 13,
    title: "Phishing email pretending to be IT password reset",
    description: "Got an email from 'it-support@untt-help.com' asking me to reset my password through a link. The link goes to a fake login page.",
    category: "phishing", severity: "medium", affected_asset: "Outlook - staff mailboxes",
    updates: [
      { by: "sarah", after: 0.1, changes: { assigned_to: "sarah", status: "investigating" } },
      { by: "sarah", after: 0.5, comment: "Same email reached 14 other inboxes. Blocking the sender domain and pulling the messages." },
      { by: "sarah", after: 1, changes: { status: "resolved" } },
    ],
  },
  {
    reporter: "marcus", daysAgo: 11,
    title: "Ransomware note on finance shared drive",
    description: "Files on the finance share were renamed with a .lockd extension and a README_RESTORE.txt showed up asking for payment.",
    category: "malware", severity: "critical", affected_asset: "FIN-FS01 file server",
    updates: [
      { by: "daniel", after: 0.05, changes: { assigned_to: "daniel", status: "investigating" } },
      { by: "daniel", after: 0.2, comment: "Server isolated from the network. Infection started from one workstation mapping the drive." },
      { by: "daniel", after: 0.6, changes: { status: "contained" } },
      { by: "daniel", after: 2, comment: "Restored from last night's backup, no data lost. Workstation reimaged." },
      { by: "daniel", after: 2.2, changes: { status: "closed" } },
    ],
  },
  {
    reporter: "priya", daysAgo: 9,
    title: "Multiple failed VPN logins from overseas IP",
    description: "Security alert showed 200+ failed VPN login attempts on my account from an IP in another country over one hour.",
    category: "unauthorized_access", severity: "high", affected_asset: "Corporate VPN",
    updates: [
      { by: "sarah", after: 0.1, changes: { assigned_to: "sarah", status: "investigating" } },
      { by: "sarah", after: 0.3, comment: "Looks like password spraying. Account wasn't compromised. Forced a reset and enabled MFA." },
      { by: "sarah", after: 0.5, changes: { status: "resolved" } },
    ],
  },
  {
    reporter: "emily", daysAgo: 7,
    title: "Customer spreadsheet shared publicly by mistake",
    description: "A spreadsheet with customer names and emails was shared with 'anyone with the link' on the cloud drive.",
    category: "data_leak", severity: "high", affected_asset: "Cloud drive - Sales folder",
    updates: [
      { by: "daniel", after: 0.2, changes: { assigned_to: "daniel", status: "contained" } },
      { by: "daniel", after: 0.3, comment: "Link sharing turned off. Checking the access log to see if anyone outside opened it." },
    ],
  },
  {
    reporter: "marcus", daysAgo: 5,
    title: "Company website down from traffic spike",
    description: "The public website kept timing out for about 40 minutes. Monitoring showed a huge spike of requests from many IPs.",
    category: "dos", severity: "high", affected_asset: "www public website",
    updates: [
      { by: "sarah", after: 0.02, changes: { assigned_to: "sarah", status: "investigating" } },
      { by: "sarah", after: 0.1, comment: "Turned on rate limiting at the CDN. Traffic back to normal." },
      { by: "sarah", after: 0.2, changes: { status: "resolved" } },
    ],
  },
  {
    reporter: "priya", daysAgo: 4,
    title: "USB drive found in parking lot plugged into lab PC",
    description: "Someone plugged in a USB drive they found outside. Antivirus flagged a file called invoice.exe.",
    category: "malware", severity: "medium", affected_asset: "LAB-PC-07",
    updates: [
      { by: "daniel", after: 0.1, changes: { assigned_to: "daniel", status: "investigating" } },
    ],
  },
  {
    reporter: "emily", daysAgo: 3,
    title: "Text message asking for gift cards from 'the CEO'",
    description: "Got a text claiming to be from the CEO asking me to buy gift cards for a client and send the codes.",
    category: "phishing", severity: "low", affected_asset: "Personal phone",
    updates: [
      { by: "sarah", after: 0.3, comment: "Classic gift card scam. Sending a heads-up to all staff." },
      { by: "sarah", after: 0.4, changes: { assigned_to: "sarah", status: "closed" } },
    ],
  },
  {
    reporter: "marcus", daysAgo: 2,
    title: "Former employee account still active",
    description: "Noticed an employee who left last month still shows as active in the HR system and logged in yesterday.",
    category: "unauthorized_access", severity: "critical", affected_asset: "HR portal",
    updates: [
      { by: "daniel", after: 0.05, changes: { assigned_to: "daniel", status: "investigating" } },
      { by: "daniel", after: 0.1, comment: "Account disabled. Pulling the login history to see what was accessed." },
    ],
  },
  {
    reporter: "priya", daysAgo: 1,
    title: "Suspicious browser extension installed on several PCs",
    description: "A 'PDF converter' extension appeared on a few machines and is redirecting searches.",
    category: "malware", severity: "medium", affected_asset: "Marketing workstations",
    updates: [],
  },
  {
    reporter: "emily", daysAgo: 0.5,
    title: "Unknown device connected to office Wi-Fi",
    description: "Router admin page lists a device called 'raspberrypi' that nobody recognizes.",
    category: "unauthorized_access", severity: "high", affected_asset: "Office Wi-Fi",
    updates: [],
  },
  {
    reporter: "marcus", daysAgo: 0.2,
    title: "Lost laptop with saved passwords",
    description: "Left my work laptop on the train. The browser has saved passwords for a few internal tools.",
    category: "other", severity: "medium", affected_asset: "Laptop LT-2231",
    updates: [],
  },
];

const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
  console.log("Creating tables...");
  const schema = fs.readFileSync(path.join(__dirname, "..", "database", "schema.sql"), "utf8");
  await db.query(schema);

  console.log("Adding demo users...");
  const userIds = {};
  for (const u of DEMO_USERS) {
    const created = await users.createUser({ ...u, password: DEMO_PASSWORD });
    userIds[u.email.split("@")[0]] = created.id;
  }

  console.log("Adding demo incidents...");
  const now = Date.now();
  for (const inc of DEMO_INCIDENTS) {
    const { reporter, daysAgo, updates, ...fields } = inc;
    const created = await incidents.createIncident(fields, userIds[reporter]);
    const createdAt = new Date(now - daysAgo * DAY_MS);
    let lastTime = createdAt;

    for (const step of updates) {
      const when = new Date(createdAt.getTime() + step.after * DAY_MS);
      if (step.changes) {
        const changes = { ...step.changes };
        if (changes.assigned_to) changes.assigned_to = userIds[changes.assigned_to];
        await incidents.updateIncident(created.id, changes, userIds[step.by]);
        // Backdate the history rows we just wrote so the timeline looks real.
        await db.query(
          "UPDATE incident_history SET changed_at = $2 WHERE incident_id = $1 AND changed_at > $3",
          [created.id, when, new Date(now - 60 * 1000)]
        );
        if (["resolved", "closed"].includes(changes.status)) {
          await db.query("UPDATE incidents SET resolved_at = $2 WHERE id = $1", [created.id, when]);
        }
      }
      if (step.comment) {
        const c = await incidents.addComment(created.id, userIds[step.by], step.comment);
        await db.query("UPDATE incident_comments SET created_at = $2 WHERE id = $1", [c.id, when]);
      }
      lastTime = when;
    }

    // Put the real timestamps on the incident and its "created" history row.
    await db.query("UPDATE incidents SET created_at = $2, updated_at = $3 WHERE id = $1", [
      created.id,
      createdAt,
      lastTime,
    ]);
    await db.query(
      "UPDATE incident_history SET changed_at = $2 WHERE incident_id = $1 AND field_changed = 'created'",
      [created.id, createdAt]
    );
  }

  const stats = await incidents.getDashboardStats();
  console.log(
    `Done: ${DEMO_USERS.length} users, ${stats.total} incidents ` +
      `(${stats.open_total} open, ${stats.open_critical} open critical).`
  );
  console.log(`Demo login: any @incidex.test email above, password ${DEMO_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error("Database setup failed:", err.message);
    process.exitCode = 1;
  })
  .finally(() => db.close());

// Shared PostgreSQL connection pool.
// Every other db file imports query() / getClient() from here instead of
// opening its own connection.

require("dotenv").config();
const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is missing. Copy .env.example to .env and paste in your connection string."
  );
}

// Hosted Postgres (Neon, Render, etc.) needs SSL. A local database usually doesn't.
const isLocal = /localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false },
  max: 10,
});

pool.on("error", (err) => {
  console.error("Unexpected database error:", err.message);
});

// One-off query. Always pass values in the params array, never glue them into
// the SQL string, so user input can't turn into SQL injection.
function query(text, params = []) {
  return pool.query(text, params);
}

// For transactions (several queries that have to succeed or fail together).
// Remember to call client.release() in a finally block.
function getClient() {
  return pool.connect();
}

// Runs fn(client) inside BEGIN/COMMIT and rolls back if anything throws.
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

function close() {
  return pool.end();
}

module.exports = { query, getClient, withTransaction, close, pool };

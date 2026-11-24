// Database functions for the users table.
// Passwords are hashed with bcrypt here, so the rest of the app never touches
// a plain-text password after signup/login.

const bcrypt = require("bcryptjs");
const { query } = require("./index");

const ROLES = ["reporter", "analyst", "admin"];
const SALT_ROUNDS = 10;

// Columns that are safe to send back to the frontend (no password_hash).
const PUBLIC_COLUMNS = "id, name, email, role, created_at";

async function createUser({ name, email, password, role = "reporter" }) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  const { rows } = await query(
    `INSERT INTO users (name, email, password_hash, role)
     VALUES ($1, LOWER($2), $3, $4)
     RETURNING ${PUBLIC_COLUMNS}`,
    [name, email, passwordHash, role]
  );
  return rows[0];
}

// Returns the user (without the hash) if the email/password match, otherwise null.
async function verifyLogin(email, password) {
  const { rows } = await query(
    "SELECT id, name, email, role, created_at, password_hash FROM users WHERE email = LOWER($1)",
    [email]
  );
  const user = rows[0];
  if (!user) return null;
  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return null;
  delete user.password_hash;
  return user;
}

async function getUserById(id) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

async function getUserByEmail(email) {
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE email = LOWER($1)`, [email]);
  return rows[0] || null;
}

// Optional role filter, e.g. listUsers("analyst") for the "assign to" dropdown.
async function listUsers(role) {
  if (role) {
    const { rows } = await query(
      `SELECT ${PUBLIC_COLUMNS} FROM users WHERE role = $1 ORDER BY name`,
      [role]
    );
    return rows;
  }
  const { rows } = await query(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY name`);
  return rows;
}

async function updateUserRole(id, role) {
  if (!ROLES.includes(role)) throw new Error(`Invalid role: ${role}`);
  const { rows } = await query(
    `UPDATE users SET role = $2 WHERE id = $1 RETURNING ${PUBLIC_COLUMNS}`,
    [id, role]
  );
  return rows[0] || null;
}

// Returns true if a user was deleted. Fails if the user still has reported
// incidents (reported_by is ON DELETE RESTRICT), which keeps the history intact.
async function deleteUser(id) {
  const { rowCount } = await query("DELETE FROM users WHERE id = $1", [id]);
  return rowCount > 0;
}

module.exports = {
  ROLES,
  createUser,
  verifyLogin,
  getUserById,
  getUserByEmail,
  listUsers,
  updateUserRole,
  deleteUser,
};

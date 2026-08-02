const { randomUUID } = require('crypto');
const pool = require('../config/db');

async function createUser(email, passwordHash) {
  const result = await pool.query(
    `INSERT INTO users (id, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING id, email`,
    [randomUUID(), email, passwordHash],
  );

  return result.rows[0];
}

async function findUserByEmail(email) {
  const result = await pool.query(
    `SELECT id, email, password_hash, full_name, display_name, bio, role, created_at
     FROM users
     WHERE email = $1`,
    [email],
  );

  return result.rows[0] || null;
}

async function findUserById(id) {
  const result = await pool.query(
    `SELECT id, email, full_name, display_name, bio, role, created_at
     FROM users
     WHERE id = $1`,
    [id],
  );

  return result.rows[0] || null;
}

module.exports = { createUser, findUserByEmail, findUserById };

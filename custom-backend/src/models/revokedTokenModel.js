const pool = require('../config/db');

async function addRevokedToken(jti, expiresAt) {
  await pool.query(
    `INSERT INTO revoked_tokens (jti, expires_at)
     VALUES ($1, $2)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, expiresAt],
  );
}

async function isTokenRevoked(jti) {
  const result = await pool.query(
    `SELECT EXISTS (
       SELECT 1
       FROM revoked_tokens
       WHERE jti = $1 AND expires_at > NOW()
     ) AS revoked`,
    [jti],
  );

  return result.rows[0].revoked;
}

module.exports = { addRevokedToken, isTokenRevoked };

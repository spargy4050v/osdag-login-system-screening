const pool = require('../config/db');

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 60;

async function findLoginAttempt(email) {
  const result = await pool.query(
    `SELECT email, attempt_count, locked_until
     FROM login_attempts
     WHERE email = $1`,
    [email],
  );

  return result.rows[0] || null;
}

async function recordFailedAttempt(email) {
  // The upsert makes incrementing the counter a single atomic database action.
  const result = await pool.query(
    `INSERT INTO login_attempts (email, attempt_count, locked_until)
     VALUES ($1, 1, NULL)
     ON CONFLICT (email) DO UPDATE SET
       attempt_count = CASE
         WHEN login_attempts.locked_until IS NOT NULL
              AND login_attempts.locked_until <= NOW() THEN 1
         WHEN login_attempts.attempt_count + 1 >= $2 THEN 0
         ELSE login_attempts.attempt_count + 1
       END,
       locked_until = CASE
         WHEN login_attempts.locked_until IS NOT NULL
              AND login_attempts.locked_until <= NOW() THEN NULL
         WHEN login_attempts.attempt_count + 1 >= $2
           THEN NOW() + ($3 * INTERVAL '1 second')
         ELSE login_attempts.locked_until
       END
     RETURNING email, attempt_count, locked_until`,
    [email, MAX_FAILED_ATTEMPTS, LOCKOUT_SECONDS],
  );

  return result.rows[0];
}

async function clearLoginAttempts(email) {
  await pool.query('DELETE FROM login_attempts WHERE email = $1', [email]);
}

module.exports = {
  MAX_FAILED_ATTEMPTS,
  LOCKOUT_SECONDS,
  findLoginAttempt,
  recordFailedAttempt,
  clearLoginAttempts,
};
